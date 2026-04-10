const mongoose = require("mongoose");

const registrationSchema = new mongoose.Schema({
  // Personal Information
  name: { type: String, required: true },
  fathersName: { type: String, required: true },
  email: { type: String, required: true },
  phone: { type: String },
  parentsPhone: { type: String },
  gender: { type: String, enum: ["male", "female", "other"], required: true },
  dob: { type: Date, required: true },
  bloodGroup: {
    type: String,
    enum: ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"],
    required: true,
  },

  // Address & Identification
  address: { type: String },
  aadharNumber: { type: String, required: true, unique: true },
  aadharFront: { type: String, required: true },
  aadharBack: { type: String, required: true },

  // Sports & Role
  role: { type: String, required: true },
  ageGroup: { type: String },
  experience: { type: String },
  kabaddiPositions: [{ type: String }],

  // Club & Registration Info
  clubDetails: { type: String, required: true },
  message: { type: String },
  photo: { type: String, required: true },
  certificates: [
    {
      title: { type: String, required: true },
      fileUrl: { type: String, required: true },
      issuedAt: { type: Date, default: Date.now },
    },
  ],

  // Preferences
  newsletter: { type: Boolean, default: true },
  terms: { type: Boolean, required: true },
  registeredAt: { type: Date, default: Date.now },

  // Admin approval fields
  status: {
    type: String,
    enum: ["pending", "approved", "rejected"],
    default: "pending",
  },
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Admin",
    default: null,
  },
  approvedAt: {
    type: Date,
    default: null,
  },
  rejectedAt: {
    type: Date,
    default: null,
  },
  rejectionReason: {
    type: String,
    default: null,
  },

  // ID Card fields (generated ONLY after approval)
  idCardNumber: {
    type: String,
    unique: true,
    sparse: true, // ✅ CORRECT: field must be ABSENT until generated
  },
  idCardGeneratedAt: {
    type: Date,
    default: null,
  },
  idCardGeneratedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Admin",
    default: null,
  },
  idCardRole: {
    type: String,
    default: null,
  },

  // Player login credentials managed by admin
  playerPasswordHash: {
    type: String,
    default: null,
  },
  playerPasswordSetAt: {
    type: Date,
    default: null,
  },
  playerFailedLoginAttempts: {
    type: Number,
    default: 0,
  },
  playerForcePasswordReset: {
    type: Boolean,
    default: false,
  },
  playerLastFailedLoginAt: {
    type: Date,
    default: null,
  },
  playerLastLogin: {
    type: Date,
    default: null,
  },
  playerLoginHistory: [
    {
      ipAddress: { type: String, default: "unknown" },
      userAgent: { type: String, default: "" },
      deviceName: { type: String, default: null },
      loggedInAt: { type: Date, default: Date.now },
    },
  ],
  playerPasswordResetOtpHash: {
    type: String,
    default: null,
  },
  playerPasswordResetOtpExpiresAt: {
    type: Date,
    default: null,
  },
  playerPasswordResetRequestedAt: {
    type: Date,
    default: null,
  },

  // Attendance records marked by player from dashboard
  attendance: [
    {
      date: {
        type: String,
        required: true,
      },
      status: {
        type: String,
        enum: ["present", "absent"],
        default: "present",
      },
      location: {
        latitude: { type: Number, required: true },
        longitude: { type: Number, required: true },
        accuracy: { type: Number, default: null },
        address: { type: String, default: null },
      },
      deviceId: {
        type: String,
        default: null,
      },
      deviceName: {
        type: String,
        default: null,
      },
      markedByType: {
        type: String,
        enum: ["player", "admin"],
        default: "player",
      },
      markedByAdminId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Admin",
        default: null,
      },
      adminNote: {
        type: String,
        default: null,
      },
      markedAt: {
        type: Date,
        default: Date.now,
      },
    },
  ],
});

// Indexes
registrationSchema.index({ status: 1, registeredAt: -1 });
registrationSchema.index({ name: "text", email: "text", aadharNumber: "text" });
registrationSchema.index({ registeredAt: -1 });
registrationSchema.index({ idCardNumber: 1, status: 1 });
registrationSchema.index({ "attendance.date": 1 });

registrationSchema.pre("save", function (next) {
  if (
    Array.isArray(this.playerLoginHistory) &&
    this.playerLoginHistory.length > 2
  ) {
    this.playerLoginHistory = this.playerLoginHistory.slice(-2);
  }

  next();
});

module.exports = mongoose.model("Registration", registrationSchema);
