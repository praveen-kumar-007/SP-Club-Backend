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
    const { username, password, deviceId, deviceName } = req.body;

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

    // Generate JWT token
    const token = jwt.sign(
      {
        id: admin._id,
        username: admin.username,
        email: admin.email,
        role: admin.role,
        permissions: admin.permissions,
        deviceId: deviceId || 'unknown'
      },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    // Initialize activeSessions if not exists
    if (!admin.activeSessions) {
      admin.activeSessions = [];
    }

    // Prune stale sessions older than inactivity window (5 minutes)
    const INACTIVITY_MS = 5 * 60 * 1000; // align with frontend session
    const now = Date.now();
    admin.activeSessions = admin.activeSessions.filter(s => {
      const last = new Date(s.lastActivityTime || s.loginTime).getTime();
      return now - last < INACTIVITY_MS;
    });

    // Check if device already has an active session
    const existingSessionIndex = admin.activeSessions.findIndex(s => s.deviceId === deviceId);
    
    // If this is a NEW device (not already logged in) and already 2 sessions active, REJECT
    if (existingSessionIndex === -1 && admin.activeSessions.length >= 2) {
      return res.status(429).json({ 
        message: 'Maximum 2 devices allowed. Please logout from another device first.',
        activeSessions: admin.activeSessions.length,
        maxDevices: 2,
        currentDevices: admin.activeSessions.map(s => ({
          deviceName: s.deviceName,
          loginTime: s.loginTime
        }))
      });
    }

    if (existingSessionIndex !== -1) {
      // Update existing device session (re-login on same device is allowed)
      admin.activeSessions[existingSessionIndex].token = token;
      admin.activeSessions[existingSessionIndex].loginTime = new Date();
      admin.activeSessions[existingSessionIndex].lastActivityTime = new Date();
    } else {
      // Add new device session
      admin.activeSessions.push({
        deviceId: deviceId || `device_${Date.now()}`,
        deviceName: deviceName || 'Unknown Device',
        token: token,
        loginTime: new Date(),
        lastActivityTime: new Date()
      });
    }

    // Update last login
    admin.lastLogin = new Date();
    await admin.save();

    if (process.env.NODE_ENV === 'development') {
      console.log(`✅ Admin logged in: ${username} from device: ${deviceName || 'Unknown'}`);
      console.log(`   Active sessions: ${admin.activeSessions.length}/2`);
    }

    res.json({
      message: 'Login successful',
      token,
      admin: admin.toJSON(),
      activeSessions: admin.activeSessions.length
    });
  } catch (error) {
    console.error('❌ Login error:', error);
    res.status(500).json({ message: 'Error logging in' });
  }
});

// POST /api/admin/logout - Admin logout (optional - mainly for frontend)
router.post('/logout', adminAuth, async (req, res) => {
  try {
    const { deviceId } = req.body;
    const adminId = req.admin.id;

    // Find admin and remove the device session
    const admin = await Admin.findById(adminId);
    if (!admin) {
      return res.status(404).json({ message: 'Admin not found' });
    }

    if (!admin.activeSessions) {
      admin.activeSessions = [];
    }

    // Remove the session for this device
    admin.activeSessions = admin.activeSessions.filter(s => s.deviceId !== deviceId);
    await admin.save();

    if (process.env.NODE_ENV === 'development') {
      console.log(`✅ Admin logged out: ${admin.username} from device: ${deviceId}`);
      console.log(`   Remaining active sessions: ${admin.activeSessions.length}/2`);
    }

    res.json({ 
      message: 'Logged out successfully',
      remainingSessions: admin.activeSessions.length
    });
  } catch (error) {
    console.error('❌ Logout error:', error);
    res.status(500).json({ message: 'Error logging out' });
  }
});

// ========== REGISTRATION MANAGEMENT ROUTES ==========

// GET /api/admin/registrations - Fetch registrations with pagination and filters (optimized)
router.get('/registrations', adminAuth, async (req, res) => {
  try {
    const { status = 'pending', page = 1, limit = 10, search = '', ageGroup = 'all' } = req.query;

    let query = {};
    
    // Filter by status
    if (status && status !== 'all') {
      query.status = status;
    }

    // Filter by computed age group via DOB
    if (ageGroup && ageGroup !== 'all') {
      const today = new Date();
      const start = new Date(today);
      const end = new Date(today);

      const setRange = (minAge, maxAgeExclusive) => {
        const maxDate = new Date(today);
        maxDate.setFullYear(today.getFullYear() - minAge);
        const minDate = new Date(today);
        minDate.setFullYear(today.getFullYear() - maxAgeExclusive);
        return { $gte: minDate, $lt: maxDate };
      };

      switch (ageGroup) {
        case 'Under 10':
          query.dob = setRange(0, 10);
          break;
        case '10-14':
          query.dob = setRange(10, 14);
          break;
        case '14-16':
          query.dob = setRange(14, 16);
          break;
        case '16-19':
          query.dob = setRange(16, 19);
          break;
        case '19-25':
          query.dob = setRange(19, 25);
          break;
        case 'Over 25':
          // Anyone older than or equal to 25
          const cutoff = new Date(today);
          cutoff.setFullYear(today.getFullYear() - 25);
          query.dob = { $lt: cutoff };
          break;
        default:
          // ignore unknown ageGroup
          break;
      }
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
    const limitNum = Math.min(parseInt(limit) || 10, 100); // Cap limit at 100
    
    // Optimize: Only fetch needed fields to reduce data transfer & improve performance
    // Use lean() for faster queries (returns plain objects, not mongoose docs)
    const registrations = await Registration.find(query)
      .select('_id name email phone parentsPhone role bloodGroup status photo registeredAt aadharNumber dob')
      .sort({ registeredAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean();

    const total = await Registration.countDocuments(query);
    const pages = Math.ceil(total / limitNum);

    res.json({
      registrations,
      pagination: {
        total,
        pages,
        currentPage: parseInt(page),
        limit: limitNum
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
    console.log('🔄 Approval request received for registration ID:', req.params.id);
    
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
    console.log('✅ Registration status updated to approved in database');

    res.json({
      message: 'Registration approved successfully',
      registration
    });
  } catch (error) {
    console.error('❌ Error approving registration:', error);
    res.status(500).json({ message: 'Error approving registration', error: error.message });
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
      message: 'Registration rejected successfully',
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

// GET /api/admin/stats - Get dashboard statistics (optimized)
router.get('/stats', adminAuth, async (req, res) => {
  try {
    // Use a single aggregation pipeline instead of multiple countDocuments calls
    const stats = await Registration.aggregate([
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          pending: {
            $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] }
          },
          approved: {
            $sum: { $cond: [{ $eq: ['$status', 'approved'] }, 1, 0] }
          },
          rejected: {
            $sum: { $cond: [{ $eq: ['$status', 'rejected'] }, 1, 0] }
          }
        }
      }
    ]);

    const result = stats[0] || { total: 0, pending: 0, approved: 0, rejected: 0 };

    res.json({
      stats: result
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
