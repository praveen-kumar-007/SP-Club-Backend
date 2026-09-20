// config/cloudinary.js
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');

// Configure Cloudinary
if (process.env.NODE_ENV === 'development') {
  console.log('🔧 Cloudinary Configuration:');
  console.log('Cloud Name:', process.env.CLOUDINARY_CLOUD_NAME);
  console.log('API Key:', process.env.CLOUDINARY_API_KEY ? '***' + process.env.CLOUDINARY_API_KEY.slice(-4) : 'NOT SET');
  console.log('API Secret:', process.env.CLOUDINARY_API_SECRET ? '***SET***' : 'NOT SET');
}

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Configure Cloudinary storage for multer
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'sp-club/passports', // Folder name in Cloudinary
    allowed_formats: ['jpg', 'jpeg', 'png', 'gif', 'webp'],
    transformation: [{ width: 500, height: 500, crop: 'limit' }], // Optimize images
    public_id: (req, file) => {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      return 'passport-' + uniqueSuffix;
    }
  }
});

const fileFilter = (req, file, cb) => {
  // Accept images only
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Only image files are allowed!'), false);
  }
};

const upload = multer({ 
  storage: storage,
  fileFilter: fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// Configure Cloudinary storage for gallery
const galleryStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'sp-club/gallery',
    allowed_formats: ['jpg', 'jpeg', 'png', 'gif', 'webp'],
    transformation: [{ width: 1200, height: 1200, crop: 'limit', quality: 'auto' }],
    public_id: (req, file) => {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      return 'gallery-' + uniqueSuffix;
    }
  }
});

const uploadGallery = multer({
  storage: galleryStorage,
  fileFilter: fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit for gallery images
});

// Configure Cloudinary storage for application letters and official documents (PDF, JPG, PNG, WEBP)
const docStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    const isPdf = file.mimetype === 'application/pdf';
    return {
      folder: 'sp-club/recovery-documents',
      resource_type: isPdf ? 'raw' : 'auto',
      public_id: `doc-${Date.now()}-${Math.round(Math.random() * 1e9)}`,
    };
  },
});

const docFileFilter = (req, file, cb) => {
  const allowed = [
    'application/pdf',
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
  ];
  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only PDF, JPG, PNG, and WebP document files are allowed!'), false);
  }
};

const uploadDoc = multer({
  storage: docStorage,
  fileFilter: docFileFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
});

module.exports = { cloudinary, upload, uploadGallery, uploadDoc };

