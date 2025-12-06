// routes/registerRoutes.js
const express = require('express');
const router = express.Router();
const { upload } = require('../config/cloudinary');
const Registration = require('../models/registration'); // Import the Registration model

// POST /api/register - Submit a new registration
router.post('/', upload.single('photo'), async (req, res) => {
  try {
    if (process.env.NODE_ENV === 'development') {
      console.log('=== Registration Request Received ===');
      console.log('Body:', req.body);
      console.log('File:', req.file);
    }
    
    const {
      name, email, phone, role, ageGroup, experience,
      address, dob, aadharNumber, clubDetails, message,
      newsletter, terms
    } = req.body;

    // Parse kabaddiPositions from string to array if it exists
    let kabaddiPositions = [];
    if (req.body.kabaddiPositions) {
      kabaddiPositions = typeof req.body.kabaddiPositions === 'string' 
        ? JSON.parse(req.body.kabaddiPositions) 
        : req.body.kabaddiPositions;
    }

    // Basic validation (add more as needed)
    if (!name || !email || !role || !dob || !aadharNumber || !clubDetails || !terms) {
      return res.status(400).json({ message: 'Required fields are missing.' });
    }
    if (!terms) {
      return res.status(400).json({ message: 'You must agree to the terms and conditions.' });
    }

    // Check if Aadhar number already exists
    const existingRegistration = await Registration.findOne({ aadharNumber });
    if (existingRegistration) {
      return res.status(409).json({ message: 'A user with this Aadhar number is already registered.' });
    }

    const newRegistration = new Registration({
      name, email, phone, role, ageGroup, experience,
      address, dob, aadharNumber, clubDetails, message,
      photo: req.file ? req.file.path : null, // Store Cloudinary URL
      kabaddiPositions,
      newsletter, terms
    });

    await newRegistration.save(); // Save the registration to MongoDB
    if (process.env.NODE_ENV === 'development') {
      console.log('✅ Registration saved successfully');
    }
    res.status(201).json({ message: 'Registration successful!', registration: newRegistration });
  } catch (error) {
    if (process.env.NODE_ENV === 'development') {
      console.error('❌ Error submitting registration form:', error);
      console.error('Error details:', error.message);
      console.error('Stack:', error.stack);
    }
    // Handle Mongoose validation errors
    if (error.name === 'ValidationError') {
        const errors = Object.values(error.errors).map(err => err.message);
        return res.status(400).json({ message: errors.join(', ') });
    }
    res.status(500).json({ message: 'Server error, please try again later.' });
  }
});

module.exports = router;
