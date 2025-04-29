const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { promisify } = require('util');
const axios = require('axios');
const axiosRetry = require('axios-retry');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const User = require('../model/userModel');
const { fileTypeFromFile } = require('file-type'); 

// Configure Cloudinary
cloudinary.config({
  cloud_name: 'dypgxulgp',
  api_key: '974889481585763',
  api_secret: '5jePEULYNugFnPMdyfj1XPiytCI',
});

// Override DNS to use Google DNS
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);

// Configure axios-retry
axiosRetry(axios, {
  retries: 3, // Retry up to 3 times
  retryDelay: (retryCount) => retryCount * 1000, // Wait 1s, 2s, 3s
  retryCondition: (error) => {
    // Retry on network errors (e.g., ENOTFOUND) or 5xx status codes
    return axiosRetry.isNetworkOrIdempotentRequestError(error) || (error.response && error.response.status >= 500);
  },
});


// Configure Sightengine
const SIGHTENGINE_API_USER = "954881564";
const SIGHTENGINE_API_SECRET = "iaVuQm7TfkgWKciSQhGsQZXcfqVmCAe2";

const allowedTypes = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/x-msvideo',
  'video/x-matroska'
];

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const uploadDir = path.join(__dirname, '../Uploads');
      console.log('Ensuring upload directory exists:', uploadDir);
      fs.mkdirSync(uploadDir, { recursive: true });
      cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const filename = `${Date.now()}${ext}`;
      console.log('Saving file as:', filename);
      cb(null, filename);
    },
  }),
  fileFilter: (req, file, cb) => {
    // Log file details for debugging
    console.log('File received:', file);

    // Check if file and mimetype are defined
    if (!file || !file.mimetype) {
      console.warn('Invalid file or missing mimetype:', file);
      return cb(new Error('Invalid file: missing MIME type'));
    }

    // Check total files
    const totalFiles = req.files ? req.files.length + (req.files.media ? req.files.media.length : 0) : 0;
    if (totalFiles >= 4) {
      console.warn('Too many files uploaded');
      return cb(new Error('Maximum of 4 media files allowed'));
    }

    // Check video count
    const videoCount = req.files
      ? req.files.filter(f => f.mimetype && f.mimetype.startsWith('video/')).length
      : 0;
    if (file.mimetype.startsWith('video/') && videoCount >= 2) {
      console.warn('Too many video files uploaded');
      return cb(new Error('Maximum of 2 video files allowed'));
    }

    // Check declared MIME type
    if (!allowedTypes.includes(file.mimetype)) {
      console.warn(`Invalid MIME type: ${file.originalname}, mime: ${file.mimetype}`);
      return cb(
        new Error(
          `Invalid file type: ${file.originalname}. Only JPEG, PNG, GIF, WebP, MP4, MOV, WebM, AVI, and MKV are allowed.`
        )
      );
    }

    // Accept the file (content validation will happen later)
    cb(null, true);
  },
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB
    files: 4 // Enforce max 4 files
  },
});



// Check for NSFW content using Sightengine
const checkForNSFW = async (filePath) => {
  console.log('Processing file:', filePath);
  try {
    // Check file size (12MB = 12 * 1024 * 1024 bytes)
    const MAX_SIZE_BYTES = 12 * 1024 * 1024;
    const fileStats = fs.statSync(filePath);
    if (fileStats.size > MAX_SIZE_BYTES) {
      throw new Error('File size exceeds 12MB limit for content moderation');
    }

    // Validate file type
    const fileType = await fileTypeFromFile(filePath);
    if (!fileType || !allowedTypes.includes(fileType.mime)) {
      console.warn(`Invalid or unsupported file format: ${filePath}, detected mime: ${fileType?.mime || 'unknown'}`);
      throw new Error('Unsupported file format. Only JPEG, PNG, GIF, WebP, MP4, MOV, WebM, AVI, and MKV are allowed.');
    }

    console.log(`File validated: ${filePath}, mime: ${fileType.mime}, size: ${fileStats.size} bytes`);

    const formData = new FormData();
    formData.append('media', fs.createReadStream(filePath));
    formData.append('models', 'nudity-2.0,wad,offensive,text-content,gore');
    formData.append('api_user', SIGHTENGINE_API_USER);
    formData.append('api_secret', SIGHTENGINE_API_SECRET);

    const response = await axios.post('https://api.sightengine.com/1.0/check.json', formData, {
      headers: formData.getHeaders(),
      timeout: 30000, // 30-second timeout
    });

    const { nudity, weapons, alcohol, drugs, offensive } = response.data;
    
    return {
      isNSFW: nudity.raw > 0.5 || weapons > 0.7 || alcohol > 0.7 || drugs > 0.7 || offensive.prob > 0.7,
      moderationData: response.data
    };
  } catch (error) {
    console.error('Sightengine error:', error);
    throw new Error('Content moderation failed');
  }
};

