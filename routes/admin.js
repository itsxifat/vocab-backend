const express        = require('express');
const { EventEmitter } = require('events');
const path           = require('path');
const os             = require('os');
const fs             = require('fs');
const router         = express.Router();
const multer         = require('multer');
const { requireAdmin, login } = require('../middleware/auth');
const { loginLimiter, adminLimiter } = require('../middleware/security');
const Word           = require('../models/Word');
const FetchJob       = require('../models/FetchJob');
const ImportJob      = require('../models/ImportJob');
const WordQueue      = require('../models/WordQueue');
const Settings       = require('../models/Settings');
const { runAutoFetch, getQueueStats, addToQueue } = require('../services/fetchService');
const { runWiktionaryImport } = require('../services/wiktionaryService');

// Multer: save uploads to OS temp dir, max 10 GB
const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 10 * 1024 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    const ok = file.originalname.endsWith('.bz2') || file.originalname.endsWith('.xml');
    cb(ok ? null : new Error('Only .xml or .xml.bz2 files are accepted'), ok);
  },
});

// Global active imports map (exposed for stop control)
if (!global._activeImports) global._activeImports = new Map();

// ── SSE helpers ───────────────────────────────────────────────────────────────
const TERMINAL_EVENTS = new Set(['done', 'stopped', 'error']);

// Stores an event in jobState with a sequential ID, then emits it live.
function addEvent(jobState, data, maxBuf = 1000) {
  const lastId = jobState.events.length > 0 ? jobState.events[jobState.events.length - 1].id : -1;
  const id = lastId + 1;
  const s = typeof data === 'string' ? data : JSON.stringify(data);
  jobState.events.push({ id, data: s });
  if (jobState.events.length > maxBuf) jobState.events.shift();
  jobState.emitter.emit('e', { id, data: s });
}

// Writes one SSE event. For terminal events, sends `retry: 2147483647` first
// so EventSource won't schedule a reconnect — the client calls es.close() instead.
function writeSSE(res, raw, id) {
  try {
    const { t } = JSON.parse(raw);
    if (TERMINAL_EVENTS.has(t)) res.write('retry: 2147483647\n');
  } catch {}
  if (id !== undefined) res.write(`id: ${id}\n`);
  res.write(`data: ${raw}\n\n`);
}

// Opens an SSE stream. Uses Last-Event-ID to replay only missed events, so
// reconnects don't flood the log. Never calls res.end() after terminal events —
// the client calls es.close() on receipt which triggers req.on('close').
function openSSEStream(res, req, jobState, getFetchJob) {
  res.setHeader('Content-Type',      'text/event-stream');
  res.setHeader('Cache-Control',     'no-cache');
  res.setHeader('Connection',        'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  if (!jobState) {
    // Job not in memory → look up DB and send a terminal event
    getFetchJob().then(job => {
      if (!job) { res.end(); return; }
      const evt = (() => {
        if (job.status === 'completed') return { t: 'done',    ...job };
        if (job.status === 'stopped')   return { t: 'stopped', ...job };
        return { t: 'error', message: job.error || 'Job state unavailable — server may have restarted' };
      })();
      writeSSE(res, JSON.stringify(evt));
      const t = setTimeout(() => res.end(), 10000);
      req.on('close', () => clearTimeout(t));
    }).catch(() => res.end());
    return;
  }

  // Replay only events the client hasn't seen yet (avoids log flood on reconnect)
  const lastId = parseInt(req.headers['last-event-id']);
  const replayFrom = isNaN(lastId) ? 0 : lastId + 1;
  for (const { id, data } of jobState.events) {
    if (id >= replayFrom) writeSSE(res, data, id);
  }

  if (jobState.done) {
    const t = setTimeout(() => res.end(), 10000);
    req.on('close', () => clearTimeout(t));
    return;
  }

  // Job still running — attach live listener
  const handler = ({ id, data }) => writeSSE(res, data, id);
  jobState.emitter.on('e', handler);
  const ping = setInterval(() => res.write(': ping\n\n'), 20000);
  req.on('close', () => { jobState.emitter.off('e', handler); clearInterval(ping); });
}

// ── Admin health (public — lets the frontend detect server status) ────────────
router.get('/api/health', (_, res) => {
  const mongoose = require('mongoose');
  const states   = { 0: 'disconnected', 1: 'connected', 2: 'connecting', 3: 'disconnecting' };
  const dbState  = mongoose.connection.readyState;
  res.json({
    ok:          dbState === 1,
    db:          states[dbState] || 'unknown',
    uptime:      Math.floor(process.uptime()),
    activeJobs:  activeJobs.size,
    activeImports: global._activeImports?.size ?? 0,
    multer:      !!require.resolve('multer'),
    sax:         !!require.resolve('sax'),
    unbzip2:     (() => { try { require.resolve('unbzip2-stream'); return true; } catch { return false; } })(),
  });
});

