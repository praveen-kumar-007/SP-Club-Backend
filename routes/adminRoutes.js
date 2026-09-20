// routes/adminRoutes.js
const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const Admin = require("../models/admin");
const Registration = require("../models/registration");
const PlayerMessage = require("../models/playerMessage");
const Contact = require("../models/contact");
const { cloudinary, upload, uploadDoc } = require("../config/cloudinary");
const {
  getMailSettings,
  setMailEnabled,
  sendApprovalMail,
  sendCustomAdminMail,
  sendAdminPasswordOtpMail,
  sendNocInitiatedMail,
  sendNocGeneratedMail,
  sendNocRejectedMail,
  sendNocRecoveryLinkMail,
  sendNocRecoveryApprovedMail,
  sendApplicationRejectedMail,
  sendPendingVerificationReminderMail,
  sendApplicationProcessingMail,
  sendBirthdayFollowupMail,
} = require("../services/brevoMailer");
const {
  processPendingRegistrations,
} = require("../services/pendingVerificationService");
const {
  checkAndSendBirthdayFollowups,
} = require("../services/birthdayService");
const { adminAuth, checkPermission } = require("../middleware/adminAuth");

const ADMIN_JWT_SECRET =
  process.env.ADMIN_JWT_SECRET ||
  process.env.JWT_SECRET ||
  "sp_club_admin_secret_key_2024";
const MAX_ADMIN_DEVICES = 15;

const normalizePhone = (phoneValue) => {
  const digits = String(phoneValue || "").replace(/\D/g, "");

  if (digits.startsWith("91") && digits.length === 12) {
    return digits.slice(2);
  }

  if (digits.startsWith("0") && digits.length === 11) {
    return digits.slice(1);
  }

  return digits;
};

const generateOtp = () => String(Math.floor(100000 + Math.random() * 900000));

const getClientIp = (req) => {
  const forwarded = req.headers["x-forwarded-for"];

  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded
      .split(",")[0]
      .trim()
      .replace(/^::ffff:/, "");
  }

  if (Array.isArray(forwarded) && forwarded.length > 0) {
    return String(forwarded[0] || "unknown").replace(/^::ffff:/, "");
  }

  const fallbackIp = req.ip || req.socket?.remoteAddress || "unknown";
  return String(fallbackIp).replace(/^::ffff:/, "");
};

const extractCloudinaryPublicId = (url) => {
  if (!url || typeof url !== "string") return null;

  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname;
    const marker = "/upload/";
    const markerIndex = pathname.indexOf(marker);

    if (markerIndex === -1) return null;

    const afterUpload = pathname.slice(markerIndex + marker.length);
    const segments = afterUpload.split("/").filter(Boolean);

    let startIndex = 0;
    if (segments[0] && /^v\d+$/.test(segments[0])) {
      startIndex = 1;
    }

    const publicIdWithExtension = segments.slice(startIndex).join("/");
    if (!publicIdWithExtension) return null;

    return publicIdWithExtension.replace(/\.[^.]+$/, "");
  } catch {
    return null;
  }
};

const parseBoolean = (value) => {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return null;

  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes"].includes(normalized)) return true;
  if (["false", "0", "no"].includes(normalized)) return false;
  return null;
};

// ========== AUTHENTICATION ROUTES ==========

// POST /api/admin/register - Create first admin (Super Admin setup)
router.post("/register", async (req, res) => {
  try {
    const { username, email, password, confirmPassword } = req.body;

    // Validate input
    if (!username || !email || !password || !confirmPassword) {
      return res.status(400).json({ message: "All fields are required" });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ message: "Passwords do not match" });
    }

    if (password.length < 6) {
      return res
        .status(400)
        .json({ message: "Password must be at least 6 characters" });
    }

    // Check if admin already exists
    const existingAdmin = await Admin.findOne({
      $or: [{ username }, { email }],
    });
    if (existingAdmin) {
      return res
        .status(409)
        .json({ message: "Admin with this username or email already exists" });
    }

    // Determine role - first admin is super_admin
    const adminCount = await Admin.countDocuments();
    const role = adminCount === 0 ? "super_admin" : "admin";

    // Create new admin
    const newAdmin = new Admin({
      username,
      email,
      password,
      role,
      permissions: {
        canApprove: true,
        canReject: true,
        canDelete: role === "super_admin",
        canManageAdmins: role === "super_admin",
      },
    });

    await newAdmin.save();

    if (process.env.NODE_ENV === "development") {
      console.log(`✅ New ${role} created: ${username}`);
    }

    res.status(201).json({
      message: `Admin account created successfully (Role: ${role})`,
      admin: newAdmin.toJSON(),
    });
  } catch (error) {
    console.error("❌ Admin registration error:", error);
    res.status(500).json({ message: "Error creating admin account" });
  }
});

// POST /api/admin/login - Admin login
router.post("/login", async (req, res) => {
  try {
    const { username, password, deviceId, deviceName } = req.body;
    const clientIp = getClientIp(req);
    const userAgent = String(req.headers["user-agent"] || "");

    if (!username || !password) {
      return res
        .status(400)
        .json({ message: "Username and password are required" });
    }

    // Find admin
    const admin = await Admin.findOne({
      $or: [{ username }, { email: username }],
    });
    if (!admin) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    if (!admin.isActive) {
      return res.status(403).json({ message: "Your account is deactivated" });
    }

    // Check password
    const isPasswordValid = await admin.comparePassword(password);
    if (!isPasswordValid) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    // Generate JWT token
    const token = jwt.sign(
      {
        id: admin._id,
        username: admin.username,
        email: admin.email,
        role: admin.role,
        permissions: admin.permissions,
        deviceId: deviceId || "unknown",
      },
      ADMIN_JWT_SECRET,
      { expiresIn: "24h" },
    );

    // Initialize activeSessions if not exists
    if (!admin.activeSessions) {
      admin.activeSessions = [];
    }

    // Automatically purge expired sessions (JWT tokens expire in 24 hours)
    const nowMs = Date.now();
    const SESSION_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours
    admin.activeSessions = admin.activeSessions.filter((s) => {
      const lastActivity = s.lastActivityTime ? new Date(s.lastActivityTime).getTime() : 0;
      const login = s.loginTime ? new Date(s.loginTime).getTime() : 0;
      const effectiveTime = Math.max(lastActivity, login);
      return (nowMs - effectiveTime) < SESSION_EXPIRY_MS;
    });

    // Check if device already has an active session
    const existingSessionIndex = admin.activeSessions.findIndex(
      (s) => s.deviceId === deviceId,
    );

    // If this is a NEW device and still at or above device cap, evict oldest session (FIFO)
    // so legitimate administrators are never locked out of their accounts.
    if (
      existingSessionIndex === -1 &&
      admin.activeSessions.length >= MAX_ADMIN_DEVICES
    ) {
      admin.activeSessions.sort((a, b) => {
        const timeA = Math.max(
          a.lastActivityTime ? new Date(a.lastActivityTime).getTime() : 0,
          a.loginTime ? new Date(a.loginTime).getTime() : 0
        );
        const timeB = Math.max(
          b.lastActivityTime ? new Date(b.lastActivityTime).getTime() : 0,
          b.loginTime ? new Date(b.loginTime).getTime() : 0
        );
        return timeA - timeB;
      });
      while (admin.activeSessions.length >= MAX_ADMIN_DEVICES) {
        admin.activeSessions.shift();
      }
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
        deviceName: deviceName || "Unknown Device",
        token: token,
        loginTime: new Date(),
        lastActivityTime: new Date(),
      });
    }

    // Update last login
    admin.lastLogin = new Date();
    admin.loginHistory = [
      ...(Array.isArray(admin.loginHistory) ? admin.loginHistory : []),
      {
        ipAddress: clientIp,
        userAgent,
        deviceId: deviceId || null,
        deviceName: deviceName || "Unknown Device",
        loggedInAt: new Date(),
      },
    ].slice(-2);
    await admin.save();

    if (process.env.NODE_ENV === "development") {
      console.log(
        `✅ Admin logged in: ${username} from device: ${deviceName || "Unknown"}`,
      );
      console.log(
        `   Active sessions: ${admin.activeSessions.length}/${MAX_ADMIN_DEVICES}`,
      );
    }

    res.json({
      message: "Login successful",
      token,
      admin: admin.toJSON(),
      activeSessions: admin.activeSessions.length,
    });
  } catch (error) {
    console.error("❌ Login error:", error);
    res.status(500).json({ message: "Error logging in" });
  }
});

// POST /api/admin/password/forgot/request - Request OTP for admin password reset
router.post("/password/forgot/request", async (req, res) => {
  try {
    const { usernameOrEmail } = req.body;

    if (!usernameOrEmail) {
      return res.status(400).json({ message: "usernameOrEmail is required" });
    }

    const value = String(usernameOrEmail).trim();
    const admin = await Admin.findOne({
      $or: [{ username: value.toLowerCase() }, { email: value.toLowerCase() }],
    });

    // Generic response for security
    if (!admin) {
      return res.json({
        message: "If account exists, OTP has been sent to registered email",
      });
    }

    const otp = generateOtp();
    const otpHash = await bcrypt.hash(otp, 10);

    admin.passwordResetOtpHash = otpHash;
    admin.passwordResetOtpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
    admin.passwordResetRequestedAt = new Date();
    await admin.save();

    const mailResult = await sendAdminPasswordOtpMail({
      email: admin.email,
      name: admin.username,
      otp,
    });

    if (mailResult?.skipped && mailResult.reason === "disabled") {
      return res.status(503).json({
        message:
          "Mail service is currently disabled. Please contact super admin.",
      });
    }

    return res.json({
      message: "If account exists, OTP has been sent to registered email",
    });
  } catch (error) {
    console.error("Admin forgot password request error:", error);
    return res.status(500).json({ message: "Failed to send OTP" });
  }
});

// POST /api/admin/password/forgot/reset - Reset admin password using OTP
router.post("/password/forgot/reset", async (req, res) => {
  try {
    const { usernameOrEmail, otp, newPassword } = req.body;

    if (!usernameOrEmail || !otp || !newPassword) {
      return res
        .status(400)
        .json({ message: "usernameOrEmail, otp and newPassword are required" });
    }

    if (String(newPassword).length < 6) {
      return res
        .status(400)
        .json({ message: "New password must be at least 6 characters" });
    }

    const value = String(usernameOrEmail).trim();
    const admin = await Admin.findOne({
      $or: [{ username: value.toLowerCase() }, { email: value.toLowerCase() }],
    });

    if (!admin) {
      return res
        .status(400)
        .json({ message: "Invalid OTP or account details" });
    }

    if (!admin.passwordResetOtpHash || !admin.passwordResetOtpExpiresAt) {
      return res.status(400).json({ message: "OTP not requested or expired" });
    }

    if (new Date(admin.passwordResetOtpExpiresAt).getTime() < Date.now()) {
      return res
        .status(400)
        .json({ message: "OTP has expired. Request a new OTP." });
    }

    const otpMatches = await bcrypt.compare(
      String(otp).trim(),
      admin.passwordResetOtpHash,
    );
    if (!otpMatches) {
      return res
        .status(400)
        .json({ message: "Invalid OTP or account details" });
    }

    admin.password = String(newPassword);
    admin.passwordResetOtpHash = null;
    admin.passwordResetOtpExpiresAt = null;
    admin.passwordResetRequestedAt = null;
    admin.activeSessions = [];
    await admin.save();

    return res.json({
      message: "Password reset successful. Please login again on all devices.",
    });
  } catch (error) {
    console.error("Admin forgot password reset error:", error);
    return res.status(500).json({ message: "Failed to reset password" });
  }
});

// POST /api/admin/logout - Admin logout (supports standard auth header and screen-close sendBeacon)
router.post("/logout", async (req, res) => {
  try {
    const token = req.headers.authorization?.split(" ")[1] || req.body?.token;
    const { deviceId } = req.body || {};

    let adminId = null;
    if (token) {
      try {
        const decoded = jwt.verify(token, ADMIN_JWT_SECRET);
        adminId = decoded.id;
      } catch (err) {
        // Token expired or invalid
      }
    }

    if (adminId) {
      const admin = await Admin.findById(adminId);
      if (admin && admin.activeSessions) {
        if (deviceId) {
          admin.activeSessions = admin.activeSessions.filter(
            (s) => s.deviceId !== deviceId,
          );
        } else {
          admin.activeSessions = [];
        }
        await admin.save();
      }
    } else if (deviceId) {
      await Admin.updateMany(
        { "activeSessions.deviceId": deviceId },
        { $pull: { activeSessions: { deviceId } } },
      );
    }

    return res.json({
      message: "Logged out successfully",
    });
  } catch (error) {
    console.error("❌ Logout error:", error);
    return res.status(500).json({ message: "Error logging out" });
  }
});

