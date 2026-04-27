const mongoose = require('mongoose');

const fetchJobSchema = new mongoose.Schema({
  status:         { type: String, enum: ['pending','running','paused','stopped','completed','error'], default: 'pending' },
  totalWords:     { type: Number, default: 0 },
  processedWords: { type: Number, default: 0 },
  fetchedWords:   { type: Number, default: 0 },
  failedWords:    { type: Number, default: 0 },
  concurrency:    { type: Number, default: 5 },
  enableTranslate:{ type: Boolean, default: true },
  error:          String,
  startedAt:      { type: Date, default: Date.now },
  completedAt:    Date,
}, { timestamps: true });

module.exports = mongoose.model('FetchJob', fetchJobSchema);
