/**
 * Seed script — imports the local DICT from dictionary.js into MongoDB.
 * Run: node scripts/seed.js
 *
 * To seed from a larger dataset:
 *   1. Run fetchWords.js to build data/dataset.json
 *   2. This script will auto-import it if present.
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs       = require('fs');
const path     = require('path');
const vm       = require('vm');
const mongoose = require('mongoose');
const Word     = require('../models/Word');

// ── Load local DICT from app source (ES module syntax → CommonJS via vm) ──────
function loadLocalDict() {
  try {
    const src = fs.readFileSync(
      path.join(__dirname, '../../src/data/dictionary.js'),
      'utf8'
    );
    const code = src
      .replace(/export default DICT;?/g, '')
      .replace(/^const DICT\s*=/m, 'DICT =');
    const sandbox = {};
    vm.runInNewContext(code, sandbox);
    return sandbox.DICT || {};
  } catch (e) {
    console.warn('Could not load local dict:', e.message);
    return {};
  }
}

// ── Load optional bulk dataset ─────────────────────────────────────────────────
function loadDataset() {
  const datasetPath = path.join(__dirname, '../data/dataset.json');
  if (!fs.existsSync(datasetPath)) return [];
  try {
    const raw = fs.readFileSync(datasetPath, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : Object.entries(data).map(([word, entry]) => ({ word, ...entry }));
  } catch (e) {
    console.warn('dataset.json parse error:', e.message);
    return [];
  }
}

async function run() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/vocab');
  console.log('Connected to MongoDB');

  // Merge local DICT entries with any bulk dataset
  const localDict = loadLocalDict();
  const localEntries = Object.entries(localDict).map(([word, entry]) => ({ word, ...entry }));
  const datasetEntries = loadDataset();

  const all = [...localEntries];
  const seen = new Set(localEntries.map(e => e.word));
  for (const entry of datasetEntries) {
    const w = entry.word?.toLowerCase()?.trim();
    if (w && !seen.has(w)) { all.push(entry); seen.add(w); }
  }

  if (all.length === 0) {
    console.log('No entries to seed.');
    process.exit(0);
  }

  console.log(`Seeding ${all.length} words…`);

  // Upsert in batches of 500 to avoid overwhelming MongoDB
  const BATCH = 500;
  let seeded = 0;
  for (let i = 0; i < all.length; i += BATCH) {
    const batch = all.slice(i, i + BATCH);
    const ops = batch.map(entry => ({
      updateOne: {
        filter: { word: entry.word.toLowerCase().trim() },
        update: {
          $set: {
            word:        entry.word.toLowerCase().trim(),
            definitions: entry.definitions || [],
            bengali:     entry.bengali     || [],
            synonyms:    entry.synonyms    || [],
            antonyms:    entry.antonyms    || [],
            examples:    entry.examples    || [],
            phonetic:    entry.phonetic    || '',
          },
        },
        upsert: true,
      },
    }));
    await Word.bulkWrite(ops, { ordered: false });
    seeded += batch.length;
    process.stdout.write(`\r  ${seeded}/${all.length} words seeded`);
  }

  const total = await Word.countDocuments();
  console.log(`\nDone. Total words in DB: ${total}`);
  process.exit(0);
}

run().catch(err => { console.error(err); process.exit(1); });
