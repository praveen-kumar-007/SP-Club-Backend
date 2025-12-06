// middleware/adminAuth.js
const jwt = require('jsonwebtoken');

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