// ========== REGISTRATION MANAGEMENT ROUTES ==========

// GET /api/admin/registrations - Fetch registrations with pagination and filters (optimized)
router.get("/registrations", adminAuth, async (req, res) => {
  try {
    const {
      status = "pending",
      page = 1,
      limit = 10,
      search = "",
      ageGroup = "all",
      gender = "all",
    } = req.query;

    let query = {};

    // Filter by status
    if (status && status !== "all") {
      query.status = status;
    }

    // Filter by computed age group via DOB
    if (ageGroup && ageGroup !== "all") {
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
        case "Under 10":
          query.dob = setRange(0, 10);
          break;
        case "10-14":
          query.dob = setRange(10, 14);
          break;
        case "14-16":
          query.dob = setRange(14, 16);
          break;
        case "16-19":
          query.dob = setRange(16, 19);
          break;
        case "19-25":
          query.dob = setRange(19, 25);
          break;
        case "Over 25":
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

    if (gender && gender !== "all" && gender !== "both") {
      const g = gender.toLowerCase();
      if (g === "boy's" || g === "boys") {
        query.gender = "male";
      } else if (g === "girl's" || g === "girls") {
        query.gender = "female";
      } else {
        query.gender = g;
      }
    }

    // Search by name, email, Aadhar, kit or jersey number
    if (search) {
      const regex = { $regex: search, $options: "i" };
      query.$or = [
        { name: regex },
        { email: regex },
        { aadharNumber: regex },
        { kitSize: regex },
      ];

      const jersey = Number(search);
      if (!Number.isNaN(jersey) && Number.isInteger(jersey)) {
        query.$or.push({ jerseyNumber: jersey });
      }
    }

    const skip = (page - 1) * limit;
    const limitNum = Math.min(parseInt(limit) || 10, 100); // Cap limit at 100

    // Optimize: Only fetch needed fields to reduce data transfer & improve performance
    // Use lean() for faster queries (returns plain objects, not mongoose docs)
    const registrations = await Registration.find(query)
      .select(
        "_id name email phone parentsPhone role bloodGroup status photo registeredAt aadharNumber dob",
      )
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
        limit: limitNum,
      },
    });
  } catch (error) {
    console.error("❌ Error fetching registrations:", error);
    res.status(500).json({ message: "Error fetching registrations" });
  }
});

// GET /api/admin/registrations/:id - Get single registration details
router.get("/registrations/:id", adminAuth, async (req, res) => {
  try {
    const registration = await Registration.findById(req.params.id).populate(
      "approvedBy",
      "username email",
    );

    if (!registration) {
      return res.status(404).json({ message: "Registration not found" });
    }

    res.json(registration);
  } catch (error) {
    console.error("❌ Error fetching registration:", error);
    res.status(500).json({ message: "Error fetching registration" });
  }
});

