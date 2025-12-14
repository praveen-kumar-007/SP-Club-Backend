// routes/newsRoutes.js
const express = require('express');
const router = express.Router();
const { upload } = require('../config/cloudinary');
const News = require('../models/news');
const { adminAuth } = require('../middleware/adminAuth');

// GET /api/news/admin/all - Get all news including unpublished (admin only)
// IMPORTANT: This route must come BEFORE /:id to avoid route conflicts
router.get('/admin/all', adminAuth, async (req, res) => {
  try {
    const news = await News.find()
      .sort({ createdAt: -1 })
      .select('-__v');
    
    res.status(200).json(news);
  } catch (error) {
    console.error('Error fetching news:', error);
    res.status(500).json({ message: 'Failed to fetch news' });
  }
});

// GET /api/news - Get all published news (public)
router.get('/', async (req, res) => {
  try {
    const { language } = req.query;
    const filter = { published: true };
    
    if (language && (language === 'english' || language === 'hindi')) {
      filter.language = language;
    }

    const news = await News.find(filter)
      .sort({ createdAt: -1 })
      .select('-__v');
    
    res.status(200).json(news);
  } catch (error) {
    console.error('Error fetching news:', error);
    res.status(500).json({ message: 'Failed to fetch news' });
  }
});

// GET /api/news/:id - Get single news article (public)
router.get('/:id', async (req, res) => {
  try {
    const news = await News.findById(req.params.id);
    
    if (!news) {
      return res.status(404).json({ message: 'News article not found' });
    }
    
    res.status(200).json(news);
  } catch (error) {
    console.error('Error fetching news:', error);
    res.status(500).json({ message: 'Failed to fetch news article' });
  }
});

// POST /api/news - Create new news article (admin only)
router.post('/', adminAuth, upload.array('images', 10), async (req, res) => {
  try {
    const { title, content, language, author, published } = req.body;

    // Validation
    if (!title || !content) {
      return res.status(400).json({ message: 'Title and content are required' });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ message: 'At least one image is required' });
    }

    // Get image URLs from uploaded files
    const images = req.files.map(file => file.path);

    const newNews = new News({
      title,
      content,
      language: language || 'english',
      images,
      author: author || 'Admin',
      published: published === 'true' || published === true
    });

    await newNews.save();
    
    res.status(201).json({ 
      message: 'News article created successfully', 
      news: newNews 
    });
  } catch (error) {
    console.error('Error creating news:', error);
    res.status(500).json({ message: 'Failed to create news article' });
  }
});

// PUT /api/news/:id - Update news article (admin only)
router.put('/:id', adminAuth, upload.array('images', 10), async (req, res) => {
  try {
    const { title, content, language, author, published } = req.body;

    const news = await News.findById(req.params.id);
    if (!news) {
      return res.status(404).json({ message: 'News article not found' });
    }

    // Update fields
    if (title) news.title = title;
    if (content) news.content = content;
    if (language) news.language = language;
    if (author) news.author = author;
    if (published !== undefined) news.published = published === 'true' || published === true;

    // Update images if new ones are uploaded
    if (req.files && req.files.length > 0) {
      news.images = req.files.map(file => file.path);
    }

    news.updatedAt = Date.now();
    await news.save();

    res.status(200).json({ 
      message: 'News article updated successfully', 
      news 
    });
  } catch (error) {
    console.error('Error updating news:', error);
    res.status(500).json({ message: 'Failed to update news article' });
  }
});

// DELETE /api/news/:id - Delete news article (admin only)
router.delete('/:id', adminAuth, async (req, res) => {
  try {
    const news = await News.findByIdAndDelete(req.params.id);
    
    if (!news) {
      return res.status(404).json({ message: 'News article not found' });
    }

    res.status(200).json({ message: 'News article deleted successfully' });
  } catch (error) {
    console.error('Error deleting news:', error);
    res.status(500).json({ message: 'Failed to delete news article' });
  }
});

// PATCH /api/news/:id/publish - Toggle publish status (admin only)
router.patch('/:id/publish', adminAuth, async (req, res) => {
  try {
    const news = await News.findById(req.params.id);
    
    if (!news) {
      return res.status(404).json({ message: 'News article not found' });
    }

    news.published = !news.published;
    news.updatedAt = Date.now();
    await news.save();

    res.status(200).json({ 
      message: `News article ${news.published ? 'published' : 'unpublished'} successfully`, 
      news 
    });
  } catch (error) {
    console.error('Error toggling publish status:', error);
    res.status(500).json({ message: 'Failed to update publish status' });
  }
});

module.exports = router;
