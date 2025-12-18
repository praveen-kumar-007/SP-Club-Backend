// routes/registerRoutes.js
const express = require('express');
const router = express.Router();
const { upload } = require('../config/cloudinary');
const Registration = require('../models/registration');

router.post(
  '/',
  upload.fields([
    { name: 'photo', maxCount: 1 },
    { name: 'aadharFront', maxCount: 1 },
    { name: 'aadharBack', maxCount: 1 }
  ]),
  async (req, res) => {
    try {
      if (process.env.NODE_ENV === 'development') {
        console.log('Incoming registration request:');
        console.log('Body:', req.body);
        console.log('Files:', req.files);
      }

      let {
        name, fathersName, email, phone, parentsPhone, gender, dob, bloodGroup,
        role, experience, address, aadharNumber, clubDetails,
        message, newsletter, terms
      } = req.body;

      // Convert dob safely
      if (dob && typeof dob === 'string') {
        dob = new Date(dob);
        if (isNaN(dob.getTime())) {
          return res.status(400).json({ message: 'Invalid date of birth format.' });
        }
      }

      // Convert booleans safely
      newsletter = newsletter === 'true' || newsletter === true;
      terms = terms === 'true' || terms === true;

      // Parse kabaddiPositions SAFELY
      let kabaddiPositions = [];
      if (req.body.kabaddiPositions) {
        try {
          kabaddiPositions =
            typeof req.body.kabaddiPositions === 'string'
              ? JSON.parse(req.body.kabaddiPositions)
              : req.body.kabaddiPositions;
        } catch (err) {
          return res.status(400).json({ message: 'Invalid kabaddiPositions format.' });
        }
      }

      // Ensure clubDetails is stored consistently
      if (clubDetails && typeof clubDetails === 'object') {
        clubDetails = JSON.stringify(clubDetails);
      }

      // Required fields validation
      if (
        !name || !fathersName || !email || !gender || !bloodGroup ||
        !role || !dob || !aadharNumber || !clubDetails || !terms
      ) {
        return res.status(400).json({ message: 'Required fields are missing.' });
      }

      if (!terms) {
        return res.status(400).json({ message: 'You must agree to the terms and conditions.' });
      }

      // File validation (safe access)
      if (!req.files?.photo?.length) {
        return res.status(400).json({ message: 'Photo is required.' });
      }
      if (!req.files?.aadharFront?.length) {
        return res.status(400).json({ message: 'Aadhar front image is required.' });
      }
      if (!req.files?.aadharBack?.length) {
        return res.status(400).json({ message: 'Aadhar back image is required.' });
      }

      // Duplicate Aadhar check
      const existingRegistration = await Registration.findOne({ aadharNumber });
      if (existingRegistration) {
        return res.status(409).json({
          message: 'A user with this Aadhar number is already registered.'
        });
      }

      const newRegistration = new Registration({
        name,
        fathersName,
        email,
        phone,
        parentsPhone,
        gender,
        dob,
        bloodGroup,
        role,
        experience,
        address,
        aadharNumber,
        clubDetails,
        message,
        photo: req.files.photo[0].path,
        aadharFront: req.files.aadharFront[0].path,
        aadharBack: req.files.aadharBack[0].path,
        kabaddiPositions,
        newsletter,
        terms
      });

      await newRegistration.save();

      res.status(201).json({
        message: 'Registration successful!',
        registration: newRegistration
      });

    } catch (error) {
      // ✅ Mongoose validation handled FIRST
      if (error.name === 'ValidationError') {
        const errors = Object.values(error.errors).map(e => e.message);
        return res.status(400).json({ message: errors.join(', ') });
      }

      console.error('❌ Registration error:', error);

      res.status(500).json({
        message: 'Server error, please try again later.',
        error:
          process.env.NODE_ENV === 'development'
            ? error.message
            : undefined
      });
    }
  }
);

module.exports = router;