router.put(
  "/registrations/:id",
  adminAuth,
  upload.fields([
    { name: "photo", maxCount: 1 },
    { name: "aadharFront", maxCount: 1 },
    { name: "aadharBack", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const {
        name,
        fathersName,
        email,
        phone,
        parentsPhone,
        gender,
        bloodGroup,
        role,
        dob,
        aadharNumber,
        address,
        clubDetails,
        message,
        kabaddiPositions,
        newsletter,
        terms,
        kitSize,
        jerseyNumber,
        idCardNumber,
        idCardRole,
        oldPhoto,
        oldAadharFront,
        oldAadharBack,
      } = req.body || {};

      const files = req.files || {};

      const registration = await Registration.findById(req.params.id);
      if (!registration) {
        return res.status(404).json({ message: "Registration not found" });
      }

      if (name !== undefined) registration.name = String(name).trim();
      if (fathersName !== undefined)
        registration.fathersName = String(fathersName).trim();
      if (email !== undefined) registration.email = String(email).trim();
      if (phone !== undefined) registration.phone = String(phone).trim();
      if (parentsPhone !== undefined)
        registration.parentsPhone = String(parentsPhone).trim();

      if (gender !== undefined) {
        const normalizedGender = String(gender).trim().toLowerCase();
        if (!["male", "female", "other"].includes(normalizedGender)) {
          return res.status(400).json({ message: "Invalid gender value." });
        }
        registration.gender = normalizedGender;
      }

      if (bloodGroup !== undefined) {
        const normalizedBloodGroup = String(bloodGroup).trim().toUpperCase();
        const validBloodGroups = [
          "A+",
          "A-",
          "B+",
          "B-",
          "AB+",
          "AB-",
          "O+",
          "O-",
        ];
        if (!validBloodGroups.includes(normalizedBloodGroup)) {
          return res
            .status(400)
            .json({ message: "Invalid blood group value." });
        }
        registration.bloodGroup = normalizedBloodGroup;
      }

      if (role !== undefined) registration.role = String(role).trim();

      if (idCardRole !== undefined) {
        const normalizedIdCardRole = String(idCardRole || "").trim();
        registration.idCardRole = normalizedIdCardRole || null;
      }

      if (idCardNumber !== undefined) {
        const normalizedIdCardNumber = String(idCardNumber || "").trim();

        if (normalizedIdCardNumber) {
          const duplicateIdCard = await Registration.findOne({
            _id: { $ne: registration._id },
            idCardNumber: normalizedIdCardNumber,
          });

          if (duplicateIdCard) {
            return res.status(409).json({
              message:
                "ID card number is already assigned to another registration.",
            });
          }

          registration.idCardNumber = normalizedIdCardNumber;
          if (!registration.idCardGeneratedAt) {
            registration.idCardGeneratedAt =
              registration.registeredAt || new Date();
          }
        }
      }

      if (dob !== undefined) {
        const parsedDob = new Date(dob);
        if (Number.isNaN(parsedDob.getTime())) {
          return res.status(400).json({ message: "Invalid date of birth." });
        }
        registration.dob = parsedDob;
      }

      if (aadharNumber !== undefined) {
        const sanitizedAadhar = String(aadharNumber).trim();
        if (!/^\d{12}$/.test(sanitizedAadhar)) {
          return res
            .status(400)
            .json({ message: "Aadhar number must be exactly 12 digits." });
        }

        if (sanitizedAadhar !== registration.aadharNumber) {
          const existingAadhar = await Registration.findOne({
            _id: { $ne: registration._id },
            aadharNumber: sanitizedAadhar,
          });

          if (existingAadhar) {
            return res
              .status(409)
              .json({
                message:
                  "Aadhar number already exists for another registration.",
              });
          }
        }

        registration.aadharNumber = sanitizedAadhar;
      }

      if (address !== undefined) registration.address = String(address).trim();
      if (clubDetails !== undefined)
        registration.clubDetails = String(clubDetails).trim();
      if (message !== undefined) registration.message = String(message).trim();

      if (kabaddiPositions !== undefined) {
        let positions = [];

        if (Array.isArray(kabaddiPositions)) {
          positions = kabaddiPositions;
        } else if (typeof kabaddiPositions === "string") {
          const raw = kabaddiPositions.trim();
          if (raw.startsWith("[")) {
            try {
              const parsed = JSON.parse(raw);
              if (Array.isArray(parsed)) {
                positions = parsed;
              }
            } catch {
              positions = raw.split(",");
            }
          } else {
            positions = raw ? raw.split(",") : [];
          }
        }

        registration.kabaddiPositions = positions
          .map((item) => String(item || "").trim())
          .filter(Boolean);
      }

      const parsedNewsletter = parseBoolean(newsletter);
      if (parsedNewsletter !== null) {
        registration.newsletter = parsedNewsletter;
      }

      const parsedTerms = parseBoolean(terms);
      if (parsedTerms !== null) {
        registration.terms = parsedTerms;
      }

      if (kitSize !== undefined) {
        const nextKit =
          typeof kitSize === "string"
            ? kitSize.trim() || null
            : registration.kitSize;
        if (nextKit !== registration.kitSize) {
          registration.kitSize = nextKit;
          registration.kitSizeSelectedAt = nextKit
            ? registration.kitSizeSelectedAt || new Date()
            : null;
        }
      }

      if (jerseyNumber !== undefined) {
        if (jerseyNumber === null || jerseyNumber === "") {
          registration.jerseyNumber = null;
          registration.jerseyAssignedAt = null;
        } else {
          const jersey = Number(jerseyNumber);
          if (!Number.isInteger(jersey) || jersey < 1 || jersey > 99) {
            return res.status(400).json({
              message: "Jersey number must be a whole number between 1 and 99.",
            });
          }

          const duplicate = await Registration.findOne({
            _id: { $ne: registration._id },
            gender: registration.gender,
            jerseyNumber: jersey,
          });

          if (duplicate) {
            return res.status(409).json({
              message:
                "This jersey number is already assigned to another player of the same gender.",
            });
          }

          if (registration.jerseyNumber !== jersey) {
            registration.jerseyNumber = jersey;
            registration.jerseyAssignedAt =
              registration.jerseyAssignedAt || new Date();
          }
        }
      }

      const oldPhotoUrl = registration.photo;
      const oldAadharFrontUrl = registration.aadharFront;
      const oldAadharBackUrl = registration.aadharBack;

      const newPhotoUrl = files.photo?.[0]?.path || null;
      const newAadharFrontUrl = files.aadharFront?.[0]?.path || null;
      const newAadharBackUrl = files.aadharBack?.[0]?.path || null;

      if (newPhotoUrl) registration.photo = newPhotoUrl;
      if (newAadharFrontUrl) registration.aadharFront = newAadharFrontUrl;
      if (newAadharBackUrl) registration.aadharBack = newAadharBackUrl;

      await registration.save();

      const cleanupTargets = [];

      if (newPhotoUrl) {
        cleanupTargets.push({
          oldUrl: oldPhoto || oldPhotoUrl,
          newUrl: newPhotoUrl,
        });
      }
      if (newAadharFrontUrl) {
        cleanupTargets.push({
          oldUrl: oldAadharFront || oldAadharFrontUrl,
          newUrl: newAadharFrontUrl,
        });
      }
      if (newAadharBackUrl) {
        cleanupTargets.push({
          oldUrl: oldAadharBack || oldAadharBackUrl,
          newUrl: newAadharBackUrl,
        });
      }

      for (const target of cleanupTargets) {
        const oldPublicId = extractCloudinaryPublicId(target.oldUrl);
        const newPublicId = extractCloudinaryPublicId(target.newUrl);

        if (oldPublicId && oldPublicId !== newPublicId) {
          try {
            await cloudinary.uploader.destroy(oldPublicId, {
              resource_type: "image",
            });
          } catch (cleanupError) {
            console.warn(
              "Cloudinary cleanup failed for old asset:",
              oldPublicId,
              cleanupError?.message || cleanupError,
            );
          }
        }
      }

      return res.json({
        message: "Registration updated successfully",
        registration,
      });
    } catch (error) {
      console.error("❌ Error updating registration:", error);
      res.status(500).json({ message: "Error updating registration" });
    }
  },
);

// PUT /api/admin/registrations/:id/approve - Approve a registration
router.put("/registrations/:id/approve", adminAuth, async (req, res) => {
  try {
    console.log(
      "🔄 Approval request received for registration ID:",
      req.params.id,
    );

    const registration = await Registration.findById(req.params.id);

    if (!registration) {
      return res.status(404).json({ message: "Registration not found" });
    }

    if (registration.status === "approved") {
      return res
        .status(400)
        .json({ message: "Registration is already approved" });
    }

    const defaultPassword = normalizePhone(registration.phone);
    if (!defaultPassword) {
      return res.status(400).json({
        message:
          "Phone number is required before approval to set default player password",
      });
    }

    const passwordHash = await bcrypt.hash(defaultPassword, 10);

    registration.status = "approved";
    registration.approvedBy = req.adminId;
    registration.approvedAt = new Date();
    registration.rejectionReason = null;
    registration.playerPasswordHash = passwordHash;
    registration.playerPasswordSetAt = new Date();
    registration.playerPasswordResetOtpHash = null;
    registration.playerPasswordResetOtpExpiresAt = null;
    registration.playerPasswordResetRequestedAt = null;
    registration.playerFailedLoginAttempts = 0;
    registration.playerForcePasswordReset = false;
    registration.playerLastFailedLoginAt = null;

    await registration.save();
    console.log("✅ Registration status updated to approved in database");

    // Send approval email asynchronously (does not block API success)
    sendApprovalMail(registration, { initialPassword: defaultPassword }).catch(
      (mailError) => {
        console.error(
          "Approval email send failed:",
          mailError?.message || mailError,
        );
      },
    );

    res.json({
      message: "Registration approved successfully",
      registration,
    });
  } catch (error) {
    console.error("❌ Error approving registration:", error);
    res
      .status(500)
      .json({ message: "Error approving registration", error: error.message });
  }
});

// ========== MAIL SETTINGS & ADMIN MAIL ROUTES ==========

// GET /api/admin/mail/settings - Get mail toggle status
router.get("/mail/settings", adminAuth, async (req, res) => {
  try {
    const settings = await getMailSettings();

    return res.json({
      enabled: Boolean(settings.enabled),
      updatedAt: settings.updatedAt,
      updatedBy: settings.updatedBy,
    });
  } catch (error) {
    console.error("Error fetching mail settings:", error);
    return res.status(500).json({ message: "Failed to fetch mail settings" });
  }
});

// PATCH /api/admin/mail/settings - Toggle mail sending on/off
router.patch("/mail/settings", adminAuth, async (req, res) => {
  try {
    const { enabled } = req.body;

    if (typeof enabled !== "boolean") {
      return res.status(400).json({ message: "enabled must be a boolean" });
    }

    const settings = await setMailEnabled({ enabled, adminId: req.adminId });

    return res.json({
      message: `Mail sending ${settings.enabled ? "enabled" : "disabled"} successfully`,
      enabled: Boolean(settings.enabled),
      updatedAt: settings.updatedAt,
    });
  } catch (error) {
    console.error("Error updating mail settings:", error);
    return res.status(500).json({ message: "Failed to update mail settings" });
  }
});

const parseEmailRecipients = (input, fieldName = "Email") => {
  if (!input) return { emails: [] };
  let rawList = [];
  if (Array.isArray(input)) {
    rawList = input;
  } else if (typeof input === "string") {
    rawList = input.split(/[,;\n\r]+/).map((s) => s.trim()).filter(Boolean);
  } else {
    return {
      error: `${fieldName} must be a comma-separated string or array of emails`,
    };
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const emails = [];
  const seen = new Set();

  for (const item of rawList) {
    let email = "";
    let name = "";

    if (typeof item === "string") {
      email = item.trim();
    } else if (item && typeof item === "object" && item.email) {
      email = String(item.email).trim();
      name = item.name ? String(item.name).trim() : "";
    }

    if (!email) continue;

    if (!emailRegex.test(email)) {
      return { error: `Invalid email address in ${fieldName}: "${email}"` };
    }

    const lower = email.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      emails.push(name ? { email, name } : { email });
    }
  }

  return { emails };
};

// POST /api/admin/mail/send - Send branded mail to all or selected approved players
router.post("/mail/send", adminAuth, async (req, res) => {
  try {
    const { mode, playerIds, cc, bcc, attachments, subject, message } = req.body;

    if (!subject || !message) {
      return res
        .status(400)
        .json({ message: "subject and message are required" });
    }

    if (!mode || !["all", "selected"].includes(mode)) {
      return res.status(400).json({ message: "mode must be all or selected" });
    }

    let parsedCc = [];
    if (cc) {
      const ccResult = parseEmailRecipients(cc, "CC");
      if (ccResult.error) {
        return res.status(400).json({ message: ccResult.error });
      }
      parsedCc = ccResult.emails;
    }

    let parsedBcc = [];
    if (bcc) {
      const bccResult = parseEmailRecipients(bcc, "BCC");
      if (bccResult.error) {
        return res.status(400).json({ message: bccResult.error });
      }
      parsedBcc = bccResult.emails;
    }

    let validAttachments = [];
    if (attachments) {
      if (!Array.isArray(attachments)) {
        return res
          .status(400)
          .json({ message: "attachments must be an array" });
      }
      for (const att of attachments) {
        if (
          !att ||
          typeof att !== "object" ||
          !att.name ||
          (!att.content && !att.url)
        ) {
          return res.status(400).json({
            message: "Each attachment must have a valid name and content/url",
          });
        }
      }
      validAttachments = attachments;
    }

    let query = { status: "approved" };
    if (mode === "selected") {
      if (!Array.isArray(playerIds) || playerIds.length === 0) {
        return res
          .status(400)
          .json({ message: "playerIds are required for selected mode" });
      }

      query = {
        status: "approved",
        _id: { $in: playerIds },
      };
    }

    const players = await Registration.find(query).select("name email").lean();

    const recipients = players
      .filter((p) => p.email)
      .map((p) => ({ email: p.email, name: p.name || "Player" }));

    if (!recipients.length) {
      return res.status(400).json({ message: "No eligible recipients found" });
    }

    const htmlBody = `<p>${String(message).replace(/\n/g, "<br/>")}</p>`;

    const result = await sendCustomAdminMail({
      recipients,
      cc: parsedCc.length ? parsedCc : undefined,
      bcc: parsedBcc.length ? parsedBcc : undefined,
      attachments: validAttachments.length ? validAttachments : undefined,
      subject: String(subject).trim(),
      messageHtml: htmlBody,
      messageText: String(message),
    });

    if (result?.skipped && result.reason === "disabled") {
      return res.status(400).json({
        message: "Mail sending is currently disabled from admin toggle",
      });
    }

    const ccPart = parsedCc.length ? ` (${parsedCc.length} CC)` : "";
    const bccPart = parsedBcc.length ? ` (${parsedBcc.length} BCC)` : "";
    const attPart = validAttachments.length
      ? ` [${validAttachments.length} attachment(s)]`
      : "";

    return res.json({
      message: `Mail sent to ${recipients.length} recipient(s)${ccPart}${bccPart}${attPart}`,
      recipientsCount: recipients.length,
      ccCount: parsedCc.length,
      bccCount: parsedBcc.length,
      attachmentsCount: validAttachments.length,
    });
  } catch (error) {
    console.error("Error sending admin bulk mail:", error);
    return res
      .status(500)
      .json({ message: "Failed to send mail", error: error.message });
  }
});

// DELETE /api/admin/registrations/:id/reject - Reject a registration (keep in database)
router.delete("/registrations/:id/reject", adminAuth, async (req, res) => {
  try {
    console.log("DELETE reject endpoint hit - ID:", req.params.id);
    console.log("Request body:", req.body);

    const { reason } = req.body;

    if (!reason || reason.trim().length === 0) {
      console.log("Rejection failed: No reason provided");
      return res.status(400).json({ message: "Rejection reason is required" });
    }

    const registration = await Registration.findById(req.params.id);
    console.log("Registration found:", registration ? "Yes" : "No");

    if (!registration) {
      return res.status(404).json({ message: "Registration not found" });
    }

    if (registration.status === "rejected") {
      return res
        .status(400)
        .json({ message: "Registration is already rejected" });
    }

    // Update status to rejected (keep in database)
    registration.status = "rejected";
    registration.rejectionReason = reason;
    registration.rejectedAt = new Date();
    await registration.save();

    console.log("Registration marked as rejected (stored in database)");

    // Send formal rejection mail asynchronously
    sendApplicationRejectedMail(registration, reason).catch((mailError) => {
      console.error(
        "Rejection email send failed:",
        mailError?.message || mailError,
      );
    });

    res.json({
      message: "Registration rejected successfully",
      registration: {
        id: registration._id,
        name: registration.name,
        email: registration.email,
        aadharNumber: registration.aadharNumber,
        status: registration.status,
        rejectionReason: reason,
        rejectedAt: registration.rejectedAt,
      },
    });
  } catch (error) {
    console.error("❌ Error rejecting registration:", error);
    res
      .status(500)
      .json({ message: "Error rejecting registration", error: error.message });
  }
});

// POST /api/admin/process-pending-verifications - Trigger pending document verification check & 30-day auto-rejections manually
router.post("/process-pending-verifications", adminAuth, async (req, res) => {
  try {
    console.log(
      "🔄 Manual trigger of pending verification & auto-rejection sweep initiated by admin:",
      req.adminId,
    );
    const summary = await processPendingRegistrations();
    return res.json({
      message: "Pending verification sweep completed successfully",
      summary,
    });
  } catch (error) {
    console.error(
      "❌ Error executing manual pending verification check:",
      error,
    );
    return res.status(500).json({
      message: "Failed to process pending verifications",
      error: error.message,
    });
  }
});

// POST /api/admin/mail/process-birthdays - Trigger birthday follow-up sweep in Indian Standard Time (IST)
router.post("/mail/process-birthdays", adminAuth, async (req, res) => {
  try {
    const summary = await checkAndSendBirthdayFollowups(new Date());
    return res.json({
      message: "Birthday check completed in Indian Standard Time (IST)",
      summary,
    });
  } catch (error) {
    console.error("❌ Error executing manual birthday check:", error);
    return res.status(500).json({
      message: "Failed to process birthday followups",
      error: error.message,
    });
  }
});

// POST /api/admin/mail/test-send - Test/simulate and send any system email template with custom or player inputs
router.post("/mail/test-send", adminAuth, async (req, res) => {
  try {
    const {
      mailType,
      recipientEmail,
      candidate = {},
      playerId,
      customReason,
      documents,
      tempRegId,
      isTemporary = true,
      daysElapsed = 6,
    } = req.body;

    if (!recipientEmail || !recipientEmail.trim()) {
      return res.status(400).json({ message: "Recipient email is required" });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(recipientEmail.trim())) {
      return res
        .status(400)
        .json({ message: "Invalid recipient email address" });
    }

    let targetRegistration = {};

    if (playerId) {
      const existing = await Registration.findById(playerId).lean();
      if (existing) {
        targetRegistration = { ...existing };
      }
    }

    const effectiveRegId =
      tempRegId ||
      targetRegistration.idCardNumber ||
      (targetRegistration._id
        ? `SP-REG-${String(targetRegistration._id).slice(-6).toUpperCase()}`
        : `SP-REG-${Math.floor(100000 + Math.random() * 900000)}`);

    const regData = {
      _id: targetRegistration._id || null,
      name: candidate.name || targetRegistration.name || "Applicant",
      fathersName:
        candidate.fathersName ||
        targetRegistration.fathersName ||
        "N/A",
      email: recipientEmail.trim(),
      phone: candidate.phone || targetRegistration.phone || "9876543210",
      role: candidate.role || targetRegistration.role || "Kabaddi Player",
      kabaddiPositions:
        candidate.kabaddiPositions ||
        targetRegistration.kabaddiPositions || ["Raider"],
      registeredAt:
        candidate.registeredAt ||
        targetRegistration.registeredAt ||
        new Date(),
      status: targetRegistration.status || "pending",
      rejectionReason: customReason || targetRegistration.rejectionReason,
      rejectedAt: targetRegistration.rejectedAt || new Date(),
    };

    let result = null;

    switch (mailType) {
      case "pending_reminder":
        result = await sendPendingVerificationReminderMail(regData, {
          regId: effectiveRegId,
          daysElapsed: Number(daysElapsed) || 6,
          documents:
            Array.isArray(documents) && documents.length > 0
              ? documents
              : undefined,
          reminderCount: Math.ceil((Number(daysElapsed) || 6) / 3),
        });
        break;

      case "rejection":
        result = await sendApplicationRejectedMail(
          regData,
          customReason ||
            "Application rejected due to not taking necessary action within the 30-day verification window (in-person document verification not completed).",
          {
            regId: effectiveRegId,
          },
        );
        break;

      case "processing":
        result = await sendApplicationProcessingMail(regData);
        break;

      case "approved":
        result = await sendApprovalMail(regData, {
          initialPassword: candidate.phone || regData.phone || "123456",
        });
        break;

      case "birthday":
        result = await sendBirthdayFollowupMail(
          [
            {
              _id: regData._id,
              name: regData.name,
              dob: candidate.dob || targetRegistration.dob || new Date(),
              email: regData.email,
              phone: regData.phone,
              role: regData.role,
              clubDetails: regData.clubDetails || "SP Sports Academy",
            },
          ],
          {
            isTemporary,
            customToEmail: recipientEmail.trim(),
            targetDate: new Date(),
          },
        );
        break;

      default:
        return res.status(400).json({
          message: `Unknown mailType "${mailType}". Valid types are: pending_reminder, rejection, processing, approved, birthday`,
        });
    }

    return res.json({
      message: `Template email (${mailType}) sent successfully to ${recipientEmail.trim()}`,
      mailType,
      recipientEmail: recipientEmail.trim(),
      regId: effectiveRegId,
      result,
    });
  } catch (error) {
    console.error("❌ Error sending template email:", error);
    return res.status(500).json({
      message: "Failed to send template email",
      error: error.message || String(error),
    });
  }
});

// DELETE /api/admin/registrations/:id - Delete any registration permanently
router.delete("/registrations/:id", adminAuth, async (req, res) => {
  try {
    console.log("DELETE registration endpoint hit - ID:", req.params.id);

    const registration = await Registration.findById(req.params.id);

    if (!registration) {
      return res.status(404).json({ message: "Registration not found" });
    }

    // Store details before deletion for logging
    const registrationName = registration.name;
    const registrationEmail = registration.email;
    const registrationStatus = registration.status;

    // Permanently delete the registration from database
    await Registration.findByIdAndDelete(req.params.id);
    console.log(
      `Registration deleted: ${registrationName} (${registrationEmail}) - Status: ${registrationStatus}`,
    );

    res.json({
      message: "Registration deleted permanently from database",
      deletedRegistration: {
        name: registrationName,
        email: registrationEmail,
        status: registrationStatus,
      },
    });
  } catch (error) {
    console.error("❌ Error deleting registration:", error);
    res
      .status(500)
      .json({ message: "Error deleting registration", error: error.message });
  }
});

// ========== DASHBOARD STATS ROUTES ==========

// GET /api/admin/stats - Get dashboard statistics (optimized)
router.get("/stats", adminAuth, async (req, res) => {
  try {
    // Use a single aggregation pipeline instead of multiple countDocuments calls
    const stats = await Registration.aggregate([
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          pending: {
            $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] },
          },
          approved: {
            $sum: { $cond: [{ $eq: ["$status", "approved"] }, 1, 0] },
          },
          rejected: {
            $sum: { $cond: [{ $eq: ["$status", "rejected"] }, 1, 0] },
          },
        },
      },
    ]);

    const result = stats[0] || {
      total: 0,
      pending: 0,
      approved: 0,
      rejected: 0,
    };

    res.json({
      stats: result,
    });
  } catch (error) {
    console.error("❌ Error fetching stats:", error);
    res.status(500).json({ message: "Error fetching statistics" });
  }
});

