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

// Configure Cloudinary
cloudinary.config({
  cloud_name: 'dypgxulgp',
  api_key: '974889481585763',
  api_secret: '5jePEULYNugFnPMdyfj1XPiytCI',
});

  const GEMINI_API_KEY = '';
  const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent';

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

router.post('/ai-message', protect, async (req, res) => {
  try {
    const { message, userName } = req.body;

    const user = await User.findById(req.user.id).select(
      'name username email bio interests country settings lastActive'
    );

    if (!user) {
      const user = await User.findById(req.user.id).select(
        'name username email bio interests country settings lastActive'
      );
    }

    // Define the system prompt with user context
    const systemPrompt = `
      You are Vestra AI, a friendly and helpful assistant created for the Vestra app. 
      You are talking to ${user.name} (username: ${user.username}). 
      User details:
      - Bio: ${user.bio || 'Not provided'}
      - Interests: ${user.interests.join(', ') || 'None'}
      - Country: ${user.country || 'Not provided'}
      - Notification Settings: ${JSON.stringify(user.settings.notifications)}
      - Privacy Settings: ${JSON.stringify(user.settings.privacy)}
      - Last Active: ${user.lastActive.toISOString()}
      Always respond as Vestra AI, avoid mentioning any other identity, and tailor responses based on the user's data when relevant.
    
      If the user asks to update their profile, such as:
      - "update my bio to [new bio]"
      - "update my name to [new name]"
      - "update my interests to [interest1, interest2]"
      - "update my username to [new username]"
      Confirm the action and indicate that the update will be processed. For example:
      - User: "update my bio to I love coding"
      - Response: "Got it! I've updated your bio to 'I love coding'. Anything else you'd like to change?"
      Ensure the request is clear and valid. If the request is ambiguous (e.g., "update my profile"), ask for clarification, like: "Could you specify what you'd like to update? For example, your bio, name, or interests."
      Do not process updates for sensitive fields like email or password without additional verification steps.
    `;

    //  check if the message is an update request
    const updateBioRegex = /update my bio\s+(.+)/i;
    const match = message.match(updateBioRegex);

    if (match) {
      const newBio = match[1].trim();

      // Validate the new bio
      if (newBio.length > 160) { 
        return res.json({ text: "Sorry, the bio is too long. Please keep it under 160 characters." });
      }

      // Update the user's bio using the updateUser logic
      try {
        const updatedUser = await User.findByIdAndUpdate(
          req.user.id,
          { bio: newBio },
          { new: true, runValidators: true }
        ).select('-password -verificationCode -verificationExpires');

        if (!updatedUser) {
          return res.status(500).json({ error: 'Failed to update bio' });
        }

        // Respond with confirmation
        return res.json({ text: `Got it! I've updated your bio to "${newBio}". Anything else you'd like to change?` });
      } catch (err) {
        console.error('Bio update error:', err);
        return res.json({ text: 'Sorry, I encountered an error while updating your bio. Please try again later.' });
      }
    }


    // Combine system prompt with user message
    const prompt = `${systemPrompt}\n\nUser: ${message}`;

    const response = await axios.post(
      `${GEMINI_API_URL}?key=${process.env.GEMINI_API_KEY}`,
      {
        contents: [
          {
            parts: [
              {
                text: prompt,
              },
            ],
          },
        ],
      },
      { headers: { 'Content-Type': 'application/json' } }
    );

    const aiResponse = response.data.candidates[0]?.content?.parts[0]?.text || 'No response';
    res.json({ text: aiResponse });
  } catch (error) {
    console.error('AI message error:', error);
    res.status(500).json({ error: 'Failed to get AI response' });
  }
});

module.exports = router;