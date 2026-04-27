const mongoose = require('mongoose');

const wordSchema = new mongoose.Schema(
  {
    word:        { type: String, required: true, unique: true, lowercase: true, trim: true },
    definitions: [String],
    bengali:     [String],
    synonyms:    [String],
    antonyms:    [String],
    examples:    [String],
    phonetic:    String,
  },
  { timestamps: true }
);

// Compound index: fast exact lookup + sorted range scans for paginated sync
wordSchema.index({ word: 1 });

module.exports = mongoose.model('Word', wordSchema);