// ========== ADMIN PROFILE ROUTES ==========

// PATCH /api/admin/password/change - Change password for logged-in admin
router.patch("/password/change", adminAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res
        .status(400)
        .json({ message: "Current password and new password are required" });
    }

    if (String(newPassword).length < 6) {
      return res
        .status(400)
        .json({ message: "New password must be at least 6 characters" });
    }

    const admin = await Admin.findById(req.adminId);
    if (!admin) {
      return res.status(404).json({ message: "Admin not found" });
    }

    const isCurrentValid = await admin.comparePassword(currentPassword);
    if (!isCurrentValid) {
      return res.status(401).json({ message: "Current password is incorrect" });
    }

    admin.password = String(newPassword);
    await admin.save();

    return res.json({ message: "Password updated successfully" });
  } catch (error) {
    console.error("Error changing admin password:", error);
    return res.status(500).json({ message: "Failed to change password" });
  }
});

// GET /api/admin/profile - Get current admin profile
router.get("/profile", adminAuth, async (req, res) => {
  try {
    const admin = await Admin.findById(req.adminId);
    if (!admin) {
      return res.status(404).json({ message: "Admin not found" });
    }
    res.json(admin.toJSON());
  } catch (error) {
    console.error("❌ Error fetching profile:", error);
    res.status(500).json({ message: "Error fetching profile" });
  }
});

// PUT /api/admin/profile - Update admin profile
router.put("/profile", adminAuth, async (req, res) => {
  try {
    const { email, currentPassword, newPassword } = req.body;
    const admin = await Admin.findById(req.adminId);

    if (!admin) {
      return res.status(404).json({ message: "Admin not found" });
    }

    // Update email if provided
    if (email && email !== admin.email) {
      const emailExists = await Admin.findOne({ email });
      if (emailExists) {
        return res.status(409).json({ message: "Email already in use" });
      }
      admin.email = email;
    }

    // Update password if provided
    if (newPassword) {
      if (!currentPassword) {
        return res
          .status(400)
          .json({ message: "Current password is required to change password" });
      }

      const isPasswordValid = await admin.comparePassword(currentPassword);
      if (!isPasswordValid) {
        return res
          .status(401)
          .json({ message: "Current password is incorrect" });
      }

      if (newPassword.length < 6) {
        return res
          .status(400)
          .json({ message: "New password must be at least 6 characters" });
      }

      admin.password = newPassword;
    }

    await admin.save();

    res.json({
      message: "Profile updated successfully",
      admin: admin.toJSON(),
    });
  } catch (error) {
    console.error("❌ Error updating profile:", error);
    res.status(500).json({ message: "Error updating profile" });
  }
});

// ========== NEWSLETTER ROUTES ==========

const Newsletter = require("../models/newsletter");

// GET /api/admin/newsletter - Get all newsletters
router.get("/newsletter", adminAuth, async (req, res) => {
  try {
    const status = req.query.status || "all";

    let query = {};
    if (status !== "all") {
      query.status = status;
    }

    const newsletters = await Newsletter.find(query).sort({ subscribedAt: -1 });
    res.json({ newsletters });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// PATCH /api/admin/newsletter/:id - Mark newsletter as completed
router.patch("/newsletter/:id", adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const newsletter = await Newsletter.findByIdAndUpdate(
      id,
      { status: "completed" },
      { new: true },
    );

    if (!newsletter) {
      return res.status(404).json({ message: "Newsletter not found" });
    }

    res.json({ message: "Newsletter marked as completed", newsletter });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// DELETE /api/admin/newsletter/:id - Delete newsletter
router.delete("/newsletter/:id", adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const newsletter = await Newsletter.findByIdAndDelete(id);

    if (!newsletter) {
      return res.status(404).json({ message: "Newsletter not found" });
    }

    res.json({ message: "Newsletter deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ========== ID CARD GENERATION ROUTES ==========

// Helper function to generate unique ID card number
async function generateUniqueIdCardNumber() {
  let idCardNumber;
  let isUnique = false;

  // Generate random 4-digit ID until we find a unique one
  while (!isUnique) {
    const randomNum = Math.floor(Math.random() * 9000) + 1000; // 4-digit random number (1000-9999)
    idCardNumber = `SPKG-${String(randomNum).padStart(4, "0")}`;

    // Check if this ID already exists
    const existing = await Registration.findOne({ idCardNumber });
    if (!existing) {
      isUnique = true;
    }
  }

  return idCardNumber;
}

// POST /api/admin/registrations/:id/generate-id - Generate ID card number for approved registration
router.post("/registrations/:id/generate-id", adminAuth, async (req, res) => {
  try {
    const { customIdNumber, idCardRole } = req.body; // Admin can optionally provide custom ID and role

    const registration = await Registration.findById(req.params.id);

    if (!registration) {
      return res.status(404).json({ message: "Registration not found" });
    }

    // Check if registration is approved
    if (registration.status !== "approved") {
      return res.status(400).json({
        message: "Only approved registrations can have ID cards generated",
      });
    }

    // Check if ID card already generated
    if (registration.idCardNumber) {
      return res.status(400).json({
        message: "ID card already generated for this registration",
        idCardNumber: registration.idCardNumber,
      });
    }

    let idCardNumber;

    // If admin provided custom ID, validate and use it
    if (customIdNumber && customIdNumber.trim()) {
      const trimmedId = customIdNumber.trim();

      // Check if custom ID already exists
      const existingWithCustomId = await Registration.findOne({
        idCardNumber: trimmedId,
      });

      if (existingWithCustomId) {
        return res.status(400).json({
          message: "This ID number is already assigned to another member",
        });
      }

      idCardNumber = trimmedId;
    } else {
      // Generate random unique ID
      idCardNumber = await generateUniqueIdCardNumber();
    }

    // Update registration with ID card details (Generation date should match registration date)
    registration.idCardNumber = idCardNumber;
    registration.idCardGeneratedAt =
      registration.registeredAt || new Date();
    registration.idCardGeneratedBy = req.adminId;
    // Store admin-assigned role for ID card, fallback to registration.role if not set
    registration.idCardRole =
      idCardRole && idCardRole.trim() ? idCardRole.trim() : registration.role;

    await registration.save();

    if (process.env.NODE_ENV === "development") {
      console.log(
        `✅ ID Card generated: ${idCardNumber} for ${registration.name} (${customIdNumber ? "Custom" : "Random"}) | Role: ${registration.idCardRole}`,
      );
    }

    res.json({
      message: "ID card generated successfully",
      idCardNumber,
      type: customIdNumber ? "custom" : "random",
      registration,
    });
  } catch (error) {
    console.error("❌ Error generating ID card:", error);
    res.status(500).json({ message: "Error generating ID card" });
  }
});

// GET /api/admin/id-cards - Get all registrations with ID cards
router.get("/id-cards", adminAuth, async (req, res) => {
  try {
    const { page = 1, limit = 10, search = "" } = req.query;

    let query = { idCardNumber: { $ne: null } };

    // Search by name or ID card number
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { idCardNumber: { $regex: search, $options: "i" } },
      ];
    }

    const skip = (page - 1) * limit;
    const limitNum = Math.min(parseInt(limit) || 10, 100);

    const registrations = await Registration.find(query)
      .select(
        "_id name idCardNumber phone bloodGroup dob photo idCardGeneratedAt",
      )
      .sort({ idCardGeneratedAt: -1 })
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
        limit: limitNum,
      },
    });
  } catch (error) {
    console.error("❌ Error fetching ID cards:", error);
    res.status(500).json({ message: "Error fetching ID cards" });
  }
});

// GET /api/id-card/:id - Public route to get ID card data (no auth required for viewing)
router.get("/id-card-data/:id", async (req, res) => {
  try {
    const registration = await Registration.findById(req.params.id).select(
      "name fathersName dob bloodGroup phone address photo idCardNumber idCardGeneratedAt idCardRole role registeredAt",
    );

    if (!registration) {
      return res.status(404).json({ message: "Registration not found" });
    }

    // Only allow ID card viewing for registrations that have ID cards generated
    if (!registration.idCardNumber) {
      return res
        .status(404)
        .json({ message: "ID card not generated for this registration" });
    }

    res.json(registration);
  } catch (error) {
    console.error("❌ Error fetching ID card data:", error);
    res.status(500).json({ message: "Error fetching ID card data" });
  }
});

// DELETE /api/admin/registrations/:id/delete-id - Delete ID card for a registration
router.delete("/registrations/:id/delete-id", adminAuth, async (req, res) => {
  try {
    console.log(
      "🔄 Delete ID request received for registration ID:",
      req.params.id,
    );

    const registration = await Registration.findById(req.params.id);

    if (!registration) {
      console.log("❌ Registration not found");
      return res.status(404).json({ message: "Registration not found" });
    }

    // Check if ID card exists
    if (!registration.idCardNumber) {
      console.log("❌ No ID card found");
      return res.status(400).json({
        message: "No ID card found for this registration",
      });
    }

    const deletedIdCardNumber = registration.idCardNumber;

    // Remove ID card details using $unset to completely remove the fields
    registration.idCardNumber = undefined;
    registration.idCardGeneratedAt = undefined;
    registration.idCardGeneratedBy = undefined;

    await registration.save();

    if (process.env.NODE_ENV === "development") {
      console.log(
        `✅ ID Card deleted: ${deletedIdCardNumber} for ${registration.name}`,
      );
    }

    res.json({
      message: "ID card deleted successfully",
      deletedIdCardNumber,
      registration,
    });
  } catch (error) {
    console.error("❌ Error deleting ID card:", error);
    res.status(500).json({ message: "Error deleting ID card" });
  }
});

// ========== PLAYER AUTH & ATTENDANCE MANAGEMENT ROUTES ==========

const toIsoDate = (date) => date.toISOString().split("T")[0];

const getTodayInIST = () => {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  return formatter.format(new Date());
};

const getMonthBounds = (monthParam) => {
  const now = new Date();
  const [yearStr, monthStr] = (
    monthParam ||
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
  ).split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);

  if (!year || !month || month < 1 || month > 12) {
    return null;
  }

  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0));

  return {
    month: `${year}-${String(month).padStart(2, "0")}`,
    startDate: toIsoDate(start),
    endDate: toIsoDate(end),
  };
};

