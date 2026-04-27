#!/usr/bin/env node
/**
 * parseWiktionary.js — Import English entries from a Wiktionary XML dump
 *
 * Download the dump (~1.2 GB) from:
 *   https://dumps.wikimedia.org/enwiktionary/latest/enwiktionary-latest-pages-articles.xml.bz2
 *
 * Usage:
 *   node scripts/parseWiktionary.js --file ./enwiktionary-latest-pages-articles.xml.bz2
 *   node scripts/parseWiktionary.js --file ./dump.xml.bz2 --limit 50000
 *   node scripts/parseWiktionary.js --file ./dump.xml.bz2 --dry-run
 *   node scripts/parseWiktionary.js --file ./dump.xml     # uncompressed also works
 *
 * Options:
 *   --file <path>    Path to the .xml.bz2 (or plain .xml) dump        [required]
 *   --limit <n>      Stop after importing N words                      [optional]
 *   --dry-run        Parse and print entries without saving to MongoDB [optional]
 *   --no-overwrite   Skip words that already exist in MongoDB          [optional]
 */

require('dotenv').config();
const fs       = require('fs');
const path     = require('path');
const sax      = require('sax');
const mongoose = require('mongoose');
const Word     = require('../models/Word');

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const get  = (flag) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : null; };
const has  = (flag) => args.includes(flag);

const filePath    = get('--file');
const limit       = get('--limit') ? parseInt(get('--limit')) : Infinity;
const dryRun      = has('--dry-run');
const noOverwrite = has('--no-overwrite');

if (!filePath) {
  console.error('Usage: node parseWiktionary.js --file <path-to-dump.xml.bz2>');
  process.exit(1);
}
if (!fs.existsSync(filePath)) {
  console.error(`File not found: ${filePath}`);
  process.exit(1);
}

// ── Wiki markup stripper ──────────────────────────────────────────────────────
function stripMarkup(text) {
  return text
    // Remove <ref>...</ref> and <ref ... />
    .replace(/<ref\b[^>]*>[\s\S]*?<\/ref>/gi, '')
    .replace(/<ref\b[^>]*\/>/gi, '')
    // Remove HTML tags
    .replace(/<[^>]+>/g, '')
    // {{ux|en|example sentence}} → keep example sentence
    .replace(/\{\{ux\|[^|]+\|([^}]+)\}\}/gi, '$1')
    // {{l|en|word}} or {{m|en|word}} → keep word
    .replace(/\{\{[lmtq]\|[^|]+\|([^|}]+)[^}]*\}\}/gi, '$1')
    // Remove all remaining {{...}} templates
    .replace(/\{\{[^}]*\}\}/g, '')
    // [[link|display]] → display text
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]+)\]\]/g, '$1')
    // Remove [http://... text] external links
    .replace(/\[https?:\/\/\S+\s+([^\]]+)\]/g, '$1')
    .replace(/\[https?:\/\/\S+\]/g, '')
    // Remove bold/italic markers
    .replace(/'{2,3}/g, '')
    // Collapse whitespace
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Wiktionary section parser ─────────────────────────────────────────────────
// Parses the wikitext of a page and returns structured English data or null.
function parseEnglishEntry(title, wikitext) {
  // Must have an English section
  const engMatch = wikitext.match(/^==\s*English\s*==/m);
  if (!engMatch) return null;

  // Slice from == English == to the next == Language == (or end of text)
  const engStart = wikitext.indexOf(engMatch[0]);
  const afterEng = wikitext.slice(engStart + engMatch[0].length);
  const nextLang = afterEng.search(/^==\s*[A-Z][a-z]/m);
  const engSection = nextLang !== -1 ? afterEng.slice(0, nextLang) : afterEng;

  const definitions = [];
  const examples    = [];
  const synonyms    = [];
  const antonyms    = [];
  let   phonetic    = '';
  let   inSynonyms  = false;
  let   inAntonyms  = false;

  const lines = engSection.split('\n');

  for (const raw of lines) {
    const line = raw.trim();

    // === Pronunciation === → extract IPA
    if (/^===+\s*Pronunciation/i.test(line)) continue;
    if (!phonetic && /\{\{IPA\|en\|([^}]+)\}\}/i.test(line)) {
      const m = line.match(/\{\{IPA\|en\|([^}]+)\}\}/i);
      if (m) phonetic = m[1].split('|')[0].trim();
      continue;
    }

    // Track Synonyms / Antonyms subsections
    if (/^===+\s*Synonyms/i.test(line)) { inSynonyms = true;  inAntonyms = false; continue; }
    if (/^===+\s*Antonyms/i.test(line)) { inAntonyms = true;  inSynonyms = false; continue; }
    if (/^===+/.test(line))             { inSynonyms = false; inAntonyms = false; }

    // Collect synonym / antonym bullets
    if ((inSynonyms || inAntonyms) && /^\*/.test(line)) {
      // Extract {{l|en|word}} or [[word]] patterns
      const words = [];
      const lt = [...line.matchAll(/\{\{[lmq]\|en\|([^|}]+)/gi)].map(m => m[1]);
      const lk = [...line.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)].map(m => m[1]);
      words.push(...lt, ...lk);
      if (inSynonyms) synonyms.push(...words);
      else            antonyms.push(...words);
      continue;
    }

    // Definition lines (start with exactly "# " not "## ")
    if (/^# /.test(line)) {
      const def = stripMarkup(line.slice(2));
      if (def.length > 5 && !def.startsWith('#')) definitions.push(def);
      continue;
    }

    // Example lines (#: ...)
    if (/^#: /.test(line)) {
      const ex = stripMarkup(line.slice(3));
      if (ex.length > 5) examples.push(ex);
      continue;
    }
  }

  if (!definitions.length) return null;

  return {
    word:        title.toLowerCase(),
    phonetic,
    definitions: [...new Set(definitions)].slice(0, 5),
    synonyms:    [...new Set(synonyms.map(s => s.toLowerCase()))].filter(Boolean).slice(0, 10),
    antonyms:    [...new Set(antonyms.map(s => s.toLowerCase()))].filter(Boolean).slice(0, 8),
    examples:    [...new Set(examples)].slice(0, 4),
    bengali:     [],
  };
}

