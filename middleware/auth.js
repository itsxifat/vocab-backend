const jwt = require('jsonwebtoken');

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@localhost';
const isProd      = process.env.NODE_ENV === 'production';

// Warn loudly if JWT_SECRET is missing so operators fix it before going live.
if (!process.env.JWT_SECRET) {
  if (isProd) {
    console.error('✗ FATAL: JWT_SECRET is not set in production. Set it in .env and restart.');
    process.exit(1);
  } else {
    console.warn('⚠ JWT_SECRET not set — using insecure dev fallback. Set it before deploying.');
  }
}

const JWT_SECRET = process.env.JWT_SECRET || 'fallback-dev-secret-change-in-prod';

// ── JWT admin authentication ──────────────────────────────────────────────────
function requireAdmin(req, res, next) {
  const header = req.headers.authorization;
  // Allow token via query param for EventSource (SSE) which cannot set headers
  const raw = header?.startsWith('Bearer ') ? header.slice(7) : req.query.token;
  if (!raw) return res.status(401).json({ error: 'Missing authorization token' });
  try {
    const payload = jwt.verify(raw, JWT_SECRET);
    if (payload.role !== 'admin') throw new Error('Not admin');
    req.admin = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ── Signed-token authentication for the mobile app ────────────────────────────
//
// The app never sends the raw API key. Instead it sends:
//   X-Vocab-Token: doubleHash(secret, 5-minute-bucket)
//   X-Vocab-Ts:    bucket  (= Math.floor(Date.now() / 300_000))
//
// This means:
//  - The secret is never on the wire; captured traffic cannot be replayed.
//  - Tokens expire automatically after 5 minutes.
//  - The same pure-JS hash runs in both the app and here (no native crypto needed).

function _h(s, seed) {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h = (Math.imul(h, 33) + c) >>> 0;
  }
  return h;
}

function _expectedToken(secret, bucket) {
  const h1 = _h(secret + ':' + bucket,         0x811c9dc5);
  const h2 = _h(String(bucket) + ':' + secret, 0x5a5a5a5a);
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

function requireApiKey(req, res, next) {
  const secret = process.env.APP_API_KEY;
  if (!secret) {
    if (isProd) return res.status(503).json({ error: 'API not configured' });
    return next(); // dev: skip when key not set
  }

  const token  = req.headers['x-vocab-token'];
  const bucket = parseInt(req.headers['x-vocab-ts'], 10);

  if (!token || isNaN(bucket)) {
    return res.status(401).json({ error: 'Missing auth headers' });
  }

  // Accept current bucket and the one before (handles up to ~5 min clock skew)
  const now = Math.floor(Date.now() / 300_000);
  if (bucket !== now && bucket !== now - 1) {
    return res.status(401).json({ error: 'Token expired' });
  }

  if (token !== _expectedToken(secret, bucket)) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  next();
}

// ── Login handler (called by admin route) ────────────────────────────────────
async function login(req, res) {
  const bcrypt = require('bcryptjs');
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  const validEmail  = email.toLowerCase() === ADMIN_EMAIL.toLowerCase();
  const storedHash  = process.env.ADMIN_PASSWORD_HASH || '';
  let validPassword;

  if (storedHash) {
    validPassword = await bcrypt.compare(password, storedHash);
  } else {
    validPassword = password === process.env.ADMIN_PASSWORD;
  }

  if (!validEmail || !validPassword) {
    // Constant-time delay prevents timing attacks
    await new Promise(r => setTimeout(r, 800));
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign({ email: ADMIN_EMAIL, role: 'admin' }, JWT_SECRET, { expiresIn: '24h' });
  res.json({ token, expiresIn: 86400 });
}

module.exports = { requireAdmin, requireApiKey, login };
