// routes/newsletterRoutes.js
const express = require('express');
const router = express.Router();
const Newsletter = require('../models/newsletter');
const { adminAuth } = require('../middleware/adminAuth');

// Subscribe to newsletter
router.post('/subscribe', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }

    // Check if email already subscribed
    const existingSubscriber = await Newsletter.findOne({ email });
    if (existingSubscriber) {
      return res.status(400).json({ message: 'Email already subscribed' });
    }

    const newsletter = new Newsletter({ email });
    await newsletter.save();

    res.status(201).json({
      message: 'Successfully subscribed to newsletter',
      newsletter
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// GET /api/newsletter/admin - Get all newsletters (admin only)
router.get('/admin', adminAuth, async (req, res) => {
  try {
    const status = req.query.status || 'all';
    
    let query = {};
    if (status !== 'all') {
      query.status = status;
    }

    const newsletters = await Newsletter.find(query).sort({ subscribedAt: -1 });
    res.json({ newsletters });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// PATCH /api/newsletter/admin/:id - Mark as completed (admin only)
router.patch('/admin/:id', adminAuth, async (req, res) => {
  try {
    console.log('PATCH /admin/:id called with ID:', req.params.id);
    const { id } = req.params;
    const newsletter = await Newsletter.findByIdAndUpdate(
      id,
      { status: 'completed' },
      { new: true }
    );

    if (!newsletter) {
      console.log('Newsletter not found:', id);
      return res.status(404).json({ message: 'Newsletter not found' });
    }

    console.log('Newsletter marked as completed:', newsletter);
    res.json({ message: 'Newsletter marked as completed', newsletter });
  } catch (error) {
    console.error('PATCH error:', error);
    res.status(500).json({ message: error.message });
  }
});

// DELETE /api/newsletter/admin/:id - Delete newsletter (admin only)
router.delete('/admin/:id', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const newsletter = await Newsletter.findByIdAndDelete(id);

    if (!newsletter) {
      return res.status(404).json({ message: 'Newsletter not found' });
    }

    res.json({ message: 'Newsletter deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
