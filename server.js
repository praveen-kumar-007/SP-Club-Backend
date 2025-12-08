// server.js
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 5000;

// CORS Configuration - must be before routes
const allowedOrigins = [
  'http://localhost:8080',
  'http://localhost:8081', 
  'http://localhost:5173',
  'https://spkabaddi.me',
  'https://www.spkabaddi.me',
  process.env.FRONTEND_URL
].filter(Boolean);

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json()); // To parse JSON bodies
app.use(express.urlencoded({ extended: true })); // To parse URL-encoded bodies


// Import and use routes
const contactRoutes = require('./routes/contactRoutes');
const registerRoutes = require('./routes/registerRoutes');
const adminRoutes = require('./routes/adminRoutes');
const newsletterRoutes = require('./routes/newsletterRoutes');

// MongoDB Connection
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB Connected Successfully!'))
  .catch(err => console.error('MongoDB connection error:', err));

// Basic route for testing
app.get('/', (req, res) => {
  res.send('SP Club Backend is running!');
});

// Email configuration test endpoint
app.get('/api/test-email', (req, res) => {
  const config = {
    emailConfigured: !!process.env.EMAIL_USER && !!process.env.EMAIL_PASSWORD,
    emailUser: process.env.EMAIL_USER ? 'Configured' : 'MISSING',
    emailPassword: process.env.EMAIL_PASSWORD ? 'Configured' : 'MISSING',
    nodeEnv: process.env.NODE_ENV || 'not set'
  };
  console.log('📧 Email Configuration Check:', config);
  res.json(config);
});

// Send test email endpoint
app.post('/api/send-test-email', async (req, res) => {
  try {
    const { sendApprovalEmail } = require('./services/emailService');
    
    console.log('📧 TEST: Sending test email to impraveen105@gmail.com');
    
    // Create a fake registration object for testing
    const testRegistration = {
      name: 'Praveen Kumar (TEST)',
      fathersName: 'Test Father',
      email: 'impraveen105@gmail.com',
      phone: '9999999999',
      parentsPhone: '8888888888',
      role: 'Player',
      bloodGroup: 'O+',
      registeredAt: new Date(),
      aadharNumber: 'TEST123456'
    };
    
    const emailResult = await sendApprovalEmail(testRegistration);
    
    res.json({
      success: emailResult.success,
      message: emailResult.success 
        ? 'Test email sent successfully! Check impraveen105@gmail.com inbox (and spam folder)'
        : 'Failed to send test email',
      messageId: emailResult.messageId,
      error: emailResult.error,
      sentTo: 'impraveen105@gmail.com'
    });
  } catch (error) {
    console.error('❌ Error in test email endpoint:', error);
    res.status(500).json({
      success: false,
      message: 'Error sending test email',
      error: error.message
    });
  }
});

app.use('/api/contact', contactRoutes);
app.use('/api/register', registerRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/newsletter', newsletterRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('❌ Server Error:', err);
  console.error('Error stack:', err.stack);
  res.status(err.status || 500).json({ 
    message: err.message || 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? err : {}
  });
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
