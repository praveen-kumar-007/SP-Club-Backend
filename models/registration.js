// models/Registration.js
const mongoose = require('mongoose');

const registrationSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true },
  phone: { type: String },
  role: { type: String, required: true },
  ageGroup: { type: String },
  experience: { type: String },
  address: { type: String },
  dob: { type: Date, required: true },
  aadharNumber: { type: String, required: true, unique: true }, // Aadhar should be unique
  clubDetails: { type: String, required: true },
  message: { type: String },
  photo: { type: String, required: true }, // Path to uploaded passport size photo - MANDATORY
  kabaddiPositions: [{ type: String }], // Array of selected kabaddi positions
  newsletter: { type: Boolean, default: true },
  terms: { type: Boolean, required: true },
  registeredAt: { type: Date, default: Date.now },
  // Admin approval fields
  status: { 
    type: String, 
    enum: ['pending', 'approved', 'rejected'], 
    default: 'pending' 
  },
  approvedBy: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Admin',
    default: null 
  },
  approvedAt: { 
    type: Date,
    default: null 
  },
  rejectionReason: { 
    type: String,
    default: null 
  }
});

module.exports = mongoose.model('Registration', registrationSchema);
