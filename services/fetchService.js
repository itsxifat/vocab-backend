const https     = require('https');
const Word      = require('../models/Word');
const FetchJob  = require('../models/FetchJob');
const WordQueue = require('../models/WordQueue');
const { translateWordToBengali } = require('./translateService');

// ── Semaphore ─────────────────────────────────────────────────────────────────
class Semaphore {
  constructor(max) { this.max = max; this.count = 0; this.queue = []; }
  acquire() {
    if (this.count < this.max) { this.count++; return Promise.resolve(); }
    return new Promise(r => this.queue.push(r));
  }
  release() {
    if (this.queue.length) { this.queue.shift()(); } else { this.count--; }
  }
}

// ── HTTP helper (never rejects; 10 s timeout) ─────────────────────────────────
function httpsGet(url, headers = {}) {
  return new Promise((resolve) => {
    const req = https.get(
      url,
      { headers: { 'User-Agent': 'vocab-backend/2.0', ...headers } },
      res => {
        if ([404, 414, 429].includes(res.statusCode)) return resolve(null);
        let buf = '';
        res.on('data', c => (buf += c));
        res.on('end', () => { try { resolve(JSON.parse(buf)); } catch { resolve(null); } });
      }
    );
    req.on('error', () => resolve(null));
    req.setTimeout(10000, () => { req.destroy(); resolve(null); });
  });
}

