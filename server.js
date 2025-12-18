// server.js
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 5000;

/* ----------------------------------------------------
   CORS CONFIGURATION
---------------------------------------------------- */

const allowedOrigins = [
  'http://localhost:8080',
  'http://localhost:8081',
  'http://localhost:5173',
  'https://spkabaddi.me',
  'https://www.spkabaddi.me',
  'https://sp-club-frontend.onrender.com',
  'https://sp-club-frontend.vercel.app',
  process.env.FRONTEND_URL,
].filter(Boolean);

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);

    if (
      allowedOrigins.includes(origin) ||
      origin.endsWith('.onrender.com') ||
      origin.endsWith('.vercel.app')
    ) {
      return callback(null, true);
    }

    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

/* ----------------------------------------------------
   BODY PARSERS
---------------------------------------------------- */

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* ----------------------------------------------------
   ROUTES
---------------------------------------------------- */

const contactRoutes = require('./routes/contactRoutes');
const registerRoutes = require('./routes/registerRoutes');
const adminRoutes = require('./routes/adminRoutes');
const newsletterRoutes = require('./routes/newsletterRoutes');
const newsRoutes = require('./routes/newsRoutes');

app.get('/', (req, res) => {
  res.send('SP Club Backend is running!');
});

app.use('/api/contact', contactRoutes);
app.use('/api/register', registerRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/newsletter', newsletterRoutes);
app.use('/api/news', newsRoutes);

/* ----------------------------------------------------
   🔴 GLOBAL ERROR HANDLER (CRITICAL FIX)
   Catches Multer / Cloudinary / Validation errors
---------------------------------------------------- */

app.use((err, req, res, next) => {
  console.error('\n🔥 GLOBAL ERROR HANDLER TRIGGERED');
  console.error('Error name:', err.name);
  console.error('Error message:', err.message);
  console.error('Full error:', err);

  // Multer errors (file upload issues)
  if (err.name === 'MulterError') {
    return res.status(400).json({
      message: err.message || 'File upload error'
    });
  }

  // Cloudinary / upload related errors
  if (
    err.message &&
    (
      err.message.toLowerCase().includes('cloudinary') ||
      err.message.toLowerCase().includes('upload') ||
      err.message.toLowerCase().includes('file')
    )
  ) {
    return res.status(400).json({
      message: 'Image upload failed. Please check file size, type, or server configuration.'
    });
  }

  // Default fallback
  return res.status(err.status || 500).json({
    message: err.message || 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? err : {}
  });
});

/* ----------------------------------------------------
   DATABASE CONNECTION & SERVER START
---------------------------------------------------- */

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    console.log('MongoDB Connected Successfully!');
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Server running on port ${PORT}`);
      console.log(`Backend accessible at http://localhost:${PORT}`);
    });
  })
  .catch(err => {
    console.error('MongoDB connection error:', err);
  });
