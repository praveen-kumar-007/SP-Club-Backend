// routes/contactRoutes.js
const express = require('express');
const router = express.Router();
const Contact = require('../models/contact'); // Import the Contact model
const adminAuth = require('../middleware/adminAuth');

// POST /api/contact - Submit a new contact message
router.post('/', async (req, res) => {
  try {
    const { name, email, phone, subject, message } = req.body;

    // Basic validation
    if (!name || !email || !phone || !subject || !message) {
      return res.status(400).json({ message: 'All fields are required.' });
    }

    const newContact = new Contact({
      name,
      email,
      phone,
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

// GET /api/admin/contacts - Get all contact messages (admin only)
router.get('/admin', adminAuth, async (req, res) => {
  try {
    const status = req.query.status || 'all';
    
    let query = {};
    if (status !== 'all') {
      query.status = status;
    }

    const contacts = await Contact.find(query).sort({ createdAt: -1 });
    res.json({ contacts });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// PATCH /api/admin/contacts/:id - Mark contact as completed (admin only)
router.patch('/admin/:id', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const contact = await Contact.findByIdAndUpdate(
      id,
      { status: 'completed' },
      { new: true }
    );

    if (!contact) {
      return res.status(404).json({ message: 'Contact not found' });
    }

    res.json({ message: 'Contact marked as completed', contact });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// DELETE /api/admin/contacts/:id - Delete contact message (admin only)
router.delete('/admin/:id', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const contact = await Contact.findByIdAndDelete(id);

    if (!contact) {
      return res.status(404).json({ message: 'Contact not found' });
    }

    res.json({ message: 'Contact deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
