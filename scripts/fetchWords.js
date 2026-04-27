/**
 * Bulk-fetch word definitions from Free Dictionary API and save to data/dataset.json
 *
 * Usage:
 *   node scripts/fetchWords.js --file words.txt          # one word per line
 *   node scripts/fetchWords.js --file words.txt --resume # skip already-fetched words
 *
 * After running, execute `npm run seed` to load the data into MongoDB.
 * The Free Dictionary API is free with no key required (rate: ~10 req/s safe).
 */

const fs   = require('fs');
const path = require('path');
const http = require('https');

const ARGS         = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), arr[i + 1] || true] : []));
const WORDS_FILE   = ARGS.file || path.join(__dirname, 'words.txt');
const DATASET_PATH = path.join(__dirname, '../data/dataset.json');
const DELAY_MS     = 120; // ~8 req/s — stays comfortably within free tier limits
const BATCH_SAVE   = 50;  // persist to disk every N words

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, { headers: { 'User-Agent': 'vocab-app/1.0' } }, res => {
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () => {
        if (res.statusCode === 404) return resolve(null);
        try { resolve(JSON.parse(data)); } catch { resolve(null); }
      });
    }).on('error', reject);
  });
}

function parseEntry(apiResponse) {
  if (!Array.isArray(apiResponse) || apiResponse.length === 0) return null;
  const raw = apiResponse[0];
  const definitions = [];
  const synonyms    = [];
  const antonyms    = [];
  const examples    = [];

  for (const meaning of raw.meanings || []) {
    for (const def of meaning.definitions || []) {
      if (def.definition) definitions.push(def.definition);
      if (def.example)    examples.push(def.example);
    }
    synonyms.push(...(meaning.synonyms || []));
    antonyms.push(...(meaning.antonyms || []));
  }

  return {
    word:        raw.word?.toLowerCase(),
    phonetic:    raw.phonetic || raw.phonetics?.[0]?.text || '',
    definitions: [...new Set(definitions)].slice(0, 4),
    synonyms:    [...new Set(synonyms)].slice(0, 8),
    antonyms:    [...new Set(antonyms)].slice(0, 8),
    examples:    [...new Set(examples)].slice(0, 3),
    bengali:     [], // Bengali translations require a separate API; add manually or via translation service
  };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function run() {
  if (!fs.existsSync(WORDS_FILE)) {
    console.error(`Word list not found: ${WORDS_FILE}`);
    console.error('Create a words.txt with one word per line, then re-run.');
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(DATASET_PATH), { recursive: true });

  // Load existing dataset to support --resume
  let existing = {};
  if (fs.existsSync(DATASET_PATH)) {
    try {
      const raw = JSON.parse(fs.readFileSync(DATASET_PATH, 'utf8'));
      existing = Array.isArray(raw)
        ? Object.fromEntries(raw.map(e => [e.word, e]))
        : raw;
    } catch {}
  }

  const wordList = fs.readFileSync(WORDS_FILE, 'utf8')
    .split(/\r?\n/)
    .map(w => w.trim().toLowerCase())
    .filter(w => w.length > 0 && /^[a-z]/.test(w));

  const toFetch = ARGS.resume
    ? wordList.filter(w => !existing[w])
    : wordList;

  console.log(`Words to fetch: ${toFetch.length} (${wordList.length - toFetch.length} already cached)`);

  let fetched = 0;
  let failed  = 0;

  for (let i = 0; i < toFetch.length; i++) {
    const word = toFetch[i];
    try {
      const data = await fetchJson(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
      const entry = parseEntry(data);
      if (entry) {
        existing[word] = entry;
        fetched++;
      } else {
        failed++;
      }
    } catch {
      failed++;
    }

    // Persist to disk periodically so progress survives interruptions
    if ((i + 1) % BATCH_SAVE === 0) {
      fs.writeFileSync(DATASET_PATH, JSON.stringify(Object.values(existing), null, 0));
      process.stdout.write(`\r  ${i + 1}/${toFetch.length} — fetched: ${fetched}, not found: ${failed}`);
    }

    await sleep(DELAY_MS);
  }

  fs.writeFileSync(DATASET_PATH, JSON.stringify(Object.values(existing), null, 0));
  console.log(`\n\nDone! Saved ${Object.keys(existing).length} words to ${DATASET_PATH}`);
  console.log('Now run: npm run seed');
}

run().catch(err => { console.error(err); process.exit(1); });
