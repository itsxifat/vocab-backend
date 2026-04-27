const fs = require('fs');
require('dotenv').config({
  path: fs.existsSync('.env.production') ? '.env.production' : '.env',
});
const path     = require('path');
const express  = require('express');
const mongoose = require('mongoose');
const cors     = require('cors');
const compression = require('compression');

const dictionaryRoutes = require('./routes/dictionary');
const adminRoutes      = require('./routes/admin');
const {
  helmetMiddleware, sanitize, preventHPP,
  blockIPs, removePoweredBy, speedLimiter,
} = require('./middleware/security');

const app = express();

// ── Request logger ────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms  = Date.now() - start;
    const sym = res.statusCode >= 500 ? '✗' : res.statusCode >= 400 ? '!' : '✓';
    console.log(`${sym} ${req.method} ${req.originalUrl} → ${res.statusCode} (${ms}ms)`);
  });
  next();
});

// ── Trust proxy (needed for rate-limit IP detection behind nginx/cloudflare) ──
app.set('trust proxy', 1);

// ── Security middleware (order matters) ──────────────────────────────────────
app.use(removePoweredBy);
app.use(blockIPs);
app.use(helmetMiddleware);

// ── CORS ──────────────────────────────────────────────────────────────────────
const allowedOrigins = (process.env.CORS_ORIGINS || '')
  .split(',').map(o => o.trim()).filter(Boolean);

app.use(cors({
  origin: allowedOrigins.length
    ? (origin, cb) => {
        // Allow requests with no origin (mobile apps, curl) or matching whitelist
        if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
        cb(new Error(`CORS: ${origin} not allowed`));
      }
    : true, // allow all in dev
  methods: ['GET', 'POST', 'DELETE', 'PUT', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Vocab-Token', 'X-Vocab-Ts'],
  credentials: true,
}));

// ── Body parsing & sanitization ───────────────────────────────────────────────
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(sanitize);    // NoSQL injection prevention
app.use(preventHPP);  // HTTP parameter pollution prevention
app.use(speedLimiter); // Progressive slowdown on burst traffic

// ── Static files (React admin SPA) ───────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public'), {
  etag: true, maxAge: '1h',
  setHeaders(res, filePath) {
    // Never cache index.html (so React app updates are immediate)
    if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
  },
}));

// ── API routes ────────────────────────────────────────────────────────────────
app.use('/api/dictionary', dictionaryRoutes);
app.use('/admin', adminRoutes);

// ── Health check (no auth — shows DB + env status) ───────────────────────────
app.get('/health', (_, res) => {
  const states = { 0: 'disconnected', 1: 'connected', 2: 'connecting', 3: 'disconnecting' };
  const dbState = mongoose.connection.readyState;
  res.json({
    ok:     dbState === 1,
    ts:     Date.now(),
    uptime: Math.floor(process.uptime()),
    db:     states[dbState] || 'unknown',
    env:    process.env.NODE_ENV || 'development',
    port:   process.env.PORT || 3000,
  });
});

// ── React SPA fallback (client-side routing) ─────────────────────────────────
app.get('*', (req, res) => {
  // Only serve index.html for non-API routes
  if (req.path.startsWith('/api/') || req.path.startsWith('/admin/api/')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Global error handler ─────────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  const isDev   = process.env.NODE_ENV !== 'production';
  const status  = err.status || err.statusCode || 500;
  // Multer file-type/size errors
  if (err.code === 'LIMIT_FILE_SIZE')  { return res.status(413).json({ error: 'File too large (max 10 GB)' }); }
  if (err.code === 'LIMIT_UNEXPECTED_FILE') { return res.status(400).json({ error: 'Unexpected field name — use "dump"' }); }
  console.error(`[${new Date().toISOString()}] ERROR ${status} ${req.method} ${req.originalUrl}`);
  console.error(isDev ? err.stack : err.message);
  res.status(status).json({
    error: err.message || 'Internal server error',
    ...(isDev && { stack: err.stack, path: req.originalUrl }),
  });
});

// ── Database + Server start ───────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

// Check optional packages at startup so crashes are obvious
const optionalPkgs = ['multer', 'sax', 'unbzip2-stream'];
for (const pkg of optionalPkgs) {
  try { require.resolve(pkg); console.log(`✓ ${pkg}`); }
  catch { console.warn(`⚠ ${pkg} not installed — run npm install`); }
}

mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/vocab')
  .then(async () => {
    console.log('✓ MongoDB connected');

    // Load API keys saved via admin panel (override .env values)
    const Settings = require('./models/Settings');
    const savedKeys = await Settings.find({}).lean();
    for (const s of savedKeys) { if (s.value) process.env[s.key] = s.value; }
    if (savedKeys.length) console.log(`✓ Loaded ${savedKeys.length} setting(s) from DB`);

    // Clean up jobs that were in-progress when the server last stopped.
    // Their in-memory state is gone — mark them stopped so SSE clients get a
    // clean terminal event instead of "Job state unavailable".
    const FetchJob  = require('./models/FetchJob');
    const ImportJob = require('./models/ImportJob');
    const now = new Date();
    const [fetchStale, importStale] = await Promise.all([
      FetchJob.updateMany(
        { status: { $in: ['running', 'paused'] } },
        { $set: { status: 'stopped', completedAt: now, error: 'Server restarted — job was interrupted' } }
      ),
      ImportJob.updateMany(
        { status: 'parsing' },
        { $set: { status: 'stopped', completedAt: now } }
      ),
    ]);
    if (fetchStale.modifiedCount)  console.log(`⚠ Marked ${fetchStale.modifiedCount} stale fetch job(s) as stopped`);
    if (importStale.modifiedCount) console.log(`⚠ Marked ${importStale.modifiedCount} stale import job(s) as stopped`);

    app.listen(PORT, () => {
      console.log(`✓ Server running on port ${PORT}`);
      console.log(`  Admin   → http://localhost:${PORT}/admin`);
      console.log(`  API     → http://localhost:${PORT}/api/dictionary`);
      console.log(`  Health  → http://localhost:${PORT}/health`);
    });
  })
  .catch(err => {
    console.error('✗ MongoDB connection error:', err.message);
    process.exit(1);
  });
