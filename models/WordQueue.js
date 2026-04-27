const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  word:        { type: String, required: true, unique: true, lowercase: true, trim: true },
  status:      { type: String, enum: ['pending', 'fetched', 'failed'], default: 'pending' },
  attempts:    { type: Number, default: 0 },
  addedAt:     { type: Date, default: Date.now },
  lastAttempt: Date,
  error:       String,
}, { timestamps: false });

schema.index({ status: 1, lastAttempt: 1, addedAt: 1 });

module.exports = mongoose.model('WordQueue', schema);
