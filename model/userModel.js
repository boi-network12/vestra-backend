const mongoose = require("mongoose");

const userSchema = mongoose.Schema({
    name: {
        type: String,
        required: true,
    },
    username: {
        type: String,
        required: true,
        unique: true,
        trim: true,
    },
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true
    },
    phoneNumber: {
        type: String,
    },
    bio: {
        type: String,
        default: "",
        trim: true
    },
    link: {
        type: String,
        default: "",
        trim: true
    },
    password: {
        type: String,
        required: true,
        select: false
    },
    country: {
        type: String,
        default: ""
    },
    dateOfBirth: {
        type: Date
    },
    role: {
        type: String,
        enum: ['user', 'admin', 'moderator'],
        default: 'user'
    },
    profilePicture: {
        type: String,
        default: ""
    },
    following: [{ 
        type: mongoose.Schema.Types.ObjectId, 
        ref: "User" 
    }],
    followers: [{ 
        type: mongoose.Schema.Types.ObjectId, 
        ref: "User" 
    }],
    blockedUsers: [{ 
        type: mongoose.Schema.Types.ObjectId, 
        ref: "User" 
    }],
    ActiveIndicator: {
        type: Boolean,
        default: false
    },
    disabled: {
        type: Boolean,
        default: false
    },
    interests: {
        type: [String],
        default: []
    },
    lastActive: {
        type: Date,
        default: Date.now
    },
    verified: {
        type: Boolean,
        default: false
    },
    verificationCode: {
        type: String,
        select: false
    },
    verificationExpires: {
        type: Date,
        select: false
    },
    devices: [{
        deviceId: String, // Unique device identifier
        deviceName: String,
        deviceType: String,
        os: String,
        ipAddress: String,
        lastLogin: Date,
        token: String,
        isCurrent: Boolean,
        location: {
          country: String,
          region: String,
          city: String
        }
      }],
    lastLogin: Date,
    ipAddress: String,
    settings: {
        notifications: {
            email: { type: Boolean, default: true },
            push: { type: Boolean, default: true },
            friendRequests: { type: Boolean, default: true },
            messages: { type: Boolean, default: true },
            mentions: { type: Boolean, default: true },
            postLikes: { type: Boolean, default: true }, 
            postComments: { type: Boolean, default: true } 
        },
        privacy: {
            profileVisibility: { 
                type: String, 
                enum: ['public', 'friends', 'private'], 
                default: 'friends' 
            },
            searchVisibility: { type: Boolean, default: true },
            activityVisibility: { 
                type: String, 
                enum: ['public', 'friends', 'private'], 
                default: 'friends' 
              },
              messageRequests: { 
                type: String, 
                enum: ['public', 'friends', 'none'], 
                default: 'friends' 
            }
        }
    }
}, {
    timestamps: true,
});

// Password changed method
userSchema.methods.changedPasswordAfter = function(JWTTimestamp) {
    if (this.passwordChangedAt) {
        const changedTimestamp = parseInt(this.passwordChangedAt.getTime() / 1000, 10);
        return JWTTimestamp < changedTimestamp;
    }
    return false;
};


// Method to compare passwords
userSchema.methods.correctPassword = async function(candidatePassword, userPassword) {
  return await bcrypt.compare(candidatePassword, userPassword);
};

module.exports = mongoose.model("User", userSchema);
