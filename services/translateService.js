const https = require('https');

// ── Simple in-process cache to avoid re-translating identical strings ─────────
const cache = new Map();

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'vocab-backend/2.0' } }, res => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => { try { resolve(JSON.parse(buf)); } catch { resolve(null); } });
    }).on('error', reject);
  });
}

function httpsPost(hostname, path, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const req  = https.request({ hostname, path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, res => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => { try { resolve(JSON.parse(buf)); } catch { resolve(null); } });
    });
    req.on('error', reject);
    req.write(body); req.end();
  });
}

// ── Google Cloud Translate ────────────────────────────────────────────────────
async function googleTranslate(texts, apiKey) {
  const result = await httpsPost('translation.googleapis.com',
    `/language/translate/v2?key=${apiKey}`,
    { q: texts, source: 'en', target: 'bn', format: 'text' }
  );
  return result?.data?.translations?.map(t => t.translatedText) ?? [];
}

// ── MyMemory (free, no key required) ─────────────────────────────────────────
async function myMemoryTranslate(text) {
  const email = process.env.MYMEMORY_EMAIL ? `&de=${encodeURIComponent(process.env.MYMEMORY_EMAIL)}` : '';
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|bn${email}`;
  const data = await httpsGet(url);
  if (data?.responseStatus === 200) return data.responseData.translatedText;
  return null;
}

// ── Batch translate an array of English strings to Bengali ───────────────────
// Returns an array of Bengali strings (same length, null for failures).
// Uses Google Translate if key available, otherwise MyMemory.
async function translateBatch(texts) {
  if (!texts.length) return [];

  const googleKey = process.env.GOOGLE_TRANSLATE_KEY;

  // Filter out already-cached items
  const uncached = texts.map((t, i) => ({ t, i, key: t.toLowerCase().slice(0, 80) }))
    .filter(x => !cache.has(x.key));

  // Google supports batch of up to 128 strings
  if (googleKey && uncached.length) {
    try {
      const translations = await googleTranslate(uncached.map(x => x.t), googleKey);
      uncached.forEach((x, j) => { if (translations[j]) cache.set(x.key, translations[j]); });
    } catch { /* fall through to MyMemory */ }
  }

  // MyMemory: translate one-by-one for any still uncached
  for (const x of uncached) {
    if (cache.has(x.key)) continue;
    try {
      const translated = await myMemoryTranslate(x.t);
      if (translated) cache.set(x.key, translated);
    } catch {}
    // Small delay to respect free tier rate limits
    await new Promise(r => setTimeout(r, 300));
  }

  return texts.map(t => cache.get(t.toLowerCase().slice(0, 80)) || null);
}

// ── Translate a single word's definitions to Bengali ─────────────────────────
// Returns up to 3 Bengali strings.
async function translateWordToBengali(definitions = []) {
  if (!definitions.length) return [];
  // Translate only the first 2 definitions to save API quota
  const toTranslate = definitions.slice(0, 2);
  const results = await translateBatch(toTranslate);
  return results.filter(Boolean);
}

module.exports = { translateBatch, translateWordToBengali };
