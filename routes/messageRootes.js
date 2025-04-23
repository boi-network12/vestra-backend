// messageRoutes.js
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const { writeFile, unlink } = require('fs').promises;
const axios = require('axios'); // Add axios for fetching files
const { generateLinkPreview } = require('../utils/linkPreview');

// Configure Cloudinary
cloudinary.config({
  cloud_name: 'dypgxulgp',
  api_key: "974889481585763",
  api_secret: "5jePEULYNugFnPMdyfj1XPiytCI",
});

// Configure Multer with Cloudinary
const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'chat_files',
    allowed_formats: ['jpg', 'jpeg', 'png', 'gif', 'mp4', 'mov', 'avi', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'mp3', 'wav'],
    resource_type: 'auto'
  },
});

const upload = multer({ 
  storage,
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

// Helper function to generate thumbnail for videos
const generateVideoThumbnail = async (filePath, outputPath) => {
  return new Promise((resolve, reject) => {
    ffmpeg(filePath)
      .on('end', () => resolve(outputPath))
      .on('error', (err) => reject(err))
      .screenshots({
        timestamps: [0],
        filename: 'thumbnail.png',
        folder: path.dirname(outputPath),
        size: '320x240'
      });
  });
};

// Upload multiple files to Cloudinary with enhanced processing
router.post('/upload', protect, upload.array('files', 10), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    const uploadedFiles = await Promise.all(req.files.map(async (file) => {
      const fileData = {
        url: file.path,
        type: file.mimetype.split('/')[0], // 'image', 'video', 'audio', etc.
        name: file.originalname,
        size: file.size
      };

      // Process videos to generate thumbnails
      if (file.mimetype.startsWith('video/')) {
        try {
          // Download the video from Cloudinary
          const tempFilePath = path.join('/tmp', `temp_${file.filename}`);
          const response = await axios.get(file.path, { responseType: 'arraybuffer' });
          await writeFile(tempFilePath, Buffer.from(response.data));
          
          const thumbnailPath = path.join('/tmp', `thumb_${file.filename}.png`);
          await generateVideoThumbnail(tempFilePath, thumbnailPath);
          
          // Upload thumbnail to Cloudinary
          const thumbResult = await cloudinary.uploader.upload(thumbnailPath, {
            folder: 'chat_thumbnails'
          });
          
          fileData.thumbnail = thumbResult.secure_url;
          
          // Get video dimensions and duration
          const metadata = await new Promise((resolve, reject) => {
            ffmpeg.ffprobe(tempFilePath, (err, metadata) => {
              if (err) reject(err);
              else resolve(metadata);
            });
          });
          
          if (metadata.streams && metadata.streams[0]) {
            const videoStream = metadata.streams.find(s => s.codec_type === 'video');
            if (videoStream) {
              fileData.width = videoStream.width;
              fileData.height = videoStream.height;
              fileData.duration = Math.floor(metadata.format.duration);
            }
          }
          
          // Clean up temp files
          await unlink(tempFilePath);
          await unlink(thumbnailPath);
        } catch (err) {
          console.error('Error processing video:', err);
          // Continue without thumbnail if processing fails
        }
      }
      
      // Process images to get dimensions
      if (file.mimetype.startsWith('image/')) {
        try {
          // Fetch image metadata from Cloudinary
          const resource = await cloudinary.api.resource(file.filename, {
            resource_type: 'image'
          });
          
          fileData.width = resource.width;
          fileData.height = resource.height;
        } catch (err) {
          console.error('Error fetching image dimensions from Cloudinary:', err);
          // Optionally, fallback to downloading and processing locally
          try {
            const tempFilePath = path.join('/tmp', `img_${file.filename}`);
            const response = await axios.get(file.path, { responseType: 'arraybuffer' });
            await writeFile(tempFilePath, Buffer.from(response.data));
            
            const metadata = await new Promise((resolve, reject) => {
              ffmpeg.ffprobe(tempFilePath, (err, metadata) => {
                if (err) reject(err);
                else resolve(metadata);
              });
            });
            
            if (metadata.streams && metadata.streams[0]) {
              fileData.width = metadata.streams[0].width;
              fileData.height = metadata.streams[0].height;
            }
            
            await unlink(tempFilePath);
          } catch (fallbackErr) {
            console.error('Error processing image dimensions locally:', fallbackErr);
          }
        }
      }

      return fileData;
    }));

    res.json(uploadedFiles);
  } catch (error) {
    console.error('File upload error:', error);
    res.status(500).json({ error: 'Failed to upload files' });
  }
});

// Generate link preview
router.post('/link-preview', protect, async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    const preview = await generateLinkPreview(url);
    if (!preview) {
      return res.status(404).json({ error: 'Could not generate link preview' });
    }

    res.json(preview);
  } catch (error) {
    console.error('Error generating link preview:', error);
    res.status(500).json({ error: 'Failed to generate link preview' });
  }
});

module.exports = router;