const getMonthKey = (inputMonth) => {
  if (typeof inputMonth !== "string") return null;
  const value = inputMonth.trim();
  if (!/^\d{4}-\d{2}$/.test(value)) return null;

  const [yearStr, monthStr] = value.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);

  if (!year || !month || month < 1 || month > 12) return null;
  return `${year}-${String(month).padStart(2, "0")}`;
};

const getRecentMonthKeys = (count = 12, anchorMonth) => {
  const keys = [];
  const safeCount = Math.max(1, Math.min(Number(count) || 12, 24));
  const base = getMonthKey(anchorMonth);

  let startDate;
  if (base) {
    const [yearStr, monthStr] = base.split("-");
    startDate = new Date(Number(yearStr), Number(monthStr) - 1, 1);
  } else {
    const now = new Date();
    startDate = new Date(now.getFullYear(), now.getMonth(), 1);
  }

  for (let i = 0; i < safeCount; i += 1) {
    const d = new Date(startDate.getFullYear(), startDate.getMonth() - i, 1);
    keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }

  return keys;
};

const normalizeFeeHistory = (feePayments, months = 12, anchorMonth) => {
  const monthKeys = getRecentMonthKeys(months, anchorMonth);
  const source = Array.isArray(feePayments) ? feePayments : [];
  const feeMap = new Map();

  for (const item of source) {
    const monthKey = getMonthKey(item?.month);
    if (!monthKey) continue;

    feeMap.set(monthKey, {
      month: monthKey,
      isPaid: Boolean(item?.isPaid),
      updatedAt: item?.updatedAt || null,
      updatedBy: item?.updatedBy || null,
    });
  }

  return monthKeys.map((month) => {
    const found = feeMap.get(month);
    if (found) return found;

    return {
      month,
      isPaid: false,
      updatedAt: null,
      updatedBy: null,
    };
  });
};

const getPracticeDatesForMonth = async (bounds) => {
  const players = await Registration.find({
    status: "approved",
    attendance: {
      $elemMatch: {
        date: { $gte: bounds.startDate, $lte: bounds.endDate },
        status: "present",
      },
    },
  })
    .select("attendance")
    .lean();

  const practiceDateSet = new Set();

  for (const player of players) {
    for (const entry of player.attendance || []) {
      if (
        entry?.status === "present" &&
        entry?.date >= bounds.startDate &&
        entry?.date <= bounds.endDate
      ) {
        practiceDateSet.add(entry.date);
      }
    }
  }

  return Array.from(practiceDateSet).sort();
};

// GET /api/admin/players - List all approved players with generated IDs
router.get("/players", adminAuth, async (req, res) => {
  try {
    const search = (req.query.search || "").trim();
    const showAllPlayers = String(req.query.all).toLowerCase() === "true";
    const ageGroup = req.query.ageGroup || "all";
    const gender = req.query.gender || "all";

    const query = {};
    if (!showAllPlayers) {
      query.status = "approved";
    }

    if (ageGroup && ageGroup !== "all") {
      const today = new Date();
      const setRange = (minAge, maxAgeExclusive) => {
        const maxDate = new Date(today);
        maxDate.setFullYear(today.getFullYear() - minAge);
        const minDate = new Date(today);
        minDate.setFullYear(today.getFullYear() - maxAgeExclusive);
        return { $gte: minDate, $lt: maxDate };
      };

      switch (ageGroup) {
        case "Under 10":
          query.dob = setRange(0, 10);
          break;
        case "10-14":
          query.dob = setRange(10, 14);
          break;
        case "14-16":
          query.dob = setRange(14, 16);
          break;
        case "16-19":
          query.dob = setRange(16, 19);
          break;
        case "19-25":
          query.dob = setRange(19, 25);
          break;
        case "Over 25":
          const cutoff = new Date(today);
          cutoff.setFullYear(today.getFullYear() - 25);
          query.dob = { $lt: cutoff };
          break;
        default:
          break;
      }
    }

    if (gender && gender !== "all" && gender !== "both") {
      const g = gender.toLowerCase();
      if (g === "boy's" || g === "boys") {
        query.gender = "male";
      } else if (g === "girl's" || g === "girls") {
        query.gender = "female";
      } else {
        query.gender = g;
      }
    }

    if (search) {
      const regex = { $regex: search, $options: "i" };
      query.$or = [
        { name: regex },
        { idCardNumber: regex },
        { email: regex },
        { phone: regex },
        { role: regex },
        { gender: regex },
        { kitSize: regex },
        { clubDetails: regex },
        { aadharNumber: regex },
      ];

      const numericSearch = Number(search);
      if (!Number.isNaN(numericSearch) && Number.isInteger(numericSearch)) {
        query.$or.push({ jerseyNumber: numericSearch });
      }
    }

    const players = await Registration.find(query)
      .select(
        "_id name email phone role status idCardNumber idCardGeneratedAt registeredAt attendance gender kitSize kitSizeSelectedAt jerseyNumber jerseyAssignedAt clubDetails aadharNumber address feeAccessEnabled",
      )
      .sort({ name: 1 })
      .lean();

    const mapped = players.map((player) => ({
      ...player,
      attendanceCount: Array.isArray(player.attendance)
        ? player.attendance.length
        : 0,
    }));

    return res.json({ players: mapped });
  } catch (error) {
    console.error("Error fetching players:", error);
    return res.status(500).json({ message: "Failed to fetch players" });
  }
});

// GET /api/admin/fees/players - Approved players with payment-list selection status
router.get("/fees/players", adminAuth, async (req, res) => {
  try {
    const search = String(req.query.search || "").trim();
    const query = { status: "approved" };

    if (search) {
      const regex = { $regex: search, $options: "i" };
      query.$or = [
        { name: regex },
        { email: regex },
        { phone: regex },
        { idCardNumber: regex },
      ];
    }

    const players = await Registration.find(query)
      .select("_id name email phone role idCardNumber feeAccessEnabled feePayments")
      .sort({ name: 1 })
      .lean();

    const currentMonth = getMonthBounds()?.month;

    const mapped = players.map((player) => {
      const currentMonthEntry = Array.isArray(player.feePayments)
        ? player.feePayments.find((item) => getMonthKey(item?.month) === currentMonth)
        : null;

      return {
        _id: player._id,
        name: player.name,
        email: player.email,
        phone: player.phone || "",
        role: player.role,
        idCardNumber: player.idCardNumber || "",
        feeAccessEnabled: Boolean(player.feeAccessEnabled),
        currentMonthPaid: Boolean(currentMonthEntry?.isPaid),
      };
    });

    return res.json({ players: mapped, currentMonth });
  } catch (error) {
    console.error("Error fetching fee players:", error);
    return res.status(500).json({ message: "Failed to fetch fee players" });
  }
});

// PATCH /api/admin/fees/players/:playerId/access - Add or remove player from fee list
router.patch("/fees/players/:playerId/access", adminAuth, async (req, res) => {
  try {
    const { enabled } = req.body || {};

    if (typeof enabled !== "boolean") {
      return res.status(400).json({ message: "enabled must be boolean" });
    }

    const player = await Registration.findById(req.params.playerId).select(
      "_id name status feeAccessEnabled",
    );

    if (!player) {
      return res.status(404).json({ message: "Player not found" });
    }

    if (player.status !== "approved") {
      return res
        .status(400)
        .json({ message: "Only approved players can be added to fee list" });
    }

    player.feeAccessEnabled = enabled;
    await player.save();

    return res.json({
      message: enabled
        ? "Player added to fee payment list"
        : "Player removed from fee payment list",
      player: {
        id: player._id,
        name: player.name,
        feeAccessEnabled: player.feeAccessEnabled,
      },
    });
  } catch (error) {
    console.error("Error updating fee access:", error);
    return res.status(500).json({ message: "Failed to update fee access" });
  }
});

// GET /api/admin/fees/:playerId - Fee payment history for a player
router.get("/fees/:playerId", adminAuth, async (req, res) => {
  try {
    const historyMonths = Number(req.query.months || 12);
    const selectedMonth = getMonthKey(String(req.query.month || "")) || getMonthBounds()?.month;

    const player = await Registration.findById(req.params.playerId)
      .select("_id name email role idCardNumber status feeAccessEnabled feePayments")
      .populate("feePayments.updatedBy", "username email")
      .lean();

    if (!player) {
      return res.status(404).json({ message: "Player not found" });
    }

    const history = normalizeFeeHistory(player.feePayments, historyMonths, selectedMonth);
    const selectedMonthItem = history.find((item) => item.month === selectedMonth) || null;

    return res.json({
      month: selectedMonth,
      player: {
        id: player._id,
        name: player.name,
        email: player.email,
        role: player.role,
        status: player.status,
        idCardNumber: player.idCardNumber || "",
        feeAccessEnabled: Boolean(player.feeAccessEnabled),
      },
      selectedMonthStatus: selectedMonthItem,
      history,
    });
  } catch (error) {
    console.error("Error fetching fee history:", error);
    return res.status(500).json({ message: "Failed to fetch fee history" });
  }
});

// PATCH /api/admin/fees/:playerId/toggle - Toggle paid/pending for a specific month
router.patch("/fees/:playerId/toggle", adminAuth, async (req, res) => {
  try {
    const { month, isPaid } = req.body || {};
    const monthKey = getMonthKey(String(month || ""));

    if (!monthKey) {
      return res.status(400).json({ message: "month must be in YYYY-MM format" });
    }

    if (typeof isPaid !== "boolean") {
      return res.status(400).json({ message: "isPaid must be boolean" });
    }

    const player = await Registration.findById(req.params.playerId);
    if (!player) {
      return res.status(404).json({ message: "Player not found" });
    }

    if (player.status !== "approved") {
      return res
        .status(400)
        .json({ message: "Only approved players are eligible for fee updates" });
    }

    if (!player.feeAccessEnabled) {
      return res.status(400).json({
        message: "Player is not in the fee payment list. Enable access first.",
      });
    }

    const payments = Array.isArray(player.feePayments) ? player.feePayments : [];
    const existingIndex = payments.findIndex(
      (item) => getMonthKey(item?.month) === monthKey,
    );

    const updatedRecord = {
      month: monthKey,
      isPaid,
      updatedAt: new Date(),
      updatedBy: req.adminId,
    };

    if (existingIndex >= 0) {
      player.feePayments[existingIndex] = {
        ...player.feePayments[existingIndex].toObject(),
        ...updatedRecord,
      };
    } else {
      player.feePayments.push(updatedRecord);
    }

    await player.save();

    return res.json({
      message: isPaid
        ? `Payment marked as PAID for ${monthKey}`
        : `Payment marked as PENDING for ${monthKey}`,
      payment: updatedRecord,
      player: {
        id: player._id,
        name: player.name,
        feeAccessEnabled: Boolean(player.feeAccessEnabled),
      },
    });
  } catch (error) {
    console.error("Error toggling fee payment:", error);
    return res.status(500).json({ message: "Failed to toggle fee payment" });
  }
});

