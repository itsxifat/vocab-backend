const helmet       = require('helmet');
const rateLimit    = require('express-rate-limit');
const slowDown     = require('express-slow-down');
const mongoSanitize = require('express-mongo-sanitize');
const hpp          = require('hpp');

// ── Helmet — comprehensive HTTP security headers ──────────────────────────────
const isProd = process.env.NODE_ENV === 'production';

const helmetMiddleware = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:  ["'self'"],
      // In production the admin is a pre-built SPA — no inline scripts or eval needed.
      // In development Vite HMR injects inline scripts, so we allow them there only.
      scriptSrc:   isProd ? ["'self'"] : ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      styleSrc:    ["'self'", "'unsafe-inline'"],
      imgSrc:      ["'self'", 'data:', 'https:'],
      connectSrc:  ["'self'", 'https://api.dictionaryapi.dev', 'https://api.datamuse.com',
                    'https://api.mymemory.translated.net', 'https://translation.googleapis.com'],
      fontSrc:     ["'self'", 'https://fonts.gstatic.com'],
      objectSrc:   ["'none'"],
      upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null,
    },
  },
  crossOriginEmbedderPolicy: false, // allow SSE
});

// ── Rate limiters ─────────────────────────────────────────────────────────────

// Brute-force protection on login (5 attempts / 15 min per IP)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  skipSuccessfulRequests: true,
  message: { error: 'Too many login attempts. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Admin API: 300 req / 15 min per IP
const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  message: { error: 'Too many requests from this IP.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// App general API: 60 req / 15 min per IP
const appLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: { error: 'Rate limit exceeded. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Dictionary sync: higher limit — a full 100k-word sync is ~200 page requests.
// Allow 600 per 30 min (3 full syncs) and block bulk scraping.
const syncLimiter = rateLimit({
  windowMs: 30 * 60 * 1000,
  max: 600,
  message: { error: 'Sync rate limit exceeded. Please wait before retrying.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Slow repeated requests progressively (after 50 requests, each one gets +100ms delay)
const speedLimiter = slowDown({
  windowMs: 15 * 60 * 1000,
  delayAfter: 50,
  delayMs: () => 100,
});

// ── MongoDB injection sanitization ────────────────────────────────────────────
// Removes `$` and `.` from query parameters to prevent NoSQL injection
const sanitize = mongoSanitize({ replaceWith: '_' });

// ── HTTP Parameter Pollution prevention ──────────────────────────────────────
const preventHPP = hpp({
  whitelist: ['page', 'limit', 'q', 'sort'], // allow these to be arrays
});

// ── Request size limits (applied in server.js via express.json limit) ─────────

// ── IP deny list (add malicious IPs here) ────────────────────────────────────
const BLOCKED_IPS = new Set((process.env.BLOCKED_IPS || '').split(',').filter(Boolean));
function blockIPs(req, res, next) {
  if (BLOCKED_IPS.has(req.ip)) return res.status(403).json({ error: 'Forbidden' });
  next();
}

// ── Remove sensitive headers ──────────────────────────────────────────────────
function removePoweredBy(req, res, next) {
  res.removeHeader('X-Powered-By');
  next();
}

module.exports = {
  helmetMiddleware,
  loginLimiter,
  adminLimiter,
  appLimiter,
  syncLimiter,
  speedLimiter,
  sanitize,
  preventHPP,
  blockIPs,
  removePoweredBy,
};
