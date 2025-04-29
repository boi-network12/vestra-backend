const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  recipient: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  type: {
    type: String,
    enum: [
      'friend_request',
      'friend_accepted',
      'message',
      'mention',
      'post_like',
      'post_comment',
      'system',
      'tag',
      'follow',
      'comment', 
      'repost', 
      'share',
      'like'
    ],
    required: true
  },
  content: {
    type: String,
    required: true,
    trim: true
  },
  relatedItem: {
    post: {
      type: mongoose.Schema.Types.Mixed,
      required: false
    },
    user: {
      type: mongoose.Schema.Types.Mixed,
      required: false
    }
  },
  referenceId: {
    type: mongoose.Schema.Types.ObjectId,
    refPath: 'referenceModel',
    required: false
  },
  referenceModel: {
    type: String,
    enum: ['Post', 'Message', 'Chat', null],
    required: false
  },
  url: {
    type: String,
    required: false,
    trim: true,
    default: ""
  },
  read: {
    type: Boolean,
    default: false
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high'],
    default: 'medium'
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Index for faster queries
notificationSchema.index({ recipient: 1, createdAt: -1 });
notificationSchema.index({ recipient: 1, read: 1 });

// Clean up old notifications (TTL index - 30 days)
notificationSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 30 * 24 * 60 * 60 }
);

module.exports = mongoose.model('Notification', notificationSchema);