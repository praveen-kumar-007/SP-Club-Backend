// routes/registerRoutes.js
const express = require('express');
const router = express.Router();
const Registration = require('../models/registration'); // Import the Registration model

// POST /api/register - Submit a new registration
router.post('/', async (req, res) => {
  try {
    const {
      name, email, phone, role, ageGroup, experience,
      address, dob, aadharNumber, clubDetails, message,
      newsletter, terms
    } = req.body;

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
      newsletter, terms
    });

    await newRegistration.save(); // Save the registration to MongoDB
    res.status(201).json({ message: 'Registration successful!', registration: newRegistration });
  } catch (error) {
    console.error('Error submitting registration form:', error);
    // Handle Mongoose validation errors
    if (error.name === 'ValidationError') {
        const errors = Object.values(error.errors).map(err => err.message);
        return res.status(400).json({ message: errors.join(', ') });
    }
    res.status(500).json({ message: 'Server error, please try again later.' });
  }
});

module.exports = router;
