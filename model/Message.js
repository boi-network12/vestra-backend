const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  _id: { type: String, required: true }, 
  chatId: {
    type: String,
    required: true,
    index: true
  },
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  recipient: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  text: {
    type: String,
    default: ''
  },
  encrypted: { type: Boolean, default: false }, 
  files: [{
    url: { type: String, required: true }, // Cloudinary URL
    type: { 
      type: String, 
      enum: ['image', 'video', 'file', 'audio'], 
      required: true 
    },
    name: { type: String }, // Original file name
    size: { type: Number }, // File size in bytes
    thumbnail: { type: String }, // For videos/images
    duration: { type: Number }, // For audio/video
    width: { type: Number }, // For images/videos
    height: { type: Number } // For images/videos
  }],
  linkPreview: {
    url: { type: String },
    title: { type: String },
    description: { type: String },
    image: { type: String },
    siteName: { type: String }
  },
  status: {
    type: String,
    enum: ['sending', 'sent', 'delivered', 'read', 'failed'],
    default: 'sent'
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  }
}, {
  timestamps: true
});

// Index for faster querying
messageSchema.index({ chatId: 1, createdAt: -1 });

module.exports = mongoose.model('Message', messageSchema);