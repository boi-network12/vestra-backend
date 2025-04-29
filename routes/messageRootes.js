const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const { writeFile, unlink } = require('fs').promises;
const axios = require('axios');
const { generateLinkPreview } = require('../utils/linkPreview');
const User = require('../model/userModel');
const Message = require('../model/Message');
const { aiMessage } = require('../controllers/aiMessageController');

// Configure Cloudinary
cloudinary.config({
  cloud_name: 'dypgxulgp',
  api_key: '974889481585763',
  api_secret: '5jePEULYNugFnPMdyfj1XPiytCI',
});


// Configure Multer with Cloudinary
const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'chat_files',
    allowed_formats: [
      'jpg', 'jpeg', 'png', 'gif',
      'mp4', 'mov', 'avi', '3gp', 
      'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt',
      'mp3', 'wav', 'm4a',
    ],
    resource_type: 'auto',
  },
});

const extensionToType = {
  jpg: 'image', jpeg: 'image', png: 'image', gif: 'image',
  mp4: 'video', mov: 'video', avi: 'video', '3gp': 'video',
  mp3: 'audio', wav: 'audio', m4a: 'audio',
  pdf: 'file', doc: 'file', docx: 'file', xls: 'file', xlsx: 'file',
  ppt: 'file', pptx: 'file', txt: 'file',
};

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
});

// Helper function to get audio duration
const getAudioDuration = async (filePath) => {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) return reject(err);
      const duration = metadata.format.duration || 0;
      resolve(duration);
    });
  });
};

// Helper function to generate video thumbnail
const generateVideoThumbnail = async (filePath, outputPath) => {
  return new Promise((resolve, reject) => {
    ffmpeg(filePath)
      .on('end', () => resolve(outputPath))
      .on('error', (err) => reject(err))
      .screenshots({
        timestamps: [0],
        filename: 'thumbnail.png',
        folder: path.dirname(outputPath),
        size: '320x240',
      });
  });
};

router.put('/:messageId', protect, async (req, res) => {
  try {
    const { messageId } = req.params;
    const { newText } = req.body;
    const userId = req.user.id;

    const message = await Message.findOne({ _id: messageId, sender: userId });
    if (!message) {
      return res.status(404).json({ error: 'Message not found or unauthorized' });
    }

    // Check edit conditions
    const timeLimit = 15 * 60 * 1000; // 15 minutes
    const withinTimeLimit = new Date() - new Date(message.createdAt) <= timeLimit;
    const notRead = message.status !== 'read';
    if (!withinTimeLimit || !notRead || !message.text) {
      return res.status(400).json({ error: 'Cannot edit this message' });
    }

    message.text = newText;
    message.edited = true;
    message.updatedAt = new Date();
    await message.save();

    res.json({ message: 'Message updated successfully' });
  } catch (error) {
    console.error('Error editing message:', error);
    res.status(500).json({ error: 'Failed to edit message' });
  }
});


// Upload multiple files to Cloudinary with enhanced processing
router.post('/upload', protect, upload.array('files', 10), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    const uploadedFiles = await Promise.all(
      req.files.map(async (file) => {
        const extension = file.originalname.split('.').pop().toLowerCase();
        const fileType = extensionToType[extension] || 'file';

        const fileData = {
          url: file.path,
          type: fileType,
          name: file.originalname,
          size: file.size,
        };

        // Create temporary file path
        const tempFilePath = path.join('/tmp', `temp_${file.filename}`);
        let tempFiles = [tempFilePath];

        try {
          // Download file from Cloudinary
          const response = await axios.get(file.path, { responseType: 'arraybuffer' });
          await writeFile(tempFilePath, Buffer.from(response.data));

          // Process videos
          if (file.mimetype.startsWith('video/')) {
            const thumbnailPath = path.join('/tmp', `thumb_${file.filename}.png`);
            tempFiles.push(thumbnailPath);

            await generateVideoThumbnail(tempFilePath, thumbnailPath);

            // Upload thumbnail to Cloudinary
            const thumbResult = await cloudinary.uploader.upload(thumbnailPath, {
              folder: 'chat_thumbnails',
            });
            fileData.thumbnail = thumbResult.secure_url;

            // Get video metadata
            const metadata = await new Promise((resolve, reject) => {
              ffmpeg.ffprobe(tempFilePath, (err, metadata) => {
                if (err) reject(err);
                else resolve(metadata);
              });
            });

            const videoStream = metadata.streams.find((s) => s.codec_type === 'video');
            if (videoStream) {
              fileData.width = videoStream.width;
              fileData.height = videoStream.height;
              fileData.duration = Math.floor(metadata.format.duration);
            }
          }

          // Process audio (voice notes)
          if (file.mimetype.startsWith('audio/')) {
            const duration = await getAudioDuration(tempFilePath);
            fileData.duration = Math.floor(duration);
          }

          // Process images
          if (file.mimetype.startsWith('image/')) {
            const metadata = await new Promise((resolve, reject) => {
              ffmpeg.ffprobe(tempFilePath, (err, metadata) => {
                if (err) reject(err);
                else resolve(metadata);
              });
            });

            const imageStream = metadata.streams.find((s) => s.codec_type === 'video');
            if (imageStream) {
              fileData.width = imageStream.width;
              fileData.height = imageStream.height;
            }
          }
        } catch (err) {
          console.error(`Error processing file ${file.originalname}:`, err);
          // Continue with basic file data if processing fails
        } finally {
          // Clean up temporary files
          await Promise.all(
            tempFiles.map(async (filePath) => {
              try {
                await unlink(filePath);
              } catch (unlinkErr) {
                console.error(`Error unlinking ${filePath}:`, unlinkErr);
              }
            })
          );
        }

        return fileData;
      })
    );

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

module.exports = (io) => {
  // ... existing routes
  router.post('/ai-message', protect, aiMessage)

  router.delete('/:messageId', protect, async (req, res) => {
    try {
      const { messageId } = req.params;
      const userId = req.user.id;
      console.log('Deleting message:', { messageId, userId });
      const message = await Message.findOneAndDelete({ _id: messageId, sender: userId });
      if (!message) {
        console.log('Message not found or unauthorized:', { messageId, userId });
        return res.status(404).json({ error: 'Message not found or unauthorized' });
      }
      // Use the passed io instance
      io.to(`chat_${message.chatId}`).emit('message-deleted', { messageId });
      res.json({ message: 'Message deleted successfully' });
    } catch (error) {
      console.error('Error deleting message:', error);
      res.status(500).json({ error: 'Failed to delete message' });
    }
  });

  // ... other routes

  return router;
};