// ── Login (public, brute-force protected) ─────────────────────────────────────
router.post('/api/auth/login', loginLimiter, login);

// ── All other admin routes require JWT ───────────────────────────────────────
router.use('/api', requireAdmin, adminLimiter);

// ── Serve React admin SPA (everything that's NOT /api/*) ─────────────────────
router.get('/', (req, res) => res.sendFile(path.join(__dirname, '../public/index.html')));
router.get(/^(?!\/api).*$/, (req, res) => {
  const file = path.join(__dirname, '../public', 'index.html');
  res.sendFile(file);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Stats
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/api/stats', async (req, res) => {
  try {
    const startOfDay  = new Date(); startOfDay.setHours(0, 0, 0, 0);
    const startOfWeek = new Date(); startOfWeek.setDate(startOfWeek.getDate() - 7);
    const [total, today, week, recent, lastJob] = await Promise.all([
      Word.countDocuments(),
      Word.countDocuments({ createdAt: { $gte: startOfDay } }),
      Word.countDocuments({ createdAt: { $gte: startOfWeek } }),
      Word.find({}, 'word createdAt').sort({ createdAt: -1 }).limit(20).lean(),
      FetchJob.findOne().sort({ createdAt: -1 }).lean(),
    ]);
    // Words added per day for the last 14 days (for chart)
    const chartData = await Word.aggregate([
      { $match: { createdAt: { $gte: new Date(Date.now() - 14 * 86400000) } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]);
    res.json({ total, today, week, uptime: Math.floor(process.uptime()), recent, lastJob, chartData });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Words CRUD
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/api/words', async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 20);
    const q     = (req.query.q || '').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const filter = q ? { word: { $regex: q, $options: 'i' } } : {};
    const sortBy = req.query.sort === 'recent' ? { createdAt: -1 } : { word: 1 };
    const [words, total] = await Promise.all([
      Word.find(filter, 'word definitions synonyms antonyms bengali phonetic createdAt')
        .sort(sortBy).skip((page - 1) * limit).limit(limit).lean(),
      Word.countDocuments(filter),
    ]);
    res.json({ words, total, page, pages: Math.ceil(total / limit) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/api/words/:word', async (req, res) => {
  try {
    const w = req.params.word.toLowerCase().replace(/[^a-z\-]/g, '').slice(0, 50);
    const entry = await Word.findOne({ word: w }, '-__v').lean();
    if (!entry) return res.status(404).json({ error: 'Not found' });
    res.json(entry);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/api/words', async (req, res) => {
  try {
    const { word, definitions = [], bengali = [], synonyms = [], antonyms = [], examples = [], phonetic = '' } = req.body;
    if (!word?.trim()) return res.status(400).json({ error: 'word is required' });
    const saved = await Word.findOneAndUpdate(
      { word: word.toLowerCase().trim().slice(0, 60) },
      { $set: { word: word.toLowerCase().trim(), definitions, bengali, synonyms, antonyms, examples, phonetic } },
      { upsert: true, new: true, select: '-__v' }
    ).lean();
    res.json(saved);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/api/words/:word', async (req, res) => {
  try {
    const w = req.params.word.toLowerCase().replace(/[^a-z\-]/g, '').slice(0, 50);
    await Word.deleteOne({ word: w });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Auto-Fetch Job System (SSE)
// ═══════════════════════════════════════════════════════════════════════════════
// Active jobs: jobId → { emitter, events[], status, pauseFn, stopFn }
const activeJobs = new Map();

router.get('/api/autofetch/wordlist-info', async (req, res) => {
  try { res.json(await getQueueStats()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/api/autofetch/start', async (req, res) => {
  try {
    // Only one job at a time
    const running = await FetchJob.findOne({ status: { $in: ['running', 'paused'] } });
    if (running) return res.status(409).json({ error: 'A fetch job is already running', jobId: running._id });

    const { concurrency = 5, enableTranslate = true } = req.body;
    const job = await FetchJob.create({ concurrency, enableTranslate });
    const emitter = new EventEmitter(); emitter.setMaxListeners(20);
    const jobState = { emitter, events: [], status: 'running' };
    activeJobs.set(job._id.toString(), jobState);

    function onEvent(data) { addEvent(jobState, data); }

    // Run in background
    const cleanupFetch = () => {
      jobState.done = true;
      setTimeout(() => activeJobs.delete(job._id.toString()), 60000);
    };
    const isStopped = () => !!jobState.stopped;
    runAutoFetch(job._id.toString(), { concurrency, enableTranslate, onEvent, isStopped })
      .then(cleanupFetch)
      .catch(err => { onEvent({ t: 'error', message: err.message }); cleanupFetch(); });

    res.json({ jobId: job._id.toString() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/api/autofetch/stop', async (req, res) => {
  try {
    const job = await FetchJob.findOne({ status: { $in: ['running', 'paused'] } });
    if (!job) return res.status(404).json({ error: 'No active job' });
    const jobState = activeJobs.get(job._id.toString());
    if (jobState) { jobState.stopped = true; addEvent(jobState, { t: 'stopped' }); }
    await FetchJob.findByIdAndUpdate(job._id, { status: 'stopped' });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/api/autofetch/stream', (req, res) => {
  const { jobId } = req.query;
  openSSEStream(res, req, activeJobs.get(jobId), () =>
    FetchJob.findById(jobId).lean()
  );
});

router.get('/api/autofetch/jobs', async (req, res) => {
  try {
    const jobs = await FetchJob.find().sort({ createdAt: -1 }).limit(10).lean();
    res.json(jobs);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Word Queue
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/api/queue/stats', async (req, res) => {
  try { res.json(await getQueueStats()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Add words to queue (body: { words: string[] })
router.post('/api/queue/add', async (req, res) => {
  try {
    const raw = Array.isArray(req.body.words) ? req.body.words : [];
    const words = raw
      .map(w => String(w).toLowerCase().trim())
      .filter(w => /^[a-z][a-z'-]{0,49}$/.test(w));
    if (!words.length) return res.status(400).json({ error: 'No valid words provided' });
    const added = await addToQueue(words);
    res.json({ ok: true, submitted: words.length, added, stats: await getQueueStats() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Reset all failed words back to pending (retry them)
router.post('/api/queue/reset-failed', async (req, res) => {
  try {
    const r = await WordQueue.updateMany(
      { status: 'failed' },
      { $set: { status: 'pending', attempts: 0, lastAttempt: null, error: null } }
    );
    res.json({ ok: true, reset: r.modifiedCount, stats: await getQueueStats() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Reset ALL words to pending (re-fetch everything with current APIs)
// Also adds any DB words not already in the queue
router.post('/api/queue/reset-all', async (req, res) => {
  try {
    await WordQueue.updateMany(
      {},
      { $set: { status: 'pending', attempts: 0, lastAttempt: null, error: null } }
    );
    // Pull in DB words not yet in the queue
    const [dbWords, queueWords] = await Promise.all([
      Word.distinct('word'),
      WordQueue.distinct('word'),
    ]);
    const queueSet = new Set(queueWords);
    const missing  = dbWords.filter(w => !queueSet.has(w));
    if (missing.length) await addToQueue(missing);
    res.json({ ok: true, stats: await getQueueStats() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Remove all queue entries (does not delete words from DB)
router.delete('/api/queue', async (req, res) => {
  try {
    await WordQueue.deleteMany({});
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// API Key Settings
// ═══════════════════════════════════════════════════════════════════════════════
const ALLOWED_SETTINGS = ['MERRIAM_WEBSTER_KEY', 'WORDNIK_KEY', 'GOOGLE_TRANSLATE_KEY', 'MYMEMORY_EMAIL'];

router.get('/api/settings', async (req, res) => {
  try {
    const rows = await Settings.find({ key: { $in: ALLOWED_SETTINGS } }).lean();
    const result = {};
    for (const k of ALLOWED_SETTINGS) {
      const row = rows.find(r => r.key === k);
      result[k] = { set: !!(row?.value || process.env[k]) };
    }
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/api/settings', async (req, res) => {
  try {
    const { key, value } = req.body;
    if (!ALLOWED_SETTINGS.includes(key)) return res.status(400).json({ error: 'Unknown setting key' });
    const trimmed = (value || '').trim();

    if (trimmed) {
      await Settings.findOneAndUpdate({ key }, { $set: { key, value: trimmed } }, { upsert: true });
      process.env[key] = trimmed;
    } else {
      await Settings.deleteOne({ key });
      delete process.env[key];
    }
    res.json({ ok: true, key, set: !!trimmed });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Import / Export
// ═══════════════════════════════════════════════════════════════════════════════
router.post('/api/import', async (req, res) => {
  try {
    const { words } = req.body;
    if (!Array.isArray(words) || !words.length) return res.status(400).json({ error: 'words array required' });
    const ops = words.filter(w => w.word?.trim()).map(w => ({
      updateOne: {
        filter: { word: w.word.toLowerCase().trim() },
        update: { $set: { ...w, word: w.word.toLowerCase().trim() } },
        upsert: true,
      },
    }));
    const r = await Word.bulkWrite(ops, { ordered: false });
    res.json({ imported: r.upsertedCount + r.modifiedCount });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/api/export', async (req, res) => {
  try {
    const words = await Word.find({}, '-_id -__v -createdAt -updatedAt').sort({ word: 1 }).lean();
    res.setHeader('Content-Disposition', 'attachment; filename="vocab-dictionary.json"');
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify(words, null, 2));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Wiktionary XML Import
// ═══════════════════════════════════════════════════════════════════════════════

router.post('/api/wiktionary/upload', (req, res, next) => {
  // Wrap multer so its errors reach the global error handler with JSON responses
  upload.single('dump')(req, res, (err) => {
    if (err) return next(err);
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded — send the dump as form-data field "dump"' });

    // Only allow one import at a time
    const running = await ImportJob.findOne({ status: 'parsing' });
    if (running) return res.status(409).json({ error: 'An import is already running', jobId: running._id });

    const limit    = Math.max(0, parseInt(req.body.limit)    || 0);
    const overwrite = req.body.overwrite !== 'false';
    const filename  = req.file.originalname;
    const filePath  = req.file.path;
    const fileSize  = req.file.size;

    const job = await ImportJob.create({ filename, filePath, fileSize, options: { limit, overwrite } });
    const emitter  = new EventEmitter(); emitter.setMaxListeners(20);
    const jobState = { emitter, events: [], stopped: false };
    global._activeImports.set(job._id.toString(), jobState);

    function onEvent(data) { addEvent(jobState, data); }

    const cleanup = () => {
      jobState.done = true;
      // Keep in map for 60s so late-connecting SSE clients can read the final event
      setTimeout(() => global._activeImports.delete(job._id.toString()), 60000);
    };
    runWiktionaryImport(job._id.toString(), req.file.path, { limit, overwrite }, onEvent)
      .then(cleanup)
      .catch(err => { onEvent({ t: 'error', message: err.message }); cleanup(); });

    res.json({ jobId: job._id.toString(), filename });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/api/wiktionary/stop', async (req, res) => {
  try {
    const { jobId } = req.body;
    const query = jobId ? { _id: jobId, status: 'parsing' } : { status: 'parsing' };
    const job = await ImportJob.findOne(query);
    if (!job) return res.status(404).json({ error: 'No active import' });
    const jobState = global._activeImports.get(job._id.toString());
    if (jobState) { jobState.stopped = true; addEvent(jobState, { t: 'stopped', pages: 0, found: 0, saved: 0 }); }
    // Always update DB — handles server-restart/stuck-job scenarios
    await ImportJob.findByIdAndUpdate(job._id, { status: 'stopped', completedAt: new Date() });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Delete a job record (stops it first if parsing, deletes temp file if present)
router.delete('/api/wiktionary/jobs/:id', async (req, res) => {
  try {
    const job = await ImportJob.findById(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (job.status === 'parsing') {
      const jobState = global._activeImports.get(job._id.toString());
      if (jobState) { jobState.stopped = true; addEvent(jobState, { t: 'stopped', pages: 0, found: 0, saved: 0 }); }
      await ImportJob.findByIdAndUpdate(req.params.id, { status: 'stopped', completedAt: new Date() });
    }
    if (job.filePath) {
      try { fs.unlinkSync(job.filePath); } catch (e) { if (e.code !== 'ENOENT') console.warn('[wiktionary] could not delete file:', e.message); }
    }
    await ImportJob.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/api/wiktionary/jobs/:id/file', async (req, res) => {
  try {
    const job = await ImportJob.findById(req.params.id).lean();
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (!job.filePath) return res.status(404).json({ error: 'No file on record for this job' });
    try { fs.unlinkSync(job.filePath); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    await ImportJob.findByIdAndUpdate(req.params.id, { $unset: { filePath: '' } });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/api/wiktionary/stream', (req, res) => {
  const { job: jobId } = req.query;
  openSSEStream(res, req, global._activeImports.get(jobId), () =>
    ImportJob.findById(jobId).lean()
  );
});

router.get('/api/wiktionary/jobs', async (req, res) => {
  try {
    const jobs = await ImportJob.find().sort({ createdAt: -1 }).limit(10).lean();
    res.json(jobs);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
