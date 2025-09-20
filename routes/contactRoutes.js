// routes/contactRoutes.js
const express = require('express');
const router = express.Router();
const Contact = require('../models/contact'); // Import the Contact model



// POST /api/contact - Submit a new contact message
router.post('/', async (req, res) => {
  try {
    // res.setHeader("Access-Control-Allow-Origin", "https://sp-club-frontend.vercel.app");
    // res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    // res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    // res.setHeader("Access-Control-Allow-Credentials", "true");
    const { name, email, subject, message } = req.body;

    // Basic validation (more robust validation can be added here or in model)
    if (!name || !email || !subject || !message) {
      return res.status(400).json({ message: 'All fields are required.' });
    }

    const newContact = new Contact({
      name,
      email,
      subject,
      message
    });

    await newContact.save(); // Save the message to MongoDB
    res.status(201).json({ message: 'Contact message sent successfully!', contact: newContact });
  } catch (error) {
    console.error('Error submitting contact form:', error);
    res.status(500).json({ message: 'Server error, please try again later.' });
  }
});

module.exports = router;
