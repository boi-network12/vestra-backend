const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: [true, 'Username is required'],
    unique: true,
    trim: true,
    minlength: [3, 'Username must be at least 3 characters'],
    maxlength: [30, 'Username cannot exceed 30 characters'],
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email address'],
  },
  phoneNumber: {
    type: String,
    default: ""
  },
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: [8, 'Password must be at least 8 characters'],
    select: false,
  },
  passwordChangedAt: Date,
  passwordResetToken: String,
  passwordResetExpires: Date,
  profile: {
    firstName: { type: String, trim: true },
    lastName: { type: String, trim: true },
    bio: { type: String, maxlength: 500, trim: true },
    avatar: { type: String, default: '' },
    coverPhoto: { type: String, default: '' },
    location: {
      city: String,
      country: String,
      coordinates: {
        type: [Number], // [longitude, latitude]
        index: '2dsphere',
      },
    },
    culturalBackground: {
      type: String,
      enum: ['African', 'African-American', 'Caribbean', 'Other', 'Prefer not to say'],
      default: 'Prefer not to say',
    },
    interests: [{ type: String, trim: true }],
  },
  subscription: {
    plan: {
      type: String,
      enum: ['Basic', 'Premium', 'Elite'],
      default: 'Basic',
    },
    status: {
      type: String,
      enum: ['active', 'inactive', 'expired'],
      default: 'inactive',
    },
    expiryDate: Date,
    features: {
      blueTick: { type: Boolean, default: false },
      dailyPostLimit: { type: Number, default: 10 }, // Basic: 10, Premium: 50, Elite: Unlimited
      analyticsAccess: { type: Boolean, default: false },
      prioritySupport: { type: Boolean, default: false },
    },
  },
  role: {
    type: String,
    enum: ['user', 'moderator', 'admin'],
    default: 'user',
  },
  isVerified: {
    type: Boolean,
    default: false,
  },
  verificationMethod: {
    type: String,
    enum: ['email', 'manual'],
    default: 'email',
  },
  verificationToken: String,
  verificationTokenExpires: Date,
  sessions: [{
    token: { type: String, required: true },
    device: { type: String, default: 'unknown' },
    ipAddress: { type: String },
    lastActive: { type: Date, default: Date.now },
    active: { type: Boolean, default: true },
  }],
  followers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  following: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  blockedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  privacySettings: {
    profileVisibility: {
      type: String,
      enum: ['public', 'followers', 'private'],
      default: 'public',
    },
    showLocation: { type: Boolean, default: false },
    showEmail: { type: Boolean, default: false },
  },
  notificationSettings: {
    emailNotifications: { type: Boolean, default: true },
    pushNotifications: { type: Boolean, default: true },
    mentions: { type: Boolean, default: true },
    follows: { type: Boolean, default: true },
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
}, {
  timestamps: true,
});

// Password hashing
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

// Update passwordChangedAt
userSchema.pre('save', function (next) {
  if (this.isModified('password') && !this.isNew) {
    this.passwordChangedAt = Date.now() - 1000;
  }
  next();
});

// Update subscription features based on plan
userSchema.pre('save', function (next) {
  if (this.isModified('subscription.plan')) {
    switch (this.subscription.plan) {
      case 'Premium':
        this.subscription.features = {
          blueTick: true,
          dailyPostLimit: 50,
          analyticsAccess: true,
          prioritySupport: false,
        };
        break;
      case 'Elite':
        this.subscription.features = {
          blueTick: true,
          dailyPostLimit: Infinity,
          analyticsAccess: true,
          prioritySupport: true,
        };
        break;
      default:
        this.subscription.features = {
          blueTick: false,
          dailyPostLimit: 10,
          analyticsAccess: false,
          prioritySupport: false,
        };
    }
  }
  next();
});

// Check if password was changed after token issuance
userSchema.methods.changedPasswordAfter = function (JWTTimestamp) {
  if (this.passwordChangedAt) {
    const changedTimestamp = parseInt(this.passwordChangedAt.getTime() / 1000, 10);
    return JWTTimestamp < changedTimestamp;
  }
  return false;
};

// Create password reset token
userSchema.methods.createPasswordResetToken = function () {
  const resetToken = crypto.randomBytes(32).toString('hex');
  this.passwordResetToken = crypto
    .createHash('sha256')
    .update(resetToken)
    .digest('hex');
  this.passwordResetExpires = Date.now() + 10 * 60 * 1000; // 10 minutes
  return resetToken;
};

// Create verification token
userSchema.methods.createVerificationToken = function () {
  const verificationToken = Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit numeric code
  this.verificationToken = crypto
    .createHash('sha256')
    .update(verificationToken)
    .digest('hex');
  this.verificationTokenExpires = Date.now() + 10 * 60 * 1000; // 10 minutes
  return verificationToken;
};

userSchema.add({
  verificationAttempts: {
    count: { type: Number, default: 0 },
    lastAttempt: { type: Date },
  },
});

// Compare password
userSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('User', userSchema);