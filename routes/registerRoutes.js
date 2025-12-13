// routes/registerRoutes.js
const express = require('express');
const router = express.Router();
const { upload } = require('../config/cloudinary');
const Registration = require('../models/registration'); // Import the Registration model

// POST /api/register - Submit a new registration
router.post('/', upload.fields([
  { name: 'photo', maxCount: 1 },
  { name: 'aadharFront', maxCount: 1 },
  { name: 'aadharBack', maxCount: 1 }
]), async (req, res) => {
  try {
    const {
      name, fathersName, email, phone, parentsPhone, gender, dob, bloodGroup,
      role, experience, address, aadharNumber, clubDetails,
      message, newsletter, terms
    } = req.body;

    // Parse kabaddiPositions from string to array if it exists
    let kabaddiPositions = [];
    if (req.body.kabaddiPositions) {
      kabaddiPositions = typeof req.body.kabaddiPositions === 'string' 
        ? JSON.parse(req.body.kabaddiPositions) 
        : req.body.kabaddiPositions;
    }

    // Basic validation (add more as needed)
    if (!name || !fathersName || !email || !gender || !bloodGroup || !role || !dob || !aadharNumber || !clubDetails || !terms) {
      return res.status(400).json({ message: 'Required fields are missing.' });
    }
    if (!terms) {
      return res.status(400).json({ message: 'You must agree to the terms and conditions.' });
    }

    // Validate file uploads
    if (!req.files || !req.files['photo'] || req.files['photo'].length === 0) {
      return res.status(400).json({ message: 'Photo is required.' });
    }
    if (!req.files['aadharFront'] || req.files['aadharFront'].length === 0) {
      return res.status(400).json({ message: 'Aadhar front image is required.' });
    }
    if (!req.files['aadharBack'] || req.files['aadharBack'].length === 0) {
      return res.status(400).json({ message: 'Aadhar back image is required.' });
    }

    // Check if Aadhar number already exists
    const existingRegistration = await Registration.findOne({ aadharNumber });
    if (existingRegistration) {
      return res.status(409).json({ message: 'A user with this Aadhar number is already registered.' });
    }

    const newRegistration = new Registration({
      name, fathersName, email, phone, parentsPhone, gender, dob, bloodGroup,
      role, experience, address, aadharNumber, clubDetails,
      message,
      photo: req.files['photo'][0].path,
      aadharFront: req.files['aadharFront'][0].path,
      aadharBack: req.files['aadharBack'][0].path,
      kabaddiPositions, newsletter, terms
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
