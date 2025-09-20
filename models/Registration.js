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
  newsletter: { type: Boolean, default: true },
  terms: { type: Boolean, required: true },
  registeredAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Registration', registrationSchema);