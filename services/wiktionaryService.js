/**
 * wiktionaryService.js
 * Streams and parses an enwiktionary XML dump (.xml or .xml.bz2)
 * and upserts English entries into MongoDB.
 *
 * onEvent(data) is called with SSE-style event objects:
 *   { t: 'start',   filename }
 *   { t: 'p',       pages, found, saved }   ← periodic progress
 *   { t: 'sample',  word, def }             ← every 500th entry (live log)
 *   { t: 'done',    pages, found, saved, elapsed }
 *   { t: 'stopped', pages, found, saved }
 *   { t: 'error',   message }
 */

const fs       = require('fs');
const sax      = require('sax');
const Word     = require('../models/Word');
const ImportJob = require('../models/ImportJob');

// ── Wiki markup stripper ──────────────────────────────────────────────────────
function stripMarkup(text) {
  return text
    .replace(/<ref\b[^>]*>[\s\S]*?<\/ref>/gi, '')
    .replace(/<ref\b[^>]*\/>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\{\{ux\|[^|]+\|([^}]+)\}\}/gi, '$1')
    .replace(/\{\{[lmtq]\|[^|]+\|([^|}]+)[^}]*\}\}/gi, '$1')
    .replace(/\{\{[^}]*\}\}/g, '')
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]+)\]\]/g, '$1')
    .replace(/\[https?:\/\/\S+\s+([^\]]+)\]/g, '$1')
    .replace(/\[https?:\/\/\S+\]/g, '')
    .replace(/'{2,3}/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Wiktionary page parser ────────────────────────────────────────────────────
function parseEnglishEntry(title, wikitext) {
  const engMatch = wikitext.match(/^==\s*English\s*==/m);
  if (!engMatch) return null;

  const engStart  = wikitext.indexOf(engMatch[0]);
  const afterEng  = wikitext.slice(engStart + engMatch[0].length);
  const nextLang  = afterEng.search(/^==\s*[A-Z][a-z]/m);
  const engSection = nextLang !== -1 ? afterEng.slice(0, nextLang) : afterEng;

  const definitions = [], examples = [], synonyms = [], antonyms = [];
  let phonetic = '', inSyn = false, inAnt = false;

  for (const raw of engSection.split('\n')) {
    const line = raw.trim();

    if (!phonetic && /\{\{IPA\|en\|([^}]+)\}\}/i.test(line)) {
      const m = line.match(/\{\{IPA\|en\|([^}]+)\}\}/i);
      if (m) phonetic = m[1].split('|')[0].trim();
      continue;
    }

    if (/^===+\s*Synonyms/i.test(line))  { inSyn = true;  inAnt = false; continue; }
    if (/^===+\s*Antonyms/i.test(line))  { inAnt = true;  inSyn = false; continue; }
    if (/^===+/.test(line))              { inSyn = false;  inAnt = false; }

    if ((inSyn || inAnt) && /^\*/.test(line)) {
      const lt = [...line.matchAll(/\{\{[lmq]\|en\|([^|}]+)/gi)].map(m => m[1]);
      const lk = [...line.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)].map(m => m[1]);
      const ws = [...lt, ...lk].map(w => w.toLowerCase()).filter(Boolean);
      if (inSyn) synonyms.push(...ws); else antonyms.push(...ws);
      continue;
    }

    if (/^# /.test(line)) {
      const def = stripMarkup(line.slice(2));
      if (def.length > 5) definitions.push(def);
    } else if (/^#: /.test(line)) {
      const ex = stripMarkup(line.slice(3));
      if (ex.length > 5) examples.push(ex);
    }
  }

  if (!definitions.length) return null;

  return {
    word:        title.toLowerCase(),
    phonetic,
    definitions: [...new Set(definitions)].slice(0, 5),
    synonyms:    [...new Set(synonyms)].slice(0, 10),
    antonyms:    [...new Set(antonyms)].slice(0, 8),
    examples:    [...new Set(examples)].slice(0, 4),
    bengali:     [],
  };
}

