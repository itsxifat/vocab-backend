const express           = require('express');
const router            = express.Router();
const { requireApiKey } = require('../middleware/auth');
const { appLimiter, syncLimiter } = require('../middleware/security');
const Word              = require('../models/Word');

// All app routes require a valid signed token
router.use(requireApiKey);

const CHUNK_SIZE = 500;

// GET /api/dictionary/manifest
router.get('/manifest', appLimiter, async (req, res) => {
  try {
    const total = await Word.countDocuments();
    res.json({ total, chunkSize: CHUNK_SIZE, version: 2 });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/dictionary/sync?page=N
router.get('/sync', syncLimiter, async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page) || 1);
    const skip  = (page - 1) * CHUNK_SIZE;
    const [words, total] = await Promise.all([
      Word.find({}, '-_id -__v -createdAt -updatedAt').sort({ word: 1 }).skip(skip).limit(CHUNK_SIZE).lean(),
      Word.countDocuments(),
    ]);
    res.json({ page, chunkSize: CHUNK_SIZE, total, hasMore: skip + words.length < total, words });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/dictionary/word/:word
router.get('/word/:word', appLimiter, async (req, res) => {
  try {
    const word = req.params.word.toLowerCase().replace(/[^a-z\-]/g, '').slice(0, 50);
    const entry = await Word.findOne({ word }, '-_id -__v -createdAt -updatedAt').lean();
    if (!entry) return res.status(404).json({ error: 'Not found' });
    res.json(entry);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
