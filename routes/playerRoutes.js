const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { cloudinary, upload } = require("../config/cloudinary");
const Registration = require("../models/registration");
const PlayerMessage = require("../models/playerMessage");
const { sendPasswordOtpMail } = require("../services/brevoMailer");
const { playerAuth } = require("../middleware/playerAuth");

const router = express.Router();
const PLAYER_JWT_SECRET =
  process.env.PLAYER_JWT_SECRET ||
  process.env.JWT_SECRET ||
  "sp_club_player_secret_key_2024";
const MAX_FAILED_LOGIN_ATTEMPTS = 10;

const toIsoDate = (date) => date.toISOString().split("T")[0];

const getTodayInIST = () => {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  return formatter.format(now);
};

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

const getApprovedPlayerByEmail = async (email) =>
  Registration.findOne({
    email: new RegExp(
      `^${String(email || "")
        .trim()
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
      "i",
    ),
    status: "approved",
  });

const verifyCurrentPassword = async (player, rawPassword) => {
  if (player?.playerPasswordHash) {
    return bcrypt.compare(String(rawPassword || ""), player.playerPasswordHash);
  }

  const normalizedStoredPhone = normalizePhone(player?.phone);
  const normalizedInputPassword = normalizePhone(rawPassword);
  if (!normalizedStoredPhone) return false;
  return normalizedStoredPhone === normalizedInputPassword;
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

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const clientIp = getClientIp(req);
    const userAgent = String(req.headers["user-agent"] || "");

    if (!email || !password) {
      return res
        .status(400)
        .json({ message: "Email and password are required" });
    }

    const player = await getApprovedPlayerByEmail(email);

    if (!player) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    if (player.playerForcePasswordReset) {
      return res.status(403).json({
        message:
          "Account locked after multiple failed attempts. Please reset password using Email OTP.",
      });
    }

    const isValidPassword = await verifyCurrentPassword(player, password);
    if (!isValidPassword) {
      player.playerFailedLoginAttempts =
        Number(player.playerFailedLoginAttempts || 0) + 1;
      player.playerLastFailedLoginAt = new Date();

      if (player.playerFailedLoginAttempts >= MAX_FAILED_LOGIN_ATTEMPTS) {
        player.playerForcePasswordReset = true;
      }

      await player.save();

      if (player.playerForcePasswordReset) {
        return res.status(403).json({
          message:
            "Maximum wrong attempts reached. Password reset is now required via Email OTP.",
        });
      }

      return res.status(401).json({ message: "Invalid email or password" });
    }

    // Successful login clears failed attempt counters and updates latest login trail.
    if (
      player.playerFailedLoginAttempts ||
      player.playerForcePasswordReset ||
      player.playerLastFailedLoginAt
    ) {
      player.playerFailedLoginAttempts = 0;
      player.playerForcePasswordReset = false;
      player.playerLastFailedLoginAt = null;
    }

    player.playerLastLogin = new Date();
    player.playerLoginHistory = [
      ...(Array.isArray(player.playerLoginHistory)
        ? player.playerLoginHistory
        : []),
      {
        ipAddress: clientIp,
        userAgent,
        deviceName: "Web Browser",
        loggedInAt: new Date(),
      },
    ].slice(-2);

    await player.save();

    const token = jwt.sign(
      {
        id: String(player._id),
        email: player.email,
        role: player.role,
        type: "player",
      },
      PLAYER_JWT_SECRET,
      { expiresIn: "24h" },
    );

    return res.json({
      message: "Login successful",
      token,
      player: {
        id: player._id,
        name: player.name,
        email: player.email,
        role: player.role,
        idCardNumber: player.idCardNumber,
        phone: player.phone,
      },
    });
  } catch (error) {
    console.error("Player login error:", error);
    return res.status(500).json({ message: "Error logging in player" });
  }
});

// Request password reset OTP via email
router.post("/password/forgot/request", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    const player = await getApprovedPlayerByEmail(email);

    // Generic response to avoid account enumeration
    if (!player) {
      return res.json({
        message: "If the account exists, OTP has been sent to registered email",
      });
    }

    const otp = generateOtp();
    const otpHash = await bcrypt.hash(otp, 10);

    player.playerPasswordResetOtpHash = otpHash;
    player.playerPasswordResetOtpExpiresAt = new Date(
      Date.now() + 10 * 60 * 1000,
    );
    player.playerPasswordResetRequestedAt = new Date();
    await player.save();

    const mailResult = await sendPasswordOtpMail({
      email: player.email,
      name: player.name,
      otp,
    });

    if (mailResult?.skipped && mailResult.reason === "disabled") {
      return res.status(503).json({
        message: "Mail service is currently disabled. Please contact admin.",
      });
    }

    return res.json({
      message: "If the account exists, OTP has been sent to registered email",
    });
  } catch (error) {
    console.error("Forgot password request error:", error);
    return res.status(500).json({ message: "Failed to send OTP email" });
  }
});

// Reset password using email + OTP
router.post("/password/forgot/reset", async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;

    if (!email || !otp || !newPassword) {
      return res
        .status(400)
        .json({ message: "Email, OTP and newPassword are required" });
    }

    if (String(newPassword).length < 6) {
      return res
        .status(400)
        .json({ message: "New password must be at least 6 characters" });
    }

    const player = await getApprovedPlayerByEmail(email);
    if (!player) {
      return res.status(400).json({ message: "Invalid OTP or email" });
    }

    if (
      !player.playerPasswordResetOtpHash ||
      !player.playerPasswordResetOtpExpiresAt
    ) {
      return res.status(400).json({ message: "OTP not requested or expired" });
    }

    if (
      new Date(player.playerPasswordResetOtpExpiresAt).getTime() < Date.now()
    ) {
      return res
        .status(400)
        .json({ message: "OTP has expired. Request a new OTP." });
    }

    const otpMatches = await bcrypt.compare(
      String(otp).trim(),
      player.playerPasswordResetOtpHash,
    );
    if (!otpMatches) {
      return res.status(400).json({ message: "Invalid OTP or email" });
    }

    player.playerPasswordHash = await bcrypt.hash(String(newPassword), 10);
    player.playerPasswordSetAt = new Date();
    player.playerPasswordResetOtpHash = null;
    player.playerPasswordResetOtpExpiresAt = null;
    player.playerPasswordResetRequestedAt = null;
    player.playerFailedLoginAttempts = 0;
    player.playerForcePasswordReset = false;
    player.playerLastFailedLoginAt = null;

    await player.save();

    return res.json({
      message: "Password reset successful. Please login with new password.",
    });
  } catch (error) {
    console.error("Forgot password reset error:", error);
    return res.status(500).json({ message: "Failed to reset password" });
  }
});

// Change password when logged in
router.patch("/password/change", playerAuth, async (req, res) => {
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

    const player = await Registration.findById(req.playerId).select(
      "_id phone playerPasswordHash",
    );
    if (!player) {
      return res.status(404).json({ message: "Player not found" });
    }

    const isValidCurrent = await verifyCurrentPassword(player, currentPassword);
    if (!isValidCurrent) {
      return res.status(401).json({ message: "Current password is incorrect" });
    }

    player.playerPasswordHash = await bcrypt.hash(String(newPassword), 10);
    player.playerPasswordSetAt = new Date();
    player.playerPasswordResetOtpHash = null;
    player.playerPasswordResetOtpExpiresAt = null;
    player.playerPasswordResetRequestedAt = null;
    player.playerFailedLoginAttempts = 0;
    player.playerForcePasswordReset = false;
    player.playerLastFailedLoginAt = null;
    await player.save();

    return res.json({ message: "Password changed successfully" });
  } catch (error) {
    console.error("Change password error:", error);
    return res.status(500).json({ message: "Failed to change password" });
  }
});

router.get("/me", playerAuth, async (req, res) => {
  try {
    const player = await Registration.findById(req.playerId)
      .select(
        "_id name email role idCardNumber phone parentsPhone aadharNumber dob bloodGroup gender address clubDetails photo certificates",
      )
      .lean();

    if (!player) {
      return res.status(404).json({ message: "Player not found" });
    }

    return res.json({
      player: {
        id: player._id,
        name: player.name,
        email: player.email,
        role: player.role,
        idCardNumber: player.idCardNumber,
        phone: player.phone || "",
        parentsPhone: player.parentsPhone || "",
        aadharNumber: player.aadharNumber || "",
        dob: player.dob,
        bloodGroup: player.bloodGroup || "",
        gender: player.gender || "",
        address: player.address || "",
        clubDetails: player.clubDetails || "",
        photo: player.photo || "",
        certificates: Array.isArray(player.certificates)
          ? player.certificates
          : [],
      },
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch player profile" });
  }
});

router.post("/messages", playerAuth, async (req, res) => {
  try {
    const { subject, message } = req.body;

    if (!subject || !message) {
      return res
        .status(400)
        .json({ message: "Subject and message are required" });
    }

    const player = await Registration.findById(req.playerId).select(
      "_id name email phone idCardNumber",
    );

    if (!player) {
      return res.status(404).json({ message: "Player not found" });
    }

    const newMessage = new PlayerMessage({
      playerId: player._id,
      playerName: player.name,
      playerEmail: player.email,
      playerPhone: player.phone || "",
      idCardNumber: player.idCardNumber || "",
      type: "player_to_admin",
      subject: subject.trim(),
      message: message.trim(),
      isReadByPlayer: true,
    });

    await newMessage.save();

    return res.status(201).json({
      message: "Message sent to admin successfully",
      item: newMessage,
    });
  } catch (error) {
    console.error("Player message create error:", error);
    return res.status(500).json({ message: "Failed to send message to admin" });
  }
});

router.get("/messages", playerAuth, async (req, res) => {
  try {
    const items = await PlayerMessage.find({ playerId: req.playerId })
      .sort({ createdAt: -1 })
      .lean();

    return res.json({ items });
  } catch (error) {
    console.error("Player message list error:", error);
    return res.status(500).json({ message: "Failed to fetch message history" });
  }
});

router.get("/messages/unread-count", playerAuth, async (req, res) => {
  try {
    const unreadCount = await PlayerMessage.countDocuments({
      playerId: req.playerId,
      type: "admin_to_player",
      isReadByPlayer: false,
    });

    return res.json({ unreadCount });
  } catch (error) {
    console.error("Player unread count error:", error);
    return res
      .status(500)
      .json({ message: "Failed to fetch unread message count" });
  }
});

router.patch("/messages/read-all", playerAuth, async (req, res) => {
  try {
    await PlayerMessage.updateMany(
      {
        playerId: req.playerId,
        type: "admin_to_player",
        isReadByPlayer: false,
      },
      {
        $set: { isReadByPlayer: true },
      },
    );

    return res.json({ message: "All notifications marked as read" });
  } catch (error) {
    console.error("Player mark read error:", error);
    return res
      .status(500)
      .json({ message: "Failed to mark notifications as read" });
  }
});

router.put(
  "/me/photo",
  playerAuth,
  upload.single("photo"),
  async (req, res) => {
    try {
      if (!req.file?.path) {
        return res.status(400).json({ message: "Profile photo is required" });
      }

      const player = await Registration.findById(req.playerId).select(
        "_id name photo",
      );

      if (!player) {
        return res.status(404).json({ message: "Player not found" });
      }

      const oldPhotoUrl = player.photo;
      const newPhotoUrl = req.file.path;

      player.photo = newPhotoUrl;
      await player.save();

      const oldPublicId = extractCloudinaryPublicId(oldPhotoUrl);
      const newPublicId = extractCloudinaryPublicId(newPhotoUrl);

      if (oldPublicId && oldPublicId !== newPublicId) {
        try {
          await cloudinary.uploader.destroy(oldPublicId, {
            invalidate: true,
            resource_type: "image",
          });
        } catch (destroyError) {
          console.error(
            "Failed to delete old profile photo from Cloudinary:",
            destroyError,
          );
        }
      }

      return res.json({
        message: "Profile photo updated successfully",
        player: {
          id: player._id,
          name: player.name,
          photo: player.photo,
        },
      });
    } catch (error) {
      console.error("Player photo update error:", error);
      return res
        .status(500)
        .json({ message: "Failed to update profile photo" });
    }
  },
);

router.post("/attendance/mark", playerAuth, async (req, res) => {
  try {
    const { latitude, longitude, accuracy, address, deviceId, deviceName } =
      req.body;

    const isValidLatitude =
      Number.isFinite(latitude) && latitude >= -90 && latitude <= 90;
    const isValidLongitude =
      Number.isFinite(longitude) && longitude >= -180 && longitude <= 180;
    const isValidAccuracy = Number.isFinite(accuracy) && accuracy > 0;

    if (!isValidLatitude || !isValidLongitude) {
      return res
        .status(400)
        .json({ message: "Location is required to mark attendance" });
    }

    if (!isValidAccuracy) {
      return res.status(400).json({
        message:
          "Accurate GPS location is required. Please enable precise location.",
      });
    }

    const MAX_ALLOWED_ACCURACY_METERS = 100;
    if (accuracy > MAX_ALLOWED_ACCURACY_METERS) {
      return res.status(400).json({
        message: `Location accuracy is too low (${Math.round(accuracy)}m). Please enable precise location and try again.`,
      });
    }

    const normalizedDeviceId = String(deviceId || "").trim() || null;
    const normalizedDeviceName = String(deviceName || "").trim() || null;

    if (!normalizedDeviceId) {
      return res
        .status(400)
        .json({ message: "Device ID is required to mark attendance" });
    }

    const today = getTodayInIST();

    const player = await Registration.findById(req.playerId);
    if (!player) {
      return res.status(404).json({ message: "Player not found" });
    }

    const existingRecordIndex = player.attendance.findIndex(
      (entry) => entry.date === today,
    );

    if (existingRecordIndex !== -1) {
      return res.status(409).json({
        message: "Attendance is already marked for today",
      });
    }

    const record = {
      date: today,
      status: "present",
      location: {
        latitude,
        longitude,
        accuracy,
        address: typeof address === "string" ? address.trim() : null,
      },
      deviceId: normalizedDeviceId,
      deviceName: normalizedDeviceName,
      markedByType: "player",
      markedByAdminId: null,
      adminNote: null,
      markedAt: new Date(),
    };

    player.attendance.push(record);

    await player.save();

    const potentialProxy = await Registration.findOne({
      _id: { $ne: player._id },
      status: "approved",
      attendance: {
        $elemMatch: {
          date: today,
          deviceId: normalizedDeviceId,
        },
      },
    }).select("_id name idCardNumber");

    return res.json({
      message: "Attendance marked successfully",
      attendance: record,
      proxyRisk: potentialProxy
        ? {
            sameDeviceUsedBy: {
              id: potentialProxy._id,
              name: potentialProxy.name,
              idCardNumber: potentialProxy.idCardNumber || null,
            },
          }
        : null,
    });
  } catch (error) {
    console.error("Mark attendance error:", error);
    return res.status(500).json({ message: "Failed to mark attendance" });
  }
});

router.get("/attendance", playerAuth, async (req, res) => {
  try {
    const bounds = getMonthBounds(req.query.month);

    if (!bounds) {
      return res
        .status(400)
        .json({ message: "Invalid month format. Use YYYY-MM." });
    }

    const attendance = (req.player.attendance || [])
      .filter(
        (entry) =>
          entry.date >= bounds.startDate && entry.date <= bounds.endDate,
      )
      .sort((a, b) => (a.date < b.date ? -1 : 1));

    return res.json({
      month: bounds.month,
      attendance,
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch attendance" });
  }
});

module.exports = router;
