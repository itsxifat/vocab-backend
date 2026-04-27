const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  filename:     { type: String, default: '' },
  filePath:     { type: String },  // OS temp path — present until file is deleted
  fileSize:     { type: Number },  // bytes, for display
  status:       { type: String, enum: ['parsing', 'completed', 'stopped', 'error'], default: 'parsing' },
  pagesScanned: { type: Number, default: 0 },
  found:        { type: Number, default: 0 },
  saved:        { type: Number, default: 0 },
  options: {
    limit:     { type: Number, default: 0 },
    overwrite: { type: Boolean, default: true },
  },
  error:       { type: String },
  startedAt:   { type: Date, default: Date.now },
  completedAt: { type: Date },
}, { timestamps: true });

module.exports = mongoose.model('ImportJob', schema);
