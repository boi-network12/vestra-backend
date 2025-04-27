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
  replyTo: {
    type: String,
    default: null
  },
  encrypted: { type: Boolean, default: false }, 
  files: [
    {
      url: { type: String, required: true },
      type: {
        type: String,
        enum: ['image', 'video', 'audio', 'file', 'gif'],
        required: true,
      },
      name: { type: String, required: true },
      size: { type: Number, required: true },
      thumbnail: { type: String },
      duration: { type: Number }, // Required for audio/video
      width: { type: Number },
      height: { type: Number },
    },
  ],
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