// Upload to Cloudinary with moderation
const uploadToCloudinary = async (filePath, options = {}) => {
  try {
    const fileExt = path.extname(filePath).toLowerCase();
    let resourceType = 'auto';
    if (['.webp', '.jpg', '.jpeg', '.png', '.gif'].includes(fileExt)) {
      resourceType = 'image';
    } else if (['.mp4', '.mov', '.webm', '.avi', '.mkv'].includes(fileExt)) {
      resourceType = 'video';
    }

    const uploadResult = await promisify(cloudinary.uploader.upload)(filePath, {
      resource_type: resourceType,
      moderation: 'manual', 
      ...options
    });
    return uploadResult;
  } catch (error) {
    console.error('Cloudinary upload error:', error);
    throw new Error('Failed to upload media');
  }
};

// Process media upload with moderation
exports.processMediaUpload = async (req, res, next) => {
  try {
    if (!req.files || req.files.length === 0) {
      console.log('No files to process');
      return next();
    }

    const mediaFiles = [];
    let nsfwDetected = false;

    for (const file of req.files) {
      console.log(`Processing file: ${file.path}, original: ${file.originalname}, size: ${file.size} bytes`);
      if (!fs.existsSync(file.path)) {
        console.error('File not found:', file.path);
        return res.status(500).json({
          success: false,
          message: `File not found: ${file.path}`
        });
      }

      try {
        // Check for NSFW content
        const { isNSFW } = await checkForNSFW(file.path);
        
        if (isNSFW) {
          nsfwDetected = true;
          fs.unlinkSync(file.path);
          continue;
        }

        // Upload to Cloudinary if not NSFW
        const uploadResult = await uploadToCloudinary(file.path, {
          folder: 'social_media/posts'
        });

        let mediaType;
        if (uploadResult.resource_type === 'image') {
          mediaType = file.mimetype === 'image/gif' ? 'gif' : file.mimetype === 'image/webp' ? 'webp' : 'image';
        } else if (uploadResult.resource_type === 'video') {
          mediaType = 'video';
        }

        mediaFiles.push({
          url: uploadResult.secure_url,
          mediaType,
          publicId: uploadResult.public_id,
          width: uploadResult.width,
          height: uploadResult.height,
          duration: uploadResult.duration
        });

        fs.unlinkSync(file.path);
      } catch (error) {
        fs.unlinkSync(file.path); // Clean up file on error
        if (error.message.includes('File size exceeds 12MB')) {
          return res.status(400).json({
            success: false,
            message: 'Media file is too large. Maximum size is 12MB.'
          });
        }
        throw error; // Rethrow other errors
      }
    }

    if (nsfwDetected && mediaFiles.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Uploaded content violates our community guidelines'
      });
    }

    req.mediaFiles = mediaFiles;
    next();
  } catch (error) {
    console.error('Media processing error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to process media upload'
    });
  }
};

// Multer upload middleware
exports.uploadMedia = (fieldName, maxCount = 10) => {
  return upload.array(fieldName, maxCount);
};

// Handle NSFW violations
exports.handleNSFWViolation = async (userId) => {
  try {
    const user = await User.findById(userId);
    if (!user) return;

    // First offense: 60-day suspension
    if (!user.nsfwViolations || user.nsfwViolations.length === 0) {
      user.disabled = true;
      user.disabledUntil = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000); // 60 days
      user.nsfwViolations = [{
        date: new Date(),
        action: '60-day suspension'
      }];
      await user.save();
      return;
    }

    // Second offense: Permanent ban
    user.disabled = true;
    user.disabledUntil = null; // Permanent
    user.nsfwViolations.push({
      date: new Date(),
      action: 'permanent ban'
    });
    await user.save();
  } catch (error) {
    console.error('Error handling NSFW violation:', error);
  }
};