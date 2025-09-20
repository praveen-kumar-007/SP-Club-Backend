// server.js
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 5000;

// Import and use routes
const contactRoutes = require('./routes/contactRoutes');
const registerRoutes = require('./routes/registerRoutes');

// Middleware
// app.use(cors({
//   origin: process.env.FRONTEND_URI, 
//   allowedHeaders:['Authorization', 'Content-Type'],
//   credentials: true,
// })); // Allow cross-origin requests from your frontend

app.use(cors());


app.use(express.json()); // To parse JSON bodies

// MongoDB Connection
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB Connected Successfully!'))
  .catch(err => console.error('MongoDB connection error:', err));

// Basic route for testing
app.get('/', (req, res) => {
  res.send('SP Club Backend is running!');
});

app.use('/api/contact', contactRoutes);
app.use('/api/register', registerRoutes);

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// // for serverless deployment in vercel
// module.exports= app
