// models/news.js
const mongoose = require('mongoose');

const newsSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  content: {
    type: String,
    required: true
  },
  lang: {
    type: String,
    enum: ['english', 'hindi'],
    default: 'english'
  },
  images: [{
    type: String, // Cloudinary URLs
    required: true
  }],
  author: {
    type: String,
    default: 'Admin'
  },
  published: {
    type: Boolean,
    default: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Index for faster queries
newsSchema.index({ createdAt: -1 });
newsSchema.index({ published: 1 });

module.exports = mongoose.model('News', newsSchema);
