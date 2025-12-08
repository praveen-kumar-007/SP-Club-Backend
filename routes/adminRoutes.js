// routes/adminRoutes.js
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const Admin = require('../models/admin');
const Registration = require('../models/registration');
const { adminAuth, checkPermission } = require('../middleware/adminAuth');

const JWT_SECRET = process.env.JWT_SECRET || 'sp_club_admin_secret_key_2024';

// ========== AUTHENTICATION ROUTES ==========

// POST /api/admin/register - Create first admin (Super Admin setup)
router.post('/register', async (req, res) => {
  try {
    const { username, email, password, confirmPassword } = req.body;

    // Validate input
    if (!username || !email || !password || !confirmPassword) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ message: 'Passwords do not match' });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }

    // Check if admin already exists
    const existingAdmin = await Admin.findOne({ $or: [{ username }, { email }] });
    if (existingAdmin) {
      return res.status(409).json({ message: 'Admin with this username or email already exists' });
    }

    // Determine role - first admin is super_admin
    const adminCount = await Admin.countDocuments();
    const role = adminCount === 0 ? 'super_admin' : 'admin';

    // Create new admin
    const newAdmin = new Admin({
      username,
      email,
      password,
      role,
      permissions: {
        canApprove: true,
        canReject: true,
        canDelete: role === 'super_admin',
        canManageAdmins: role === 'super_admin'
      }
    });

    await newAdmin.save();

    if (process.env.NODE_ENV === 'development') {
      console.log(`✅ New ${role} created: ${username}`);
    }

    res.status(201).json({ 
      message: `Admin account created successfully (Role: ${role})`,
      admin: newAdmin.toJSON()
    });
  } catch (error) {
    console.error('❌ Admin registration error:', error);
    res.status(500).json({ message: 'Error creating admin account' });
  }
});

// POST /api/admin/login - Admin login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ message: 'Username and password are required' });
    }

    // Find admin
    const admin = await Admin.findOne({ $or: [{ username }, { email: username }] });
    if (!admin) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    if (!admin.isActive) {
      return res.status(403).json({ message: 'Your account is deactivated' });
    }

    // Check password
    const isPasswordValid = await admin.comparePassword(password);
    if (!isPasswordValid) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Update last login
    admin.lastLogin = new Date();
    await admin.save();

    // Generate JWT token
    const token = jwt.sign(
      {
        id: admin._id,
        username: admin.username,
        email: admin.email,
        role: admin.role,
        permissions: admin.permissions
      },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    if (process.env.NODE_ENV === 'development') {
      console.log(`✅ Admin logged in: ${username}`);
    }

    res.json({
      message: 'Login successful',
      token,
      admin: admin.toJSON()
    });
  } catch (error) {
    console.error('❌ Login error:', error);
    res.status(500).json({ message: 'Error logging in' });
  }
});

// POST /api/admin/logout - Admin logout (optional - mainly for frontend)
router.post('/logout', adminAuth, (req, res) => {
  // JWT logout is handled on frontend by removing token
  res.json({ message: 'Logged out successfully' });
});

// ========== REGISTRATION MANAGEMENT ROUTES ==========

// GET /api/admin/registrations - Fetch all registrations with filters
router.get('/registrations', adminAuth, async (req, res) => {
  try {
    const { status = 'pending', page = 1, limit = 10, search = '' } = req.query;

    let query = {};
    
    // Filter by status
    if (status && status !== 'all') {
      query.status = status;
    }

    // Search by name or email
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { aadharNumber: { $regex: search, $options: 'i' } }
      ];
    }

    const skip = (page - 1) * limit;
    
    const registrations = await Registration.find(query)
      .populate('approvedBy', 'username email')
      .sort({ registeredAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Registration.countDocuments(query);
    const pages = Math.ceil(total / limit);

    res.json({
      registrations,
      pagination: {
        total,
        pages,
        currentPage: parseInt(page),
        limit: parseInt(limit)
      }
    });
  } catch (error) {
    console.error('❌ Error fetching registrations:', error);
    res.status(500).json({ message: 'Error fetching registrations' });
  }
});

// GET /api/admin/registrations/:id - Get single registration details
router.get('/registrations/:id', adminAuth, async (req, res) => {
  try {
    const registration = await Registration.findById(req.params.id)
      .populate('approvedBy', 'username email');

    if (!registration) {
      return res.status(404).json({ message: 'Registration not found' });
    }

    res.json(registration);
  } catch (error) {
    console.error('❌ Error fetching registration:', error);
    res.status(500).json({ message: 'Error fetching registration' });
  }
});

// PUT /api/admin/registrations/:id/approve - Approve a registration
router.put('/registrations/:id/approve', adminAuth, async (req, res) => {
  try {
    const registration = await Registration.findById(req.params.id);

    if (!registration) {
      return res.status(404).json({ message: 'Registration not found' });
    }

    if (registration.status === 'approved') {
      return res.status(400).json({ message: 'Registration is already approved' });
    }

    registration.status = 'approved';
    registration.approvedBy = req.adminId;
    registration.approvedAt = new Date();
    registration.rejectionReason = null;

    await registration.save();

    if (process.env.NODE_ENV === 'development') {
      console.log(`✅ Registration approved: ${registration.name} (${registration.aadharNumber})`);
    }

    res.json({
      message: 'Registration approved successfully',
      registration
    });
  } catch (error) {
    console.error('❌ Error approving registration:', error);
    res.status(500).json({ message: 'Error approving registration' });
  }
});