// GET /api/admin/login-history - Latest login history for all admins and approved players
router.get("/login-history", adminAuth, async (req, res) => {
  try {
    const [admins, players] = await Promise.all([
      Admin.find({})
        .select("_id username email role lastLogin loginHistory")
        .sort({ username: 1 })
        .lean(),
      Registration.find({ status: "approved" })
        .select(
          "_id name email role status idCardNumber playerLastLogin playerLoginHistory",
        )
        .sort({ name: 1 })
        .lean(),
    ]);

    const normalizeHistory = (history) =>
      (Array.isArray(history) ? history : [])
        .sort((a, b) => new Date(b.loggedInAt) - new Date(a.loggedInAt))
        .slice(0, 2);

    return res.json({
      admins: admins.map((admin) => ({
        _id: admin._id,
        username: admin.username,
        email: admin.email,
        role: admin.role,
        lastLogin: admin.lastLogin || null,
        loginHistory: normalizeHistory(admin.loginHistory),
      })),
      players: players.map((player) => ({
        _id: player._id,
        name: player.name,
        email: player.email,
        role: player.role,
        status: player.status,
        idCardNumber: player.idCardNumber || null,
        lastLogin: player.playerLastLogin || null,
        loginHistory: normalizeHistory(player.playerLoginHistory),
      })),
    });
  } catch (error) {
    console.error("Error fetching login history:", error);
    return res.status(500).json({ message: "Failed to fetch login history" });
  }
});

// POST /api/admin/players/:id/set-password - Set or reset player password by admin
router.post("/players/:id/set-password", adminAuth, async (req, res) => {
  try {
    const { password } = req.body;

    if (
      !password ||
      typeof password !== "string" ||
      password.trim().length < 6
    ) {
      return res
        .status(400)
        .json({ message: "Password must be at least 6 characters" });
    }

    const player = await Registration.findById(req.params.id);
    if (!player) {
      return res.status(404).json({ message: "Player not found" });
    }

    if (player.status !== "approved" || !player.idCardNumber) {
      return res.status(400).json({
        message:
          "Only approved players with ID card can be assigned login password",
      });
    }

    player.playerPasswordHash = await bcrypt.hash(password.trim(), 10);
    player.playerPasswordSetAt = new Date();
    player.playerFailedLoginAttempts = 0;
    player.playerForcePasswordReset = false;
    player.playerLastFailedLoginAt = null;
    await player.save();

    return res.json({
      message: "Player password updated successfully",
      player: {
        _id: player._id,
        name: player.name,
        idCardNumber: player.idCardNumber,
        playerPasswordSetAt: player.playerPasswordSetAt,
      },
    });
  } catch (error) {
    console.error("Error setting player password:", error);
    return res.status(500).json({ message: "Failed to set player password" });
  }
});

// GET /api/admin/attendance/:playerId - Per player attendance for a month
router.get("/attendance/:playerId", adminAuth, async (req, res) => {
  try {
    const bounds = getMonthBounds(req.query.month);
    if (!bounds) {
      return res
        .status(400)
        .json({ message: "Invalid month format. Use YYYY-MM." });
    }

    const [player, practiceDates] = await Promise.all([
      Registration.findById(req.params.playerId).select(
        "_id name email role idCardNumber attendance status",
      ),
      getPracticeDatesForMonth(bounds),
    ]);

    if (!player) {
      return res.status(404).json({ message: "Player not found" });
    }

    const attendance = (player.attendance || [])
      .filter(
        (entry) =>
          entry.date >= bounds.startDate && entry.date <= bounds.endDate,
      )
      .sort((a, b) => (a.date < b.date ? -1 : 1));

    return res.json({
      month: bounds.month,
      today: getTodayInIST(),
      practiceDates,
      player: {
        id: player._id,
        name: player.name,
        email: player.email,
        role: player.role,
        idCardNumber: player.idCardNumber,
        status: player.status,
      },
      attendance,
    });
  } catch (error) {
    console.error("Error fetching player attendance:", error);
    return res
      .status(500)
      .json({ message: "Failed to fetch player attendance" });
  }
});

// POST /api/admin/attendance/:playerId/mark - Admin marks attendance for a player
router.post("/attendance/:playerId/mark", adminAuth, async (req, res) => {
  try {
    const {
      date,
      status = "present",
      note,
      latitude,
      longitude,
      accuracy,
      address,
    } = req.body || {};

    const attendanceDate =
      typeof date === "string" && date.trim()
        ? date.trim()
        : new Date().toISOString().split("T")[0];

    if (!/^\d{4}-\d{2}-\d{2}$/.test(attendanceDate)) {
      return res
        .status(400)
        .json({ message: "date must be in YYYY-MM-DD format" });
    }

    if (!["present", "absent"].includes(status)) {
      return res
        .status(400)
        .json({ message: "status must be present or absent" });
    }

    const player = await Registration.findById(req.params.playerId);
    if (!player) {
      return res.status(404).json({ message: "Player not found" });
    }

    if (player.status !== "approved") {
      return res
        .status(400)
        .json({ message: "Only approved players can have attendance marked" });
    }

    const record = {
      date: attendanceDate,
      status,
      location: {
        latitude: typeof latitude === "number" ? latitude : 0,
        longitude: typeof longitude === "number" ? longitude : 0,
        accuracy: typeof accuracy === "number" ? accuracy : null,
        address: typeof address === "string" ? address.trim() : null,
      },
      deviceId: null,
      deviceName: null,
      markedByType: "admin",
      markedByAdminId: req.adminId,
      adminNote: typeof note === "string" && note.trim() ? note.trim() : null,
      markedAt: new Date(),
    };

    const existingIndex = (player.attendance || []).findIndex(
      (item) => item.date === attendanceDate,
    );
    let action = "created";

    if (existingIndex !== -1) {
      player.attendance[existingIndex] = {
        ...player.attendance[existingIndex].toObject(),
        ...record,
      };
      action = "updated";
    } else {
      player.attendance.push(record);
    }

    await player.save();

    return res.json({
      message: `Attendance ${action} by admin successfully`,
      action,
      attendance: record,
      player: {
        id: player._id,
        name: player.name,
        idCardNumber: player.idCardNumber,
      },
    });
  } catch (error) {
    console.error("Error marking attendance by admin:", error);
    return res
      .status(500)
      .json({ message: "Failed to mark attendance by admin" });
  }
});

// ========== PLAYER MESSAGE MANAGEMENT ROUTES ==========

// GET /api/admin/player-messages - List all player messages for admin
router.get("/player-messages", adminAuth, async (req, res) => {
  try {
    const status = (req.query.status || "all").trim();

    const query = {};
    if (status !== "all") {
      query.status = status;
    }

    const items = await PlayerMessage.find(query)
      .sort({ createdAt: -1 })
      .lean();

    return res.json({ items });
  } catch (error) {
    console.error("Error fetching player messages:", error);
    return res.status(500).json({ message: "Failed to fetch player messages" });
  }
});

// PATCH /api/admin/player-messages/:id - Mark message as completed
router.patch("/player-messages/:id", adminAuth, async (req, res) => {
  try {
    const item = await PlayerMessage.findByIdAndUpdate(
      req.params.id,
      { status: "completed" },
      { new: true },
    );

    if (!item) {
      return res.status(404).json({ message: "Player message not found" });
    }

    return res.json({ message: "Player message marked as completed", item });
  } catch (error) {
    console.error("Error updating player message:", error);
    return res.status(500).json({ message: "Failed to update player message" });
  }
});

// POST /api/admin/player-messages/send - Send a new message from admin to player
router.post("/player-messages/send", adminAuth, async (req, res) => {
  try {
    const { playerId, subject, message } = req.body;

    if (!playerId || !subject || !message) {
      return res
        .status(400)
        .json({ message: "playerId, subject and message are required" });
    }

    const player = await Registration.findById(playerId).select(
      "_id name email phone idCardNumber status",
    );

    if (!player || player.status !== "approved") {
      return res.status(404).json({ message: "Approved player not found" });
    }

    const item = new PlayerMessage({
      playerId: player._id,
      playerName: player.name,
      playerEmail: player.email,
      playerPhone: player.phone || "",
      idCardNumber: player.idCardNumber || "",
      type: "admin_to_player",
      sentByAdminId: req.adminId,
      sentByAdminName: req.admin?.username || "Admin",
      subject: subject.trim(),
      message: message.trim(),
      isReadByPlayer: false,
      status: "new",
    });

    await item.save();

    return res.status(201).json({ message: "Message sent to player", item });
  } catch (error) {
    console.error("Error sending admin message to player:", error);
    return res
      .status(500)
      .json({ message: "Failed to send message to player" });
  }
});

// POST /api/admin/player-messages/:id/reply - Reply to a player message
router.post("/player-messages/:id/reply", adminAuth, async (req, res) => {
  try {
    const { message } = req.body;

    if (!message || typeof message !== "string" || !message.trim()) {
      return res.status(400).json({ message: "Reply message is required" });
    }

    const original = await PlayerMessage.findById(req.params.id);
    if (!original) {
      return res.status(404).json({ message: "Player message not found" });
    }

    const replyItem = new PlayerMessage({
      playerId: original.playerId,
      playerName: original.playerName,
      playerEmail: original.playerEmail,
      playerPhone: original.playerPhone || "",
      idCardNumber: original.idCardNumber || "",
      type: "admin_to_player",
      replyToMessageId: original._id,
      sentByAdminId: req.adminId,
      sentByAdminName: req.admin?.username || "Admin",
      subject: `Reply: ${original.subject}`,
      message: message.trim(),
      isReadByPlayer: false,
      status: "new",
    });

    await replyItem.save();

    original.status = "completed";
    await original.save();

    return res
      .status(201)
      .json({ message: "Reply sent to player", item: replyItem });
  } catch (error) {
    console.error("Error replying to player message:", error);
    return res.status(500).json({ message: "Failed to send reply to player" });
  }
});

// DELETE /api/admin/player-messages/:id - Delete player message
router.delete("/player-messages/:id", adminAuth, async (req, res) => {
  try {
    const item = await PlayerMessage.findByIdAndDelete(req.params.id);

    if (!item) {
      return res.status(404).json({ message: "Player message not found" });
    }

    return res.json({ message: "Player message deleted successfully" });
  } catch (error) {
    console.error("Error deleting player message:", error);
    return res.status(500).json({ message: "Failed to delete player message" });
  }
});

