// middleware/adminAuth.js
const jwt = require('jsonwebtoken');
const Admin = require('../models/admin');

const adminAuth = (req, res, next) => {
  try {
    // Get token from header
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({ message: 'No token provided, authorization denied' });
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'sp_club_admin_secret_key_2024');
    req.adminId = decoded.id;
    req.admin = decoded;

    // Update server-side lastActivityTime for this device session
    // Non-blocking; fire-and-forget
    const deviceId = decoded.deviceId;
    if (deviceId && decoded.id) {
      Admin.findById(decoded.id)
        .then(admin => {
          if (!admin || !admin.activeSessions) return;
          const idx = admin.activeSessions.findIndex(s => s.deviceId === deviceId);
          if (idx !== -1) {
            admin.activeSessions[idx].lastActivityTime = new Date();
            return admin.save();
          }
        })
        .catch(() => {});
    }

    next();
  } catch (error) {
    console.error('Token verification error:', error.message);
    res.status(401).json({ message: 'Token is invalid or expired' });
  }
};

// Check if admin has specific permission
const checkPermission = (permission) => {
  return (req, res, next) => {
    if (!req.admin || !req.admin.permissions || !req.admin.permissions[permission]) {
      return res.status(403).json({ message: `You don't have permission to ${permission}` });
    }
    next();
  };
};

module.exports = { adminAuth, checkPermission };
