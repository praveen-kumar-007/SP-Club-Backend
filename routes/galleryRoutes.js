const express = require("express");
const router = express.Router();
const Gallery = require("../models/gallery");
const { uploadGallery, cloudinary } = require("../config/cloudinary");
const { authenticateAdmin } = require("../middleware/auth");

// @route   GET /api/gallery
// @desc    Get all gallery images
// @access  Public
router.get("/", async (req, res) => {
  try {
    const images = await Gallery.find().sort({ createdAt: -1 });
    res.json(images);
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
});

// @route   POST /api/gallery
// @desc    Upload a new gallery image
// @access  Private (Admin only)
router.post("/", authenticateAdmin, uploadGallery.single("image"), async (req, res) => {
  try {
    const { title, description, category } = req.body;

    if (!req.file) {
      return res.status(400).json({ msg: "Please upload an image" });
    }

    const newImage = new Gallery({
      title,
      description,
      category: category || "Others",
      imageUrl: req.file.path,
      publicId: req.file.filename,
    });

    const savedImage = await newImage.save();
    res.json(savedImage);
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
});

// @route   DELETE /api/gallery/:id
// @desc    Delete a gallery image
// @access  Private (Admin only)
router.delete("/:id", authenticateAdmin, async (req, res) => {
  try {
    const image = await Gallery.findById(req.params.id);

    if (!image) {
      return res.status(404).json({ msg: "Image not found" });
    }

    // Delete image from cloudinary
    if (image.publicId) {
      await cloudinary.uploader.destroy(image.publicId);
    }

    await image.deleteOne();
    res.json({ msg: "Image removed" });
  } catch (err) {
    console.error(err.message);
    if (err.kind === "ObjectId") {
      return res.status(404).json({ msg: "Image not found" });
    }
    res.status(500).send("Server Error");
  }
});

module.exports = router;
