// server.js
require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const http = require("http");
const https = require("https");

const app = express();
const PORT = process.env.PORT || 5000;

/* ----------------------------------------------------
   CORS CONFIGURATION
---------------------------------------------------- */

const allowedOrigins = [
  "http://localhost:8080",
  "http://localhost:8081",
  "http://localhost:5173",
  "https://spkabaddi.me",
  "https://www.spkabaddi.me",
  "https://sp-club-frontend.onrender.com",
  "https://sp-club-frontend.vercel.app",
  process.env.FRONTEND_URL,
].filter(Boolean);

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);

      if (
        allowedOrigins.includes(origin) ||
        origin.endsWith(".onrender.com") ||
        origin.endsWith(".vercel.app")
      ) {
        return callback(null, true);
      }

      callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "x-player-id"],
  }),
);

/* ----------------------------------------------------
   BODY PARSERS
---------------------------------------------------- */

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* ----------------------------------------------------
   ROUTES
---------------------------------------------------- */

const contactRoutes = require("./routes/contactRoutes");
const registerRoutes = require("./routes/registerRoutes");
const adminRoutes = require("./routes/adminRoutes");
const newsletterRoutes = require("./routes/newsletterRoutes");
const newsRoutes = require("./routes/newsRoutes");
const playerRoutes = require("./routes/playerRoutes");
const galleryRoutes = require("./routes/galleryRoutes");

app.get("/", (req, res) => {
  res.send("SP Club Backend is running!");
});

app.use("/api/contact", contactRoutes);
app.use("/api/register", registerRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/newsletter", newsletterRoutes);
app.use("/api/news", newsRoutes);
app.use("/api/player", playerRoutes);
app.use("/api/gallery", galleryRoutes);

/* ----------------------------------------------------
   KEEP-ALIVE PING (EVERY 14 MIN)
---------------------------------------------------- */

const cron = require("node-cron");

function startKeepAlivePing() {
  const pingUrl = "https://api.spkabaddi.me";

  if (!pingUrl) {
    console.warn(
      "Keep-alive ping disabled: set RENDER_EXTERNAL_URL or BACKEND_URL in env.",
    );
    return;
  }

  const pingOnce = () => {
    try {
      const url = new URL(pingUrl);
      const client = url.protocol === "https:" ? https : http;

      const req = client.get(pingUrl, { timeout: 10000 }, (res) => {
        res.resume();
        console.log(
          `Keep-alive ping: ${pingUrl} -> ${res.statusCode || "unknown"}`,
        );
      });

      req.on("timeout", () => {
        req.destroy();
        console.warn("Keep-alive ping timeout");
      });

      req.on("error", (err) => {
        console.warn("Keep-alive ping error:", err.message);
      });
    } catch (err) {
      console.warn("Invalid keep-alive URL:", err.message);
    }
  };

  // Ping once immediately when the server starts
  pingOnce();
  
  // Schedule a cron job to run every 10 minutes
  cron.schedule("*/10 * * * *", () => {
    console.log("Cron job running: Keep-alive ping...");
    pingOnce();
  });
}

/* ----------------------------------------------------
   BIRTHDAY CRON JOB (EVERY DAY AT 8:00 AM)
---------------------------------------------------- */

const Registration = require("./models/registration");
const { sendBirthdayFollowupMail } = require("./services/brevoMailer");

function startBirthdayCron() {
  cron.schedule("0 8 * * *", async () => {
    try {
      console.log("Cron job running: Checking for player birthdays...");
      const today = new Date();
      const month = today.getMonth() + 1;
      const day = today.getDate();

      const birthdayPlayers = await Registration.aggregate([
        {
          $match: {
            $expr: {
              $and: [
                { $eq: [{ $month: "$dob" }, month] },
                { $eq: [{ $dayOfMonth: "$dob" }, day] }
              ]
            }
          }
        }
      ]);

      if (birthdayPlayers && birthdayPlayers.length > 0) {
        console.log(`Found ${birthdayPlayers.length} birthdays today. Sending email...`);
        await sendBirthdayFollowupMail(birthdayPlayers);
      } else {
        console.log("No birthdays today.");
      }
    } catch (err) {
      console.error("Error in birthday cron job:", err);
    }
  }, {
    timezone: "Asia/Kolkata"
  });
}

startBirthdayCron();

/* ----------------------------------------------------
   🔴 GLOBAL ERROR HANDLER (CRITICAL FIX)
   Catches Multer / Cloudinary / Validation errors
---------------------------------------------------- */

app.use((err, req, res, next) => {
  console.error("\n🔥 GLOBAL ERROR HANDLER TRIGGERED");
  console.error("Error name:", err.name);
  console.error("Error message:", err.message);
  console.error("Full error:", err);

  // Multer errors (file upload issues)
  if (err.name === "MulterError") {
    return res.status(400).json({
      message: err.message || "File upload error",
    });
  }

  // Cloudinary / upload related errors
  if (
    err.message &&
    (err.message.toLowerCase().includes("cloudinary") ||
      err.message.toLowerCase().includes("upload") ||
      err.message.toLowerCase().includes("file"))
  ) {
    return res.status(400).json({
      message:
        "Image upload failed. Please check file size, type, or server configuration.",
    });
  }

  // Default fallback
  return res.status(err.status || 500).json({
    message: err.message || "Internal server error",
    error: process.env.NODE_ENV === "development" ? err : {},
  });
});

/* ----------------------------------------------------
   DATABASE CONNECTION & SERVER START
---------------------------------------------------- */

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    console.log("MongoDB Connected Successfully!");
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on port ${PORT}`);
      console.log(`Backend accessible at http://localhost:${PORT}`);
      startKeepAlivePing();
    });
  })
  .catch((err) => {
    console.error("MongoDB connection error:", err);
  });