// GET /api/admin/extract/master - Comprehensive Master Data & Dossier Extraction
router.get("/extract/master", adminAuth, async (req, res) => {
  try {
    const { playerId, status, ageGroup, gender, search } = req.query;

    if (playerId) {
      const player = await Registration.findById(playerId)
        .populate("approvedBy", "username email role")
        .populate("idCardGeneratedBy", "username email role")
        .populate("attendance.markedByAdminId", "username email role")
        .populate("feePayments.updatedBy", "username email role")
        .populate("noc.appliedByAdmin", "username email role")
        .populate("noc.generatedByAdmin", "username email role")
        .populate("noc.bypassedBy", "username email role")
        .lean();

      if (!player) {
        return res.status(404).json({ message: "Player record not found" });
      }

      // Fetch related communications
      const messages = await PlayerMessage.find({ playerId: player._id })
        .sort({ createdAt: -1 })
        .lean();

      // Fetch related inquiries
      const inquiries = await Contact.find({
        $or: [
          ...(player.email ? [{ email: player.email }] : []),
          ...(player.phone ? [{ phone: player.phone }] : []),
        ],
      })
        .sort({ createdAt: -1 })
        .lean();

      // Compute statistics for this player
      const attendanceList = Array.isArray(player.attendance) ? player.attendance : [];
      const presentCount = attendanceList.filter((a) => a.status === "present").length;
      const absentCount = attendanceList.filter((a) => a.status === "absent").length;
      const totalAttendanceSessions = attendanceList.length;
      const attendancePercentage = totalAttendanceSessions > 0
        ? Math.round((presentCount / totalAttendanceSessions) * 100)
        : 0;

      const feePaymentsList = Array.isArray(player.feePayments) ? player.feePayments : [];
      const paidMonths = feePaymentsList.filter((f) => f.isPaid).map((f) => f.month);
      const unpaidMonths = feePaymentsList.filter((f) => !f.isPaid).map((f) => f.month);

      return res.json({
        type: "single",
        academy: {
          name: "SP Sports Academy",
          subtitle: "Official Player Dossier & Master Record Extract",
          address: "SP Sports Academy, Shakti Mandir Path, Dhanbad, Jharkhand 826001",
          affiliation: "SP Sports Academy Central Registry & Administrative Standards",
          email: "spkabaddigroupdhanbad@gmail.com",
          website: "https://spkabaddi.me",
          extractedAt: new Date(),
          extractedBy: req.admin?.username || "Admin Authority",
        },
        player,
        summary: {
          presentCount,
          absentCount,
          totalAttendanceSessions,
          attendancePercentage,
          paidMonths,
          unpaidMonths,
          totalMessages: messages.length,
          totalInquiries: inquiries.length,
        },
        messages,
        inquiries,
      });
    }

    // Academy Master Ledger mode
    const query = {};
    if (status && status !== "all") query.status = status;
    if (ageGroup && ageGroup !== "all") query.ageGroup = ageGroup;
    if (gender && gender !== "all") query.gender = gender;

    if (search && search.trim()) {
      const term = search.trim();
      const regex = new RegExp(term, "i");
      query.$or = [
        { name: regex },
        { email: regex },
        { phone: regex },
        { aadharNumber: regex },
        { idCardNumber: regex },
      ];
    }

    const players = await Registration.find(query)
      .populate("approvedBy", "username email role")
      .populate("idCardGeneratedBy", "username email role")
      .populate("attendance.markedByAdminId", "username email role")
      .populate("feePayments.updatedBy", "username email role")
      .populate("noc.appliedByAdmin", "username email role")
      .populate("noc.generatedByAdmin", "username email role")
      .populate("noc.bypassedBy", "username email role")
      .sort({ registeredAt: -1 })
      .lean();

    // Academy overall aggregates
    const totalCount = await Registration.countDocuments();
    const approvedCount = await Registration.countDocuments({ status: "approved" });
    const pendingCount = await Registration.countDocuments({ status: "pending" });
    const rejectedCount = await Registration.countDocuments({ status: "rejected" });
    const nocAppliedCount = await Registration.countDocuments({ "noc.status": "applied" });
    const nocApprovedCount = await Registration.countDocuments({ "noc.status": "approved" });
    const nocRelievedCount = await Registration.countDocuments({ "noc.status": "relieved" });

    return res.json({
      type: "master",
      academy: {
        name: "SP Sports Academy",
        subtitle: "Academy Master Data Extraction Ledger",
        address: "SP Sports Academy, Shakti Mandir Path, Dhanbad, Jharkhand 826001",
        affiliation: "SP Sports Academy Central Registry & Administrative Standards",
        email: "spkabaddigroupdhanbad@gmail.com",
        website: "https://spkabaddi.me",
        extractedAt: new Date(),
        extractedBy: req.admin?.username || "Admin Authority",
      },
      stats: {
        total: totalCount,
        approved: approvedCount,
        pending: pendingCount,
        rejected: rejectedCount,
        nocApplied: nocAppliedCount,
        nocApproved: nocApprovedCount,
        nocRelieved: nocRelievedCount,
      },
      matchedCount: players.length,
      players,
    });
  } catch (error) {
    console.error("Error in master extract route:", error);
    return res.status(500).json({ message: "Failed to extract data", error: error.message });
  }
});

// =========================================================================
// NO OBJECTION CERTIFICATE (NOC) WORKFLOW & AUTOMATED TRANSITIONS
// =========================================================================

const generateNocNumber = (registration) => {
  const currentYear = new Date().getFullYear();
  const seed = (registration.idCardNumber || registration._id.toString()).slice(-4).toUpperCase();
  const randomSuffix = Math.floor(1000 + Math.random() * 9000);
  return `SPA-NOC-${currentYear}-${seed}-${randomSuffix}`;
};

const generateNocSignatureHash = (registration, nocNumber, issueDate) => {
  const payload = `${registration._id}_${registration.name}_${nocNumber}_${issueDate.toISOString()}_SP_SPORTS_ACADEMY_DHANBAD_VERIFIED`;
  return crypto.createHash("sha256").update(payload).digest("hex");
};

// Automated state machine for 14-day cooling completion and 14-day post-NOC archival
const processNocTransitions = async () => {
  try {
    const now = new Date();

    // 1. Check players where 14-day cooling has ended and NOC must be auto-approved
    const coolingCompletedPlayers = await Registration.find({
      "noc.status": "applied",
      "noc.coolingEndsAt": { $lte: now },
    });

    for (const player of coolingCompletedPlayers) {
      // Guard: Only auto-generate if Payment and Kit clearances are verified
      const isFeeCleared = Boolean(player.noc?.clearances?.feeCleared);
      const isKitReturned = Boolean(player.noc?.clearances?.kitReturned);

      if (!isFeeCleared || !isKitReturned) {
        // Clearances are still pending. Do not auto-issue certificate until clearances are satisfied.
        continue;
      }

      const nocNum = generateNocNumber(player);
      const generatedDate = now;
      const signatureHash = generateNocSignatureHash(player, nocNum, generatedDate);
      const expiryDate = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000); // 14 days download window

      player.noc.status = "approved";
      player.noc.generatedAt = generatedDate;
      player.noc.expiresAt = expiryDate;
      player.noc.nocNumber = nocNum;
      player.noc.digitalSignatureHash = signatureHash;
      await player.save();

      try {
        await sendNocGeneratedMail({
          registration: player,
          nocNumber: nocNum,
          expiresAt: expiryDate,
          isBypassed: false,
        });
      } catch (err) {
        console.error(`Failed to send NOC generated mail for player ${player._id}:`, err);
      }
    }

    // 2. Check players where 14-day download window has elapsed -> auto-relieve/reject and archive
    const expiredNocPlayers = await Registration.find({
      "noc.status": "approved",
      "noc.expiresAt": { $lte: now },
      status: { $ne: "rejected" },
    });

    for (const player of expiredNocPlayers) {
      player.noc.status = "relieved";
      player.status = "rejected";
      player.rejectedAt = now;
      player.rejectionReason = "Institutional Clearance Completed: Relieved on Official NOC (14-day retention elapsed)";
      player.playerPasswordHash = null;
      player.playerLoginHistory = [];
      await player.save();
    }
  } catch (error) {
    console.error("Error executing processNocTransitions:", error);
  }
};

// POST /api/admin/registrations/:id/noc/apply - Initiate 14-day NOC cooling period
router.post("/registrations/:id/noc/apply", adminAuth, async (req, res) => {
  try {
    const { reason, destinationClub } = req.body;
    const player = await Registration.findById(req.params.id);

    if (!player) {
      return res.status(404).json({ message: "Player not found" });
    }

    if (player.status !== "approved") {
      return res.status(400).json({
        message: "NOC can only be initiated for approved academy players.",
      });
    }

    if (player.noc?.status === "applied") {
      return res.status(400).json({
        message: "NOC cooling period is already active for this player.",
      });
    }

    if (player.noc?.status === "approved") {
      return res.status(400).json({
        message: "Official NOC has already been generated for this player.",
      });
    }

    const now = new Date();
    const coolingEndsAt = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000); // Exactly 14 days

    player.noc = {
      ...(player.noc ? player.noc.toObject() : {}),
      status: "applied",
      appliedAt: now,
      coolingEndsAt,
      reason: reason ? String(reason).trim() : "",
      destinationClub: destinationClub ? String(destinationClub).trim() : "",
      appliedByAdmin: req.adminId,
      isBypassed: false,
    };

    await player.save();

    // Trigger professional Brevo notification email
    try {
      await sendNocInitiatedMail({
        registration: player,
        coolingEndsAt,
        reason: player.noc.reason,
        destinationClub: player.noc.destinationClub,
      });
    } catch (mailErr) {
      console.error("Error dispatching NOC initiated email:", mailErr);
    }

    return res.json({
      message: "NOC application initiated. 14-day mandatory institutional countdown timer activated.",
      player,
    });
  } catch (error) {
    console.error("Error applying for NOC:", error);
    return res.status(500).json({ message: "Failed to initiate NOC", error: error.message });
  }
});

// PATCH /api/admin/registrations/:id/noc/clearances - Update clearance checklist (fees, kit, ID card, dues)
router.patch("/registrations/:id/noc/clearances", adminAuth, async (req, res) => {
  try {
    const { feeCleared, kitReturned, idCardReturned, duesCleared, remarks } = req.body;
    const player = await Registration.findById(req.params.id);

    if (!player) {
      return res.status(404).json({ message: "Player not found" });
    }

    if (!player.noc) {
      player.noc = { status: "none" };
    }
    if (!player.noc.clearances) {
      player.noc.clearances = {};
    }

    const now = new Date();

    if (feeCleared !== undefined) {
      player.noc.clearances.feeCleared = Boolean(feeCleared);
      player.noc.clearances.feeClearedAt = feeCleared ? now : null;
      player.noc.clearances.feeClearedBy = feeCleared ? req.adminId : null;
    }

    if (kitReturned !== undefined) {
      player.noc.clearances.kitReturned = Boolean(kitReturned);
      player.noc.clearances.kitReturnedAt = kitReturned ? now : null;
      player.noc.clearances.kitReturnedBy = kitReturned ? req.adminId : null;
    }

    if (idCardReturned !== undefined) {
      player.noc.clearances.idCardReturned = Boolean(idCardReturned);
      player.noc.clearances.idCardReturnedAt = idCardReturned ? now : null;
    }

    if (duesCleared !== undefined) {
      player.noc.clearances.duesCleared = Boolean(duesCleared);
      player.noc.clearances.duesClearedAt = duesCleared ? now : null;
    }

    if (remarks !== undefined) {
      player.noc.clearances.remarks = String(remarks || "").trim();
    }

    await player.save();

    return res.json({
      message: "NOC clearances updated successfully.",
      clearances: player.noc.clearances,
      player,
    });
  } catch (error) {
    console.error("Error updating NOC clearances:", error);
    return res.status(500).json({ message: "Failed to update clearances", error: error.message });
  }
});

// POST /api/admin/registrations/:id/noc/bypass-generate - Super Admin instant clearance (guarded by checklist)
router.post("/registrations/:id/noc/bypass-generate", adminAuth, async (req, res) => {
  try {
    const player = await Registration.findById(req.params.id);

    if (!player) {
      return res.status(404).json({ message: "Player not found" });
    }

    if (player.status !== "approved") {
      return res.status(400).json({
        message: "NOC can only be generated for approved academy players.",
      });
    }

    // Verify clearance checklist
    const isFeeCleared = Boolean(player.noc?.clearances?.feeCleared);
    const isKitReturned = Boolean(player.noc?.clearances?.kitReturned);
    const force = req.body?.force === true;

    if (!force && (!isFeeCleared || !isKitReturned)) {
      return res.status(400).json({
        message: "Clearance verification required: Both 'Payment / Fee Cleared' and 'Kit / Equipment Returned' must be verified and checked before generating NOC. If there are pending items, use 'Reject / Cancel NOC with Deficiencies'.",
        pendingClearances: {
          feeCleared: isFeeCleared,
          kitReturned: isKitReturned,
        },
      });
    }

    const now = new Date();
    const nocNumber = generateNocNumber(player);
    const signatureHash = generateNocSignatureHash(player, nocNumber, now);
    const expiresAt = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

    player.noc = {
      ...(player.noc ? player.noc.toObject() : {}),
      status: "approved",
      appliedAt: player.noc?.appliedAt || now,
      coolingEndsAt: now, // Bypassed cooling
      generatedAt: now,
      expiresAt,
      nocNumber,
      digitalSignatureHash: signatureHash,
      isBypassed: true,
      bypassedBy: req.adminId,
      generatedByAdmin: req.adminId,
    };

    await player.save();

    // Trigger automated Brevo NOC generated email
    try {
      await sendNocGeneratedMail({
        registration: player,
        nocNumber,
        expiresAt,
        isBypassed: true,
      });
    } catch (mailErr) {
      console.error("Error dispatching NOC generated email:", mailErr);
    }

    return res.json({
      message: "Clearance verified: Official NOC certificate issued successfully.",
      player,
    });
  } catch (error) {
    console.error("Error bypassing NOC:", error);
    return res.status(500).json({ message: "Failed to expedite NOC", error: error.message });
  }
});

// POST /api/admin/registrations/:id/noc/cancel - Cancel pending NOC request
router.post("/registrations/:id/noc/cancel", adminAuth, async (req, res) => {
  try {
    const player = await Registration.findById(req.params.id);

    if (!player) {
      return res.status(404).json({ message: "Player not found" });
    }

    if (player.noc?.status !== "applied") {
      return res.status(400).json({
        message: "Only NOCs currently in the 14-day cooling period can be cancelled.",
      });
    }

    player.noc.status = "none";
    player.noc.coolingEndsAt = null;
    await player.save();

    return res.json({
      message: "NOC application cancelled. Player remains in standard approved status.",
      player,
    });
  } catch (error) {
    console.error("Error cancelling NOC:", error);
    return res.status(500).json({ message: "Failed to cancel NOC", error: error.message });
  }
});