// ── Batch upsert ──────────────────────────────────────────────────────────────
async function flushBatch(entries, overwrite) {
  if (!entries.length) return 0;
  const ops = entries.map(e => ({
    updateOne: {
      filter: { word: e.word },
      update: overwrite ? { $set: e } : { $setOnInsert: e },
      upsert: true,
    },
  }));
  const r = await Word.bulkWrite(ops, { ordered: false }).catch(() => ({ upsertedCount: 0, modifiedCount: 0 }));
  return r.upsertedCount + r.modifiedCount;
}

// ── Main export ───────────────────────────────────────────────────────────────
async function runWiktionaryImport(jobId, filePath, options = {}, onEvent) {
  const { limit = 0, overwrite = true } = options;
  const startMs = Date.now();
  const isBz2   = filePath.endsWith('.bz2');

  let source = fs.createReadStream(filePath);
  if (isBz2) {
    const unbzip2 = require('unbzip2-stream');
    source = source.pipe(unbzip2());
  }

  const parser     = sax.createStream(false, { lowercase: true });
  let currentTag   = '', currentTitle = '', currentText = '', inPage = false;
  let pages = 0, found = 0, saved = 0;
  let batch = [];
  const BATCH = 500;
  let stopped = false;

  // Expose stop control via ImportJob activeJobs map
  const jobState = global._activeImports?.get(jobId);
  if (jobState) jobState.checkStopped = () => stopped || jobState.stopped;

  onEvent?.({ t: 'start', filename: require('path').basename(filePath) });
  await ImportJob.findByIdAndUpdate(jobId, { status: 'parsing', startedAt: new Date() });

  // Periodic progress ping
  const progressTimer = setInterval(async () => {
    onEvent?.({ t: 'p', pages, found, saved });
    await ImportJob.findByIdAndUpdate(jobId, { pagesScanned: pages, found, saved }).catch(() => {});
  }, 2000);

  parser.on('opentag', ({ name }) => {
    currentTag = name;
    if (name === 'page') { inPage = true; currentTitle = ''; currentText = ''; }
  });
  parser.on('text', (text) => {
    if (!inPage) return;
    if (currentTag === 'title') currentTitle += text;
    if (currentTag === 'text')  currentText  += text;
  });

  parser.on('closetag', async (name) => {
    if (name !== 'page' || !inPage) return;
    inPage = false;
    pages++;

    // Check stop flag
    const js = global._activeImports?.get(jobId);
    if (js?.stopped) { stopped = true; parser.emit('end-import'); return; }

    if (currentTitle.includes(':')) return;
    if (currentText.trimStart().startsWith('#REDIRECT')) return;
    if (!/^[a-zA-Z][a-zA-Z '\-]{0,49}$/.test(currentTitle)) return;

    const entry = parseEnglishEntry(currentTitle, currentText);
    if (!entry) return;

    found++;
    batch.push(entry);

    // Live sample log every 50 entries
    if (found % 50 === 1) {
      onEvent?.({ t: 'sample', word: entry.word, def: entry.definitions[0] || '' });
    }

    if (batch.length >= BATCH) {
      const n = await flushBatch(batch, overwrite);
      saved += n;
      batch = [];
    }

    if (limit > 0 && found >= limit) {
      parser.emit('end-import');
    }
  });

  await new Promise((resolve, reject) => {
    parser.on('error',      reject);
    parser.on('end-import', resolve);
    parser.on('close',      resolve);
    source.pipe(parser);
    source.on('error', reject);
  });

  clearInterval(progressTimer);

  // Flush remaining batch
  if (batch.length) {
    const n = await flushBatch(batch, overwrite);
    saved += n;
  }

  const elapsed  = Math.round((Date.now() - startMs) / 1000);
  const status   = stopped ? 'stopped' : 'completed';

  await ImportJob.findByIdAndUpdate(jobId, {
    status, pagesScanned: pages, found, saved, completedAt: new Date(),
  }).catch(() => {});

  onEvent?.({ t: stopped ? 'stopped' : 'done', pages, found, saved, elapsed });

  // Clean up temp file
  fs.unlink(filePath, () => {});
}

module.exports = { runWiktionaryImport, parseEnglishEntry };
