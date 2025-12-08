// models/Newsletter.js
const mongoose = require('mongoose');

const newsletterSchema = new mongoose.Schema({
  email: { 
    type: String, 
    required: true,
    match: /.+\@.+\..+/
  },
  status: {
    type: String,
    enum: ['new', 'completed'],
    default: 'new'
  },
  subscribedAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Newsletter', newsletterSchema);