// DELETE /api/admin/registrations/:id/reject - Reject a registration (keep in database)
router.delete('/registrations/:id/reject', adminAuth, async (req, res) => {
  try {
    console.log('DELETE reject endpoint hit - ID:', req.params.id);
    console.log('Request body:', req.body);
    
    const { reason } = req.body;

    if (!reason || reason.trim().length === 0) {
      console.log('Rejection failed: No reason provided');
      return res.status(400).json({ message: 'Rejection reason is required' });
    }

    const registration = await Registration.findById(req.params.id);
    console.log('Registration found:', registration ? 'Yes' : 'No');

    if (!registration) {
      return res.status(404).json({ message: 'Registration not found' });
    }

    if (registration.status === 'rejected') {
      return res.status(400).json({ message: 'Registration is already rejected' });
    }

    // Update status to rejected (keep in database)
    registration.status = 'rejected';
    registration.rejectionReason = reason;
    registration.rejectedAt = new Date();
    await registration.save();
    
    console.log('Registration marked as rejected (stored in database)');

    res.json({
      message: 'Registration rejected and stored',
      registration: {
        id: registration._id,
        name: registration.name,
        email: registration.email,
        aadharNumber: registration.aadharNumber,
        status: registration.status,
        rejectionReason: reason,
        rejectedAt: registration.rejectedAt
      }
    });
  } catch (error) {
    console.error('❌ Error rejecting registration:', error);
    res.status(500).json({ message: 'Error rejecting registration', error: error.message });
  }
});

// DELETE /api/admin/registrations/:id - Delete any registration permanently
router.delete('/registrations/:id', adminAuth, async (req, res) => {
  try {
    console.log('DELETE registration endpoint hit - ID:', req.params.id);
    
    const registration = await Registration.findById(req.params.id);

    if (!registration) {
      return res.status(404).json({ message: 'Registration not found' });
    }

    // Store details before deletion for logging
    const registrationName = registration.name;
    const registrationEmail = registration.email;
    const registrationStatus = registration.status;

    // Permanently delete the registration from database
    await Registration.findByIdAndDelete(req.params.id);
    console.log(`Registration deleted: ${registrationName} (${registrationEmail}) - Status: ${registrationStatus}`);

    res.json({
      message: 'Registration deleted permanently from database',
      deletedRegistration: {
        name: registrationName,
        email: registrationEmail,
        status: registrationStatus
      }
    });
  } catch (error) {
    console.error('❌ Error deleting registration:', error);
    res.status(500).json({ message: 'Error deleting registration', error: error.message });
  }
});

// ========== DASHBOARD STATS ROUTES ==========

// GET /api/admin/stats - Get dashboard statistics
router.get('/stats', adminAuth, async (req, res) => {
  try {
    const stats = {
      total: await Registration.countDocuments(),
      pending: await Registration.countDocuments({ status: 'pending' }),
      approved: await Registration.countDocuments({ status: 'approved' }),
      rejected: await Registration.countDocuments({ status: 'rejected' })
    };

    // Get recent registrations
    const recentRegistrations = await Registration.find()
      .sort({ registeredAt: -1 })
      .limit(5)
      .select('name status registeredAt');

    res.json({
      stats,
      recentRegistrations
    });
  } catch (error) {
    console.error('❌ Error fetching stats:', error);
    res.status(500).json({ message: 'Error fetching statistics' });
  }
});

// ========== ADMIN PROFILE ROUTES ==========

// GET /api/admin/profile - Get current admin profile
router.get('/profile', adminAuth, async (req, res) => {
  try {
    const admin = await Admin.findById(req.adminId);
    if (!admin) {
      return res.status(404).json({ message: 'Admin not found' });
    }
    res.json(admin.toJSON());
  } catch (error) {
    console.error('❌ Error fetching profile:', error);
    res.status(500).json({ message: 'Error fetching profile' });
  }
});

// PUT /api/admin/profile - Update admin profile
router.put('/profile', adminAuth, async (req, res) => {
  try {
    const { email, currentPassword, newPassword } = req.body;
    const admin = await Admin.findById(req.adminId);

    if (!admin) {
      return res.status(404).json({ message: 'Admin not found' });
    }

    // Update email if provided
    if (email && email !== admin.email) {
      const emailExists = await Admin.findOne({ email });
      if (emailExists) {
        return res.status(409).json({ message: 'Email already in use' });
      }
      admin.email = email;
    }

    // Update password if provided
    if (newPassword) {
      if (!currentPassword) {
        return res.status(400).json({ message: 'Current password is required to change password' });
      }

      const isPasswordValid = await admin.comparePassword(currentPassword);
      if (!isPasswordValid) {
        return res.status(401).json({ message: 'Current password is incorrect' });
      }

      if (newPassword.length < 6) {
        return res.status(400).json({ message: 'New password must be at least 6 characters' });
      }

      admin.password = newPassword;
    }

    await admin.save();

    res.json({
      message: 'Profile updated successfully',
      admin: admin.toJSON()
    });
  } catch (error) {
    console.error('❌ Error updating profile:', error);
    res.status(500).json({ message: 'Error updating profile' });
  }
});

// ========== NEWSLETTER ROUTES ==========

const Newsletter = require('../models/newsletter');

// GET /api/admin/newsletter - Get all newsletters
router.get('/newsletter', adminAuth, async (req, res) => {
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

// PATCH /api/admin/newsletter/:id - Mark newsletter as completed
router.patch('/newsletter/:id', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const newsletter = await Newsletter.findByIdAndUpdate(
      id,
      { status: 'completed' },
      { new: true }
    );

    if (!newsletter) {
      return res.status(404).json({ message: 'Newsletter not found' });
    }

    res.json({ message: 'Newsletter marked as completed', newsletter });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// DELETE /api/admin/newsletter/:id - Delete newsletter
router.delete('/newsletter/:id', adminAuth, async (req, res) => {
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