// POST /api/admin/registrations/:id/noc/reject - Cancel / Reject NOC with deficiency reasons and send professional Brevo email
router.post("/registrations/:id/noc/reject", adminAuth, async (req, res) => {
  try {
    const { reasons = [], adminNote = "" } = req.body;
    const player = await Registration.findById(req.params.id);

    if (!player) {
      return res.status(404).json({ message: "Player not found" });
    }

    if (player.noc?.status !== "applied" && player.noc?.status !== "approved") {
      return res.status(400).json({
        message: "Only NOCs currently in cooling period or issued can be cancelled / rejected.",
      });
    }

    const now = new Date();
    const finalReasons = Array.isArray(reasons) && reasons.length > 0
      ? reasons
      : ["Outstanding institutional clearances or kit return pending"];

    player.noc.status = "rejected";
    player.noc.coolingEndsAt = null;
    player.noc.cancellation = {
      cancelledAt: now,
      cancelledBy: req.adminId,
      reasons: finalReasons,
      adminNote: String(adminNote || "").trim(),
      mailSent: false,
    };

    await player.save();

    // Trigger professional Brevo rejection email
    let mailSuccess = false;
    try {
      await sendNocRejectedMail({
        registration: player,
        reasons: finalReasons,
        adminNote: String(adminNote || "").trim(),
      });
      mailSuccess = true;
      player.noc.cancellation.mailSent = true;
      await player.save();
    } catch (mailErr) {
      console.error("Error sending NOC rejection email:", mailErr);
    }

    return res.json({
      message: "NOC rejected due to clearance deficiencies. Formal notice email dispatched to member.",
      mailSent: mailSuccess,
      player,
    });
  } catch (error) {
    console.error("Error rejecting NOC:", error);
    return res.status(500).json({ message: "Failed to reject NOC", error: error.message });
  }
});

// POST /api/admin/registrations/:id/recovery/generate-link - Generate secure student recovery link
router.post("/registrations/:id/recovery/generate-link", adminAuth, async (req, res) => {
  try {
    const player = await Registration.findById(req.params.id);
    if (!player) {
      return res.status(404).json({ message: "Player not found" });
    }

    const token = crypto.randomBytes(24).toString("hex");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const frontendUrl = (
      process.env.FRONTEND_URL || "https://spkabaddi.me"
    ).replace(/\/+$/, "");
    const recoveryUrl = `${frontendUrl}/noc-recovery/${token}`;

    if (!player.recovery) {
      player.recovery = {};
    }
    player.recovery.status = "link_sent";
    player.recovery.recoveryToken = token;
    player.recovery.tokenExpiresAt = expiresAt;
    if (!Array.isArray(player.recovery.history)) {
      player.recovery.history = [];
    }
    player.recovery.history.push({
      action: "link_generated",
      timestamp: new Date(),
      by: "admin",
      details: `Recovery portal link generated and dispatched by admin (${req.adminId})`,
    });

    await player.save();

    let emailSent = false;
    try {
      await sendNocRecoveryLinkMail({
        registration: player,
        recoveryUrl,
        expiresAt,
      });
      emailSent = true;
    } catch (mailErr) {
      console.error("Error sending recovery link email:", mailErr);
    }

    return res.json({
      message: "Recovery link generated and dispatched successfully.",
      recoveryUrl,
      token,
      expiresAt,
      emailSent,
      player,
    });
  } catch (error) {
    console.error("Error generating recovery link:", error);
    return res.status(500).json({ message: "Failed to generate recovery link", error: error.message });
  }
});

// POST /api/admin/registrations/:id/recovery/admin-submit - Direct Admin recovery with letter upload & separate terms timestamps
router.post(
  "/registrations/:id/recovery/admin-submit",
  adminAuth,
  uploadDoc.single("letter"),
  async (req, res) => {
    try {
      const { applicationNote, termsAgreed, policyAgreed } = req.body;
      const player = await Registration.findById(req.params.id);

      if (!player) {
        return res.status(404).json({ message: "Player not found" });
      }

      const isTermsAgreed = termsAgreed === true || termsAgreed === "true";
      const isPolicyAgreed = policyAgreed === true || policyAgreed === "true";

      if (!isTermsAgreed || !isPolicyAgreed) {
        return res.status(400).json({
          message: "Both Terms & Conditions agreement and Academy Rules & Policy agreement must be confirmed separately.",
        });
      }

      const now = new Date();
      const letterUrl = req.file?.path || req.file?.secure_url || "";
      const letterPublicId = req.file?.filename || "";

      if (!player.recovery) {
        player.recovery = {};
      }

      player.recovery.status = "approved";
      player.recovery.submittedVia = "admin";
      player.recovery.submittedAt = now;
      player.recovery.applicationLetterUrl = letterUrl;
      player.recovery.applicationLetterPublicId = letterPublicId;
      player.recovery.applicationNote = String(applicationNote || "").trim();
      player.recovery.termsAgreed = true;
      player.recovery.termsAgreedAt = now;
      player.recovery.policyAgreed = true;
      player.recovery.policyAgreedAt = now;
      player.recovery.ipAddress = req.ip || req.connection?.remoteAddress || "admin_direct";
      player.recovery.userAgent = req.headers["user-agent"] || "Admin Portal";
      player.recovery.reviewedBy = req.adminId;
      player.recovery.reviewedAt = now;
      player.recovery.reviewRemarks = "Direct re-admission executed and approved by Admin.";

      if (!Array.isArray(player.recovery.history)) {
        player.recovery.history = [];
      }
      player.recovery.history.push({
        action: "admin_direct_recovery",
        timestamp: now,
        by: "admin",
        details: "Direct institutional readmission completed by administrator.",
      });

      // Reinstate player status & reset NOC
      player.status = "approved";
      player.rejectedAt = null;
      player.rejectionReason = null;
      if (player.noc) {
        player.noc.status = "none";
        player.noc.coolingEndsAt = null;
        player.noc.expiresAt = null;
      }

      await player.save();

      // Dispatch welcome back notification mail
      try {
        await sendNocRecoveryApprovedMail({ registration: player });
      } catch (mailErr) {
        console.error("Error dispatching recovery approved mail:", mailErr);
      }

      return res.json({
        message: "Player successfully recovered and re-admitted to active standing!",
        player,
      });
    } catch (error) {
      console.error("Error processing admin recovery:", error);
      return res.status(500).json({ message: "Failed to recover player", error: error.message });
    }
  }
);

// POST /api/admin/registrations/:id/recovery/review - Admin reviews pending self-service application
router.post("/registrations/:id/recovery/review", adminAuth, async (req, res) => {
  try {
    const { decision, reviewRemarks } = req.body;
    const player = await Registration.findById(req.params.id);

    if (!player) {
      return res.status(404).json({ message: "Player not found" });
    }

    if (player.recovery?.status !== "pending_review") {
      return res.status(400).json({
        message: "Player does not have a pending recovery application awaiting review.",
      });
    }

    const now = new Date();
    player.recovery.reviewedBy = req.adminId;
    player.recovery.reviewedAt = now;
    player.recovery.reviewRemarks = String(reviewRemarks || "").trim();

    if (!Array.isArray(player.recovery.history)) {
      player.recovery.history = [];
    }

    if (decision === "approve") {
      player.recovery.status = "approved";
      player.recovery.history.push({
        action: "recovery_approved",
        timestamp: now,
        by: "admin",
        details: `Re-admission approved by Admin: ${reviewRemarks || "Criteria verified"}`,
      });

      // Restore player to active approved
      player.status = "approved";
      player.rejectedAt = null;
      player.rejectionReason = null;
      if (player.noc) {
        player.noc.status = "none";
        player.noc.coolingEndsAt = null;
        player.noc.expiresAt = null;
      }

      await player.save();

      try {
        await sendNocRecoveryApprovedMail({ registration: player });
      } catch (mailErr) {
        console.error("Error dispatching recovery approved mail:", mailErr);
      }

      return res.json({
        message: "Re-admission application approved! Player reinstated to active membership.",
        player,
      });
    } else {
      player.recovery.status = "rejected";
      player.recovery.history.push({
        action: "recovery_rejected",
        timestamp: now,
        by: "admin",
        details: `Re-admission rejected by Admin: ${reviewRemarks || "Not approved"}`,
      });

      await player.save();

      return res.json({
        message: "Re-admission application rejected.",
        player,
      });
    }
  } catch (error) {
    console.error("Error reviewing recovery application:", error);
    return res.status(500).json({ message: "Failed to process review", error: error.message });
  }
});


// POST /api/admin/registrations/:id/noc/resend-email - Resend NOC notification email
router.post("/registrations/:id/noc/resend-email", adminAuth, async (req, res) => {
  try {
    const player = await Registration.findById(req.params.id);

    if (!player) {
      return res.status(404).json({ message: "Player not found" });
    }

    if (!player.noc || player.noc.status === "none") {
      return res.status(400).json({
        message: "No active NOC found for this player.",
      });
    }

    if (player.noc.status === "applied") {
      const result = await sendNocInitiatedMail({
        registration: player,
        coolingEndsAt: player.noc.coolingEndsAt,
        reason: player.noc.reason,
        destinationClub: player.noc.destinationClub,
      });

      return res.json({
        message: "NOC initiation notice email resent successfully with updated CC and BCC.",
        result,
      });
    } else if (player.noc.status === "approved") {
      const result = await sendNocGeneratedMail({
        registration: player,
        nocNumber: player.noc.nocNumber,
        expiresAt: player.noc.expiresAt,
        isBypassed: Boolean(player.noc.isBypassed),
      });

      return res.json({
        message: "NOC issuance notice email resent successfully with updated CC and BCC.",
        result,
      });
    } else {
      return res.status(400).json({
        message: `Cannot resend NOC email for status: ${player.noc.status}`,
      });
    }
  } catch (error) {
    console.error("Error resending NOC email:", error);
    return res.status(500).json({
      message: "Failed to resend NOC email",
      error: error.message,
    });
  }
});

// GET /api/admin/registrations/:id/noc/certificate - Get full certificate data
router.get("/registrations/:id/noc/certificate", adminAuth, async (req, res) => {
  try {
    const player = await Registration.findById(req.params.id)
      .populate("approvedBy", "username email role")
      .populate("noc.appliedByAdmin", "username email role")
      .populate("noc.generatedByAdmin", "username email role")
      .populate("noc.bypassedBy", "username email role")
      .lean();

    if (!player) {
      return res.status(404).json({ message: "Player not found" });
    }

    if (player.noc?.status !== "approved" && player.noc?.status !== "relieved") {
      return res.status(400).json({ message: "NOC certificate has not been approved or generated yet." });
    }

    return res.json({
      player,
      certificate: {
        nocNumber: player.noc.nocNumber,
        generatedAt: player.noc.generatedAt,
        expiresAt: player.noc.expiresAt,
        digitalSignatureHash: player.noc.digitalSignatureHash,
        isBypassed: Boolean(player.noc.isBypassed),
        institution: {
          name: "SP SPORTS ACADEMY",
          address: "Shakti Mandir Path, Dhanbad, Jharkhand 826001",
          affiliation: "AKFI Standards Compliant (Amateur Kabaddi Federation of India)",
          contactEmail: "spkabaddigroupdhanbad@gmail.com",
          contactPhone: "+91 8271882034",
          website: "https://spkabaddi.me",
        },
      },
    });
  } catch (error) {
    console.error("Error fetching certificate data:", error);
    return res.status(500).json({ message: "Failed to fetch certificate", error: error.message });
  }
});

// GET /api/admin/noc/process-check - Run NOC transitions on demand
router.get("/noc/process-check", adminAuth, async (req, res) => {
  try {
    await processNocTransitions();
    return res.json({ message: "NOC transitions processed successfully." });
  } catch (error) {
    return res.status(500).json({ message: "Error processing NOC transitions", error: error.message });
  }
});

router.processNocTransitions = processNocTransitions;
module.exports = router;
