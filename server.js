// server.js
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors({
  origin: "https://sp-club-frontend.vercel.app/", 
  credentials: true,
})); // Allow cross-origin requests from your frontend
app.use(express.json()); // To parse JSON bodies

// MongoDB Connection
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB Connected Successfully!'))
  .catch(err => console.error('MongoDB connection error:', err));

// Basic route for testing
app.get('/', (req, res) => {
  res.send('SP Club Backend is running!');
});

// Import and use routes
const contactRoutes = require('./routes/contactRoutes');
const registerRoutes = require('./routes/registerRoutes');

app.use('/api/contact', contactRoutes);
app.use('/api/register', registerRoutes);

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
