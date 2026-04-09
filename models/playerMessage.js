const mongoose = require('mongoose');

const playerMessageSchema = new mongoose.Schema({
  playerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Registration',
    required: true,
    index: true
  },
  playerName: {
    type: String,
    required: true
  },
  playerEmail: {
    type: String,
    required: true
  },
  playerPhone: {
    type: String,
    default: ''
  },
  idCardNumber: {
    type: String,
    default: ''
  },
  type: {
    type: String,
    enum: ['player_to_admin', 'admin_to_player'],
    default: 'player_to_admin',
    index: true
  },
  replyToMessageId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PlayerMessage',
    default: null
  },
  sentByAdminId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    default: null
  },
  sentByAdminName: {
    type: String,
    default: ''
  },
  subject: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200
  },
  message: {
    type: String,
    required: true,
    trim: true,
    maxlength: 3000
  },
  status: {
    type: String,
    enum: ['new', 'completed'],
    default: 'new',
    index: true
  },
  isReadByPlayer: {
    type: Boolean,
    default: false,
    index: true
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  }
});

module.exports = mongoose.model('PlayerMessage', playerMessageSchema);