// ── Batch upsert to MongoDB ───────────────────────────────────────────────────
async function saveBatch(entries) {
  if (!entries.length) return;
  const ops = entries.map(e => ({
    updateOne: {
      filter: { word: e.word },
      update: { $set: e },
      upsert: !noOverwrite,
    },
  }));
  // When --no-overwrite, use $setOnInsert so existing words are left alone
  if (noOverwrite) {
    ops.forEach(op => {
      op.updateOne.update = { $setOnInsert: op.updateOne.update.$set };
    });
  }
  await Word.bulkWrite(ops, { ordered: false });
}

// ── Streaming XML + bz2 parser ────────────────────────────────────────────────
async function run() {
  if (!dryRun) {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/vocab');
    console.log('Connected to MongoDB');
  }

  const isBz2 = filePath.endsWith('.bz2');
  let source = fs.createReadStream(filePath);

  if (isBz2) {
    const unbzip2 = require('unbzip2-stream');
    source = source.pipe(unbzip2());
  }

  const parser = sax.createStream(false, { lowercase: true });

  let currentTag   = '';
  let currentTitle = '';
  let currentText  = '';
  let inPage       = false;

  let parsed  = 0;   // pages examined
  let found   = 0;   // English entries found
  let saved   = 0;   // words saved to DB
  let batch   = [];
  const BATCH = 500;

  const flush = async () => {
    if (!dryRun) await saveBatch(batch);
    saved += batch.length;
    batch  = [];
  };

  const startMs = Date.now();
  const progress = setInterval(() => {
    const rate  = Math.round(found / ((Date.now() - startMs) / 1000));
    const pagesK = Math.round(parsed / 1000);
    process.stdout.write(`\r  Pages: ${pagesK}k | English entries: ${found} | Saved: ${saved} | Rate: ${rate}/s  `);
  }, 1000);

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
    parsed++;

    // Skip non-article namespaces (Template:, Category:, File:, etc.)
    if (currentTitle.includes(':')) return;
    // Skip redirect pages
    if (currentText.trimStart().startsWith('#REDIRECT')) return;
    // Must be a plausible single word or short phrase
    if (!/^[a-zA-Z][a-zA-Z '\-]{0,49}$/.test(currentTitle)) return;

    const entry = parseEnglishEntry(currentTitle, currentText);
    if (!entry) return;

    found++;

    if (dryRun) {
      if (found <= 5) {
        console.log('\n--- Sample entry ---');
        console.log(JSON.stringify(entry, null, 2));
      }
    } else {
      batch.push(entry);
      if (batch.length >= BATCH) await flush();
    }

    if (found >= limit) {
      parser.emit('close');
    }
  });

  await new Promise((resolve, reject) => {
    parser.on('error', reject);
    parser.on('close', async () => {
      clearInterval(progress);
      if (!dryRun && batch.length) await flush();
      resolve();
    });
    source.pipe(parser);
    source.on('error', reject);
  });

  const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
  console.log(`\n\nDone in ${elapsed}s`);
  console.log(`  XML pages scanned : ${parsed.toLocaleString()}`);
  console.log(`  English entries   : ${found.toLocaleString()}`);
  if (!dryRun) console.log(`  Saved to MongoDB  : ${saved.toLocaleString()}`);

  if (!dryRun) await mongoose.disconnect();
}

run().catch(err => { console.error(err); process.exit(1); });
