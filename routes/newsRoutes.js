// routes/newsRoutes.js
const express = require("express");
const router = express.Router();
const { upload } = require("../config/cloudinary");
const News = require("../models/news");
const { adminAuth } = require("../middleware/adminAuth");

const FRONTEND_BASE_URL = (
  process.env.FRONTEND_URL || "https://spkabaddi.me"
).replace(/\/+$/, "");

const escapeHtml = (value = "") =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const buildShareDescription = (content = "") => {
  const normalized = String(content).replace(/\s+/g, " ").trim();
  return normalized.length > 180
    ? `${normalized.slice(0, 177)}...`
    : normalized;
};

// GET /api/news/admin/all - Get all news including unpublished (admin only)
// IMPORTANT: This route must come BEFORE /:id to avoid route conflicts
router.get("/admin/all", adminAuth, async (req, res) => {
  try {
    const news = await News.find().sort({ createdAt: -1 }).select("-__v");

    res.status(200).json(news);
  } catch (error) {
    console.error("Error fetching news:", error);
    res.status(500).json({ message: "Failed to fetch news" });
  }
});

// GET /api/news - Get all published news (public)
router.get("/", async (req, res) => {
  try {
    const { language } = req.query;
    const filter = { published: true };

    if (language && (language === "english" || language === "hindi")) {
      filter.language = language;
    }

    const news = await News.find(filter).sort({ createdAt: -1 }).select("-__v");

    res.status(200).json(news);
  } catch (error) {
    console.error("Error fetching news:", error);
    res.status(500).json({ message: "Failed to fetch news" });
  }
});

// GET /api/news/share/:id - Share-safe page with dynamic OG tags (public)
router.get("/share/:id", async (req, res) => {
  try {
    const news = await News.findById(req.params.id).select(
      "title content images published _id",
    );

    if (!news || !news.published) {
      return res
        .status(404)
        .send(
          '<!doctype html><html><head><meta charset="utf-8"><title>News Not Found</title></head><body><h1>News article not found.</h1></body></html>',
        );
    }

    const articleUrl = `${FRONTEND_BASE_URL}/news/${news._id}`;
    const shareUrl = `${req.protocol}://${req.get("host")}${req.originalUrl}`;
    const imageUrl =
      Array.isArray(news.images) && news.images.length > 0
        ? news.images[0]
        : `${FRONTEND_BASE_URL}/Logo.png`;
    const title = news.title || "SP Kabaddi News";
    const description = buildShareDescription(
      news.content || "Latest update from SP Kabaddi Group Dhanbad.",
    );

    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}" />
  <link rel="canonical" href="${escapeHtml(articleUrl)}" />

  <meta property="og:site_name" content="SP Kabaddi Group Dhanbad" />
  <meta property="og:type" content="article" />
  <meta property="og:title" content="${escapeHtml(title)}" />
  <meta property="og:description" content="${escapeHtml(description)}" />
  <meta property="og:url" content="${escapeHtml(shareUrl)}" />
  <meta property="og:image" content="${escapeHtml(imageUrl)}" />
  <meta property="og:image:secure_url" content="${escapeHtml(imageUrl)}" />

  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escapeHtml(title)}" />
  <meta name="twitter:description" content="${escapeHtml(description)}" />
  <meta name="twitter:image" content="${escapeHtml(imageUrl)}" />

  <meta http-equiv="refresh" content="0;url=${escapeHtml(articleUrl)}" />
</head>
<body>
  <p>Opening article: <a href="${escapeHtml(articleUrl)}">${escapeHtml(articleUrl)}</a></p>
  <script>window.location.replace(${JSON.stringify(articleUrl)});</script>
</body>
</html>`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(html);
  } catch (error) {
    console.error("Error rendering share page:", error);
    return res
      .status(500)
      .send(
        '<!doctype html><html><head><meta charset="utf-8"><title>Error</title></head><body><h1>Failed to load shared news.</h1></body></html>',
      );
  }
});

// GET /api/news/:id - Get single news article (public)
router.get("/:id", async (req, res) => {
  try {
    const news = await News.findById(req.params.id);

    if (!news) {
      return res.status(404).json({ message: "News article not found" });
    }

    res.status(200).json(news);
  } catch (error) {
    console.error("Error fetching news:", error);
    res.status(500).json({ message: "Failed to fetch news article" });
  }
});

// POST /api/news - Create new news article (admin only)
router.post("/", adminAuth, upload.array("images", 10), async (req, res) => {
  try {
    const { title, content, language, author, published } = req.body;

    // Validation
    if (!title || !content) {
      return res
        .status(400)
        .json({ message: "Title and content are required" });
    }

    if (!req.files || req.files.length === 0) {
      return res
        .status(400)
        .json({ message: "At least one image is required" });
    }

    // Get image URLs from uploaded files
    const images = req.files.map((file) => file.path);

    const newNews = new News({
      title,
      content,
      language: language || "english",
      images,
      author: author || "Admin",
      published: published === "true" || published === true,
    });

    await newNews.save();

    res.status(201).json({
      message: "News article created successfully",
      news: newNews,
    });
  } catch (error) {
    console.error("Error creating news:", error);
    res.status(500).json({ message: "Failed to create news article" });
  }
});

// PUT /api/news/:id - Update news article (admin only)
router.put("/:id", adminAuth, upload.array("images", 10), async (req, res) => {
  try {
    const { title, content, language, author, published } = req.body;

    const news = await News.findById(req.params.id);
    if (!news) {
      return res.status(404).json({ message: "News article not found" });
    }

    // Update fields
    if (title) news.title = title;
    if (content) news.content = content;
    if (language) news.language = language;
    if (author) news.author = author;
    if (published !== undefined)
      news.published = published === "true" || published === true;

    // Update images if new ones are uploaded
    if (req.files && req.files.length > 0) {
      news.images = req.files.map((file) => file.path);
    }

    news.updatedAt = Date.now();
    await news.save();

    res.status(200).json({
      message: "News article updated successfully",
      news,
    });
  } catch (error) {
    console.error("Error updating news:", error);
    res.status(500).json({ message: "Failed to update news article" });
  }
});

// DELETE /api/news/:id - Delete news article (admin only)
router.delete("/:id", adminAuth, async (req, res) => {
  try {
    const news = await News.findByIdAndDelete(req.params.id);

    if (!news) {
      return res.status(404).json({ message: "News article not found" });
    }

    res.status(200).json({ message: "News article deleted successfully" });
  } catch (error) {
    console.error("Error deleting news:", error);
    res.status(500).json({ message: "Failed to delete news article" });
  }
});

// PATCH /api/news/:id/publish - Toggle publish status (admin only)
router.patch("/:id/publish", adminAuth, async (req, res) => {
  try {
    const news = await News.findById(req.params.id);

    if (!news) {
      return res.status(404).json({ message: "News article not found" });
    }

    news.published = !news.published;
    news.updatedAt = Date.now();
    await news.save();

    res.status(200).json({
      message: `News article ${news.published ? "published" : "unpublished"} successfully`,
      news,
    });
  } catch (error) {
    console.error("Error toggling publish status:", error);
    res.status(500).json({ message: "Failed to update publish status" });
  }
});

module.exports = router;
