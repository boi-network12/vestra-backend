const mongoose = require('mongoose');
const mongoosePaginate = require('mongoose-paginate-v2');

const postSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  content: {
    type: String,
    trim: true,
    maxlength: 2000
  },
  media: [{
    url: String,
    mediaType: {
      type: String,
      enum: ['image', 'video', 'gif', 'webp']
    },
    publicId: String,
    width: Number,
    height: Number,
    duration: Number 
  }],
  visibility: {
    type: String,
    enum: ['public', 'friends', 'private'],
    default: 'public'
  },
  taggedUsers: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  location: {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point',
    },
    coordinates: {
      type: [Number],
      index: '2dsphere',
      default: [0, 0]
    },
    name: {
      type: String,
      trim: true,
      maxlength: 100,
      default: 'Unknown Location'
    },
  },
  likes: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  likeCount: {
    type: Number,
    default: 0
  },
  commentCount: {
    type: Number,
    default: 0
  },
  shareCount: {
    type: Number,
    default: 0
  },
  isNSFW: {
    type: Boolean,
    default: false
  },
  repost: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Post',
    default: null
  },
  repostCount: {
    type: Number,
    default: 0
  },
  quote: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Post',
    default: null
  },
  bookmarks: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  bookmarkCount: {
    type: Number,
    default: 0,
  },
  viewCount: {
    type: Number,
    default: 0
  },
  isDeleted: {
    type: Boolean,
    default: false
  },
  deletedAt: Date,
  reportedBy: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    reason: String,
    createdAt: {
      type: Date,
      default: Date.now
    }
  }]
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
postSchema.index({ user: 1, createdAt: -1 });
postSchema.index({ location: '2dsphere' });
postSchema.index({ isNSFW: 1 });
postSchema.index({ isDeleted: 1 });
postSchema.index({ bookmarks: 1 });

// Virtual for comments
postSchema.virtual('comments', {
  ref: 'Comment',
  localField: '_id',
  foreignField: 'post'
});

// Pagination plugin
postSchema.plugin(mongoosePaginate);

// Pre-save hook to update counts
postSchema.pre('save', function(next) {
  if (this.isModified('likes')) {
    this.likeCount = this.likes.length;
  }
  if (this.isModified('likes')) {
    this.likeCount = this.likes.length;
  }
  if (this.isModified('bookmarks')) {
    this.bookmarkCount = Math.max(0, this.bookmarks.length);
  }
  next();
});

const Post = mongoose.model('Post', postSchema);

module.exports = Post;