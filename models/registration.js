// models/Registration.js
const mongoose = require('mongoose');

const registrationSchema = new mongoose.Schema({
  // Personal Information
  name: { type: String, required: true },
  fathersName: { type: String, required: true },
  email: { type: String, required: true },
  phone: { type: String },
  parentsPhone: { type: String },
  gender: { type: String, enum: ['male', 'female', 'other'], required: true },
  dob: { type: Date, required: true },
  bloodGroup: { type: String, enum: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'], required: true },
  
  // Address & Identification
  address: { type: String },
  aadharNumber: { type: String, required: true, unique: true }, // Aadhar should be unique
  aadharFront: { type: String, required: true }, // Path to uploaded Aadhar front image
  aadharBack: { type: String, required: true }, // Path to uploaded Aadhar back image
  
  // Sports & Role
  role: { type: String, required: true },
  ageGroup: { type: String },
  experience: { type: String },
  kabaddiPositions: [{ type: String }], // Array of selected kabaddi positions
  
  // Club & Registration Info
  clubDetails: { type: String, required: true },
  message: { type: String },
  photo: { type: String, required: true }, // Path to uploaded passport size photo - MANDATORY
  
  // Preferences
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
  rejectedAt: { 
    type: Date,
    default: null 
  },
  rejectionReason: { 
    type: String,
    default: null 
  },
  
  // ID Card fields
  idCardNumber: {
    type: String,
    unique: true,
    sparse: true, // Allows null values to be non-unique
    default: null
  },
  idCardGeneratedAt: {
    type: Date,
    default: null
  },
  idCardGeneratedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    default: null
  },
  // Admin-assigned role for ID card (optional, fallback to registration role)
  idCardRole: {
    type: String,
    default: null
  }
});

// Add indexes for better query performance
registrationSchema.index({ status: 1, registeredAt: -1 }); // For filtering by status
registrationSchema.index({ name: 'text', email: 'text', aadharNumber: 'text' }); // For search
registrationSchema.index({ registeredAt: -1 }); // For sorting by date

module.exports = mongoose.model('Registration', registrationSchema);