// ── Vendors ───────────────────────────────────────────────────────────────────
async function fetchFreeDictionary(word) {
  const data = await httpsGet(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
  if (!Array.isArray(data) || !data.length) return null;
  const raw = data[0];
  const defs = [], syns = [], ants = [], exs = [];
  for (const m of raw.meanings || []) {
    for (const d of m.definitions || []) {
      if (d.definition) defs.push(d.definition);
      if (d.example)    exs.push(d.example);
    }
    syns.push(...(m.synonyms || []));
    ants.push(...(m.antonyms || []));
  }
  return {
    phonetic:    raw.phonetic || raw.phonetics?.[0]?.text || '',
    definitions: [...new Set(defs)].slice(0, 4),
    synonyms:    [...new Set(syns)].slice(0, 8),
    antonyms:    [...new Set(ants)].slice(0, 8),
    examples:    [...new Set(exs)].slice(0, 3),
    vendor:      'FreeDictionary',
  };
}

async function fetchDatamuse(word) {
  const [synData, antData] = await Promise.all([
    httpsGet(`https://api.datamuse.com/words?rel_syn=${encodeURIComponent(word)}&max=10`),
    httpsGet(`https://api.datamuse.com/words?rel_ant=${encodeURIComponent(word)}&max=6`),
  ]);
  return {
    synonyms: Array.isArray(synData) ? synData.map(w => w.word) : [],
    antonyms: Array.isArray(antData) ? antData.map(w => w.word) : [],
    vendor:   'Datamuse',
  };
}

async function fetchMerriamWebster(word) {
  const key = process.env.MERRIAM_WEBSTER_KEY;
  if (!key) return null;
  const data = await httpsGet(`https://www.dictionaryapi.com/api/v3/references/collegiate/json/${encodeURIComponent(word)}?key=${key}`);
  if (!Array.isArray(data) || typeof data[0] !== 'object') return null;
  const entry = data[0];
  return {
    definitions: (entry.shortdef || []).slice(0, 3),
    phonetic:    entry.hwi?.prs?.[0]?.mw || '',
    vendor:      'MerriamWebster',
  };
}

async function fetchWordnik(word) {
  const key = process.env.WORDNIK_KEY;
  if (!key) return null;
  const [defData, exData] = await Promise.all([
    httpsGet(`https://api.wordnik.com/v4/word.json/${encodeURIComponent(word)}/definitions?limit=3&api_key=${key}`),
    httpsGet(`https://api.wordnik.com/v4/word.json/${encodeURIComponent(word)}/examples?limit=3&api_key=${key}`),
  ]);
  return {
    definitions: Array.isArray(defData) ? defData.map(d => d.text).filter(Boolean) : [],
    examples:    exData?.examples?.map(e => e.text).filter(Boolean) || [],
    vendor:      'Wordnik',
  };
}

// ── Merge ─────────────────────────────────────────────────────────────────────
function mergeResults(word, results) {
  const merged = { word: word.toLowerCase(), definitions: [], synonyms: [], antonyms: [], examples: [], phonetic: '', bengali: [], vendors: [] };
  for (const r of results.filter(Boolean)) {
    if (r.vendor)             merged.vendors.push(r.vendor);
    if (r.phonetic && !merged.phonetic) merged.phonetic = r.phonetic;
    if (r.definitions?.length) merged.definitions = [...new Set([...merged.definitions, ...r.definitions])];
    if (r.synonyms?.length)    merged.synonyms    = [...new Set([...merged.synonyms,    ...r.synonyms])];
    if (r.antonyms?.length)    merged.antonyms    = [...new Set([...merged.antonyms,    ...r.antonyms])];
    if (r.examples?.length)    merged.examples    = [...new Set([...merged.examples,    ...r.examples])];
  }
  merged.definitions = merged.definitions.slice(0, 5);
  merged.synonyms    = merged.synonyms.slice(0, 10);
  merged.antonyms    = merged.antonyms.slice(0, 8);
  merged.examples    = merged.examples.slice(0, 4);
  return merged;
}

// ── Single-word fetch ─────────────────────────────────────────────────────────
async function fetchWord(word, { enableTranslate = true } = {}) {
  const [freeDict, datamuse, merriam, wordnik] = await Promise.all([
    fetchFreeDictionary(word),
    fetchDatamuse(word),
    fetchMerriamWebster(word),
    fetchWordnik(word),
  ]);
  if (!freeDict && !merriam && !wordnik) return null;
  const merged = mergeResults(word, [freeDict, datamuse, merriam, wordnik]);
  if (enableTranslate && merged.definitions.length) {
    try { merged.bengali = await translateWordToBengali(merged.definitions); } catch {}
  }
  return merged;
}

// ── Queue helpers ─────────────────────────────────────────────────────────────
function extractDiscoveries(entry) {
  return [...(entry.synonyms || []), ...(entry.antonyms || [])]
    .map(w => w.toLowerCase().trim())
    .filter(w => /^[a-z][a-z'-]{1,29}$/.test(w));
}

async function addToQueue(words) {
  if (!words.length) return 0;
  const ops = words.map(w => ({
    updateOne: {
      filter: { word: w },
      update: { $setOnInsert: { word: w, status: 'pending', attempts: 0, addedAt: new Date() } },
      upsert: true,
    },
  }));
  const r = await WordQueue.bulkWrite(ops, { ordered: false }).catch(() => ({ upsertedCount: 0 }));
  return r.upsertedCount || 0;
}

async function getQueueStats() {
  const [total, pending, fetched, failed] = await Promise.all([
    WordQueue.countDocuments(),
    WordQueue.countDocuments({ status: 'pending' }),
    WordQueue.countDocuments({ status: 'fetched' }),
    WordQueue.countDocuments({ status: 'failed' }),
  ]);
  return { total, pending, fetched, failed };
}

// ── Main runner ───────────────────────────────────────────────────────────────
// Continuously picks pending words from WordQueue and fetches them.
// Words that fail keep their 'pending' status (with 60s cooldown via lastAttempt).
// After MAX_ATTEMPTS failures a word is marked 'failed' (reset via admin UI).
// When queue is empty, waits 30s then checks again (picks up newly added words).
const MAX_ATTEMPTS  = 5;
const COOLDOWN_MS   = 60 * 1000;   // 60s between retries per word
const IDLE_SLEEP_MS = 30 * 1000;   // 30s wait when nothing is ready

async function runAutoFetch(jobId, options = {}) {
  const {
    concurrency     = parseInt(process.env.FETCH_CONCURRENCY) || 5,
    enableTranslate = true,
    onEvent,
    isStopped       = () => false,
  } = options;

  const job = await FetchJob.findById(jobId);
  if (!job) throw new Error('Job not found');
  await FetchJob.findByIdAndUpdate(jobId, { status: 'running' });

  const sem = new Semaphore(concurrency);
  let totalFetched = 0, totalFailed = 0, totalProcessed = 0;
  let lastSave = Date.now();

  const maybeSave = async () => {
    if (Date.now() - lastSave < 30000) return;
    lastSave = Date.now();
    FetchJob.findByIdAndUpdate(jobId, {
      processedWords: totalProcessed,
      fetchedWords:   totalFetched,
      failedWords:    totalFailed,
    }).catch(() => {});
  };

  const processEntry = async (entry, batchTotal) => {
    await sem.acquire();
    try {
      if (isStopped()) return;

      await WordQueue.findOneAndUpdate(
        { word: entry.word },
        { $set: { lastAttempt: new Date() }, $inc: { attempts: 1 } }
      ).catch(() => {});

      const t0     = Date.now();
      const result = await fetchWord(entry.word, { enableTranslate });
      const ms     = Date.now() - t0;

      if (result) {
        await Word.findOneAndUpdate({ word: result.word }, { $set: result }, { upsert: true });
        await WordQueue.findOneAndUpdate(
          { word: entry.word },
          { $set: { status: 'fetched', error: null } }
        ).catch(() => {});

        const discovered = extractDiscoveries(result);
        if (discovered.length) addToQueue(discovered).catch(() => {});

        totalFetched++;
        onEvent?.({
          t: 'w', word: entry.word, s: 'ok', ms,
          vendors: result.vendors,
          defs: result.definitions.length,
          syns: result.synonyms.length,
          ants: result.antonyms.length,
          hasBengali: result.bengali.length > 0,
          fetched: totalFetched, failed: totalFailed,
          processed: ++totalProcessed, total: batchTotal,
        });
      } else {
        const attempts  = (entry.attempts || 0) + 1;
        const newStatus = attempts >= MAX_ATTEMPTS ? 'failed' : 'pending';
        await WordQueue.findOneAndUpdate(
          { word: entry.word },
          { $set: { status: newStatus, error: 'not found / rate-limited' } }
        ).catch(() => {});

        totalFailed++;
        onEvent?.({
          t: 'w', word: entry.word, s: 'nf', ms,
          fetched: totalFetched, failed: totalFailed,
          processed: ++totalProcessed, total: batchTotal,
          willRetry: newStatus === 'pending',
        });
      }
    } catch (e) {
      totalFailed++;
      await WordQueue.findOneAndUpdate(
        { word: entry.word },
        { $set: { error: String(e.message || e) } }
      ).catch(() => {});
      onEvent?.({
        t: 'w', word: entry.word, s: 'err',
        fetched: totalFetched, failed: totalFailed,
        processed: ++totalProcessed, total: 0,
        err: String(e.message || e),
      });
    } finally {
      sem.release();
      await maybeSave();
    }
  };

  // Interruptible sleep
  const sleep = async (ms) => {
    const end = Date.now() + ms;
    while (Date.now() < end && !isStopped()) {
      await new Promise(r => setTimeout(r, 1000));
    }
  };

  // ── Main loop ─────────────────────────────────────────────────────────────
  while (!isStopped()) {
    const cooldownCutoff = new Date(Date.now() - COOLDOWN_MS);

    const pending = await WordQueue.find({
      status: 'pending',
      $or: [
        { lastAttempt: { $exists: false } },
        { lastAttempt: null },
        { lastAttempt: { $lt: cooldownCutoff } },
      ],
    }).sort({ lastAttempt: 1, addedAt: 1 }).limit(500).lean();

    if (pending.length === 0) {
      const stats = await getQueueStats();
      const msg = stats.pending > 0
        ? `All ${stats.pending} pending words in 60s cooldown — waiting…`
        : stats.total === 0
          ? 'Queue empty — add words via the admin panel'
          : `All ${stats.fetched} words fetched. Add more words to continue.`;
      onEvent?.({ t: 'idle', msg, ...stats });
      await sleep(IDLE_SLEEP_MS);
      continue;
    }

    onEvent?.({
      t: 'batch',
      count:   pending.length,
      fetched: totalFetched,
      failed:  totalFailed,
    });

    await FetchJob.findByIdAndUpdate(jobId, {
      totalWords:     pending.length,
      processedWords: 0,
    }).catch(() => {});

    await Promise.all(pending.map(entry => processEntry(entry, pending.length)));
  }

  const finalStatus = isStopped() ? 'stopped' : 'completed';
  await FetchJob.findByIdAndUpdate(jobId, {
    status:         finalStatus,
    processedWords: totalProcessed,
    fetchedWords:   totalFetched,
    failedWords:    totalFailed,
    completedAt:    new Date(),
  });
  onEvent?.({ t: 'done', fetched: totalFetched, failed: totalFailed, total: totalProcessed, status: finalStatus });
}

module.exports = { runAutoFetch, fetchWord, getQueueStats, addToQueue };
