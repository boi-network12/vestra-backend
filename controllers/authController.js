const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../model/userModel");
const Notification = require("../model/Notification");
const { validationResult } = require('express-validator');
const { check } = require('express-validator');
const crypto = require('crypto');
const DeviceDetector = require("node-device-detector");
const { sendVerificationEmail, sendWelcomeEmail } = require("../utils/email");
const detector = new DeviceDetector();


// Validation rules
exports.validateRegister = [
  check('name')
    .trim()
    .notEmpty().withMessage('Name is required')
    .isLength({ min: 2 }).withMessage('Name must be at least 2 characters')
    .matches(/^[a-zA-Z\s]+$/).withMessage('Name can only contain letters and spaces'),
  
  check('username')
    .trim()
    .notEmpty().withMessage('Username is required')
    .isLength({ min: 3 }).withMessage('Username must be at least 3 characters')
    .matches(/^[a-zA-Z0-9_]+$/).withMessage('Username can only contain letters, numbers, and underscores')
    .custom(async (username) => {
      const user = await User.findOne({ username });
      if (user) {
        throw new Error('Username already in use');
      }
    }),
  
  check('email')
    .trim()
    .notEmpty().withMessage('Email is required')
    .isEmail().withMessage('Please enter a valid email')
    .normalizeEmail()
    .custom(async (email) => {
      const user = await User.findOne({ email });
      if (user) {
        throw new Error('Email already in use');
      }
    }),
  
  check('password')
    .notEmpty().withMessage('Password is required')
    .isLength({ min: 6 }).withMessage('Password must be at least 6 characters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#])[A-Za-z\d@$!%*?&#]{6,}$/)
    .withMessage('Password must contain at least one uppercase, one lowercase, one number and one special character (@, $, !, %, *, ?, &, #)')
];

exports.validateLogin = [
  check('email')
    .trim()
    .notEmpty().withMessage('Email is required')
    .isEmail().withMessage('Please enter a valid email'),
  
  check('password')
    .notEmpty().withMessage('Password is required')
];

// // Helper function to generate token
// const generateToken = (userId) => {
//   return jwt.sign({ id: userId }, process.env.JWT_SECRET, {
//     expiresIn: process.env.JWT_EXPIRES_IN || '7d',
//   });
// };

// Improved (add more claims)
const generateToken = (userId) => {
  return jwt.sign(
    { 
      id: userId,
      iss: 'vestro',
      aud: 'react-native'
    }, 
    process.env.JWT_SECRET, 
    {
      expiresIn: process.env.JWT_EXPIRES_IN || '7d',
      algorithm: 'HS256' // explicitly set algorithm
    }
  );
};

// Helper to get client IP
const getClientIp = (req) => {
  return req.headers['x-forwarded-for'] || req.connection.remoteAddress;
};

// Helper to generate verification code
const generateVerificationCode = () => {
  return crypto.randomInt(100000, 999999).toString();
};


// @desc    Register a new user
const registerUser = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      errors: errors.array().map(err => ({
        field: err.param,
        message: err.msg
      }))
    });
  }

  
  try {
    const { name, username, email, password } = req.body;
    const verificationCode = generateVerificationCode();
    const verificationExpires = Date.now() + 10 * 60 * 1000; // 10 minutes

    // Enhanced device detection
    const ipAddress = req.ip;
    const userAgent = req.headers['user-agent'] || 'Unknown';
    const deviceInfo = detector.detect(userAgent);

    // Hash the password before saving
    const hashedPassword = await bcrypt.hash(password, 12);


    const user = await User.create({
      name,
      username,
      email,
      password: hashedPassword,
      verificationCode,
      verificationExpires,
      ipAddress,
      devices: [{
        deviceId: crypto.randomBytes(16).toString('hex'),
        deviceName: deviceInfo.device?.brand || 'Unknown',
        deviceType: deviceInfo.device?.type || 'desktop',
        os: deviceInfo.os?.name || 'Unknown',
        ipAddress,
        isCurrent: true
      }],
      ActiveIndicator: true // User is active after registration
    });

    await sendVerificationEmail(email, name, verificationCode);
    const token = generateToken(user._id);

    res.status(201).json({
      success: true,
      token,
      message: 'Registration successful. Please check your email for verification code.',
      requiresVerification: true
    });
  } catch (err) {
    console.error(`Registration Error: ${err.message}`);
    res.status(500).json({
      success: false,
      message: 'Server error during registration'
    });
  }
};

// Add verification endpoint
const verifyEmail = async (req, res) => {
const { email, code } = req.body;

try {
    const user = await User.findOne({ 
        email,
        verificationCode: code,
        verificationExpires: { $gt: Date.now() }
    });

    if (!user) {
        return res.status(400).json({
            success: false,
            message: 'Invalid or expired verification code'
        });
    }

    user.verified = true;
    user.verificationCode = undefined;
    user.verificationExpires = undefined;
    await user.save();

    // Send welcome email
    await sendWelcomeEmail(user.email, user.name);

    res.status(200).json({
        success: true,
        message: 'Email verified successfully'
    });
} catch (err) {
    console.error(`Verification Error: ${err.message}`);
    res.status(500).json({
        success: false,
        message: 'Server error during verification'
    });
}
};

// @desc    Authenticate user & get token
// @route   POST /api/auth/login
// @access  Public
// Updated loginUser function
const loginUser = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  const { email, password } = req.body;

  try {
    const user = await User.findOne({ email }).select('+password');
    
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    // Compare passwords using bcrypt
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    if (!user.verified) {
      return res.status(403).json({ 
        success: false, 
        message: 'Please verify your email first',
        requiresVerification: true 
      });
    }

    if (user.disabled) {
      return res.status(403).json({ 
        success: false, 
        message: 'Account disabled. Please contact support' 
      });
    }

    // Device detection
    const userAgent = req.headers['user-agent'] || '';
    const deviceInfo = detector.detect(userAgent);
    const ipAddress = getClientIp(req);
    const authToken = req.headers['authorization']?.split(' ')[1] || '';

    // Mark all other devices as not current
    user.devices.forEach(device => {
      device.isCurrent = false;
    });

    // Check if this device already exists
    const existingDeviceIndex = user.devices.findIndex(device => 
      device.deviceId && 
      device.os === (deviceInfo.os?.name || 'Unknown') &&
      device.ipAddress === ipAddress
    );

    const newDevice = {
      deviceId: crypto.randomBytes(16).toString('hex'),
      deviceName: deviceInfo.device?.brand || 'Unknown',
      deviceType: deviceInfo.device?.type || 'desktop',
      os: deviceInfo.os?.name || 'Unknown',
      osVersion: deviceInfo.os?.version || '',
      ipAddress,
      lastLogin: new Date(),
      token: authToken,
      isCurrent: true,
      location: {
        country: req.headers['cf-ipcountry'] || '',
        region: req.headers['cf-region'] || '',
        city: req.headers['cf-ipcity'] || ''
      }
    };

    if (existingDeviceIndex >= 0) {
      // Update existing device
      user.devices[existingDeviceIndex] = {
        ...user.devices[existingDeviceIndex].toObject(),
        ...newDevice
      };
    } else {
      // Add new device
      user.devices.push(newDevice);
    }

    // Update user status
    user.ActiveIndicator = true;
    user.lastActive = new Date();
    user.lastLogin = new Date();
    user.ipAddress = ipAddress;

    await user.save();

    // Fetch recent or unread notifications
    const notifications = await Notification.find({ recipient: user._id, read: false })
      .sort({ createdAt: -1 })
      .limit(10)
      .populate('sender', 'name username profilePicture');

    const token = generateToken(user._id);
    user.password = undefined;

    res.status(200).json({
      success: true,
      token,
      data: user,
      notifications,
      message: 'Login successful'
    });

  } catch (err) {
    console.error(`Login Error: ${err.message}`);
    res.status(500).json({
      success: false,
      message: 'Server error during login'
    });
  }
};

// @desc    Logout user (clear current device session)
// @route   POST /api/v1/auth/logout
// @access  Private
const logoutUser = async (req, res) => {
  try {
    // 1) Get user from database
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // 2) Get the current JWT token from request
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'No authorization token provided'
      });
    }

    // 3) Find and update the current device
    let deviceUpdated = false;
    user.devices = user.devices.map(device => {
      if (device.token === token) {
        device.isCurrent = false;
        device.token = ''; // Clear the token
        deviceUpdated = true;
      }
      return device;
    });

    if (!deviceUpdated) {
      return res.status(400).json({
        success: false,
        message: 'No active session found for this device'
      });
    }

    // 4) Update user status if no other devices are active
    const hasActiveDevices = user.devices.some(device => device.isCurrent);
    user.ActiveIndicator = hasActiveDevices;
    
    await user.save();

    // 5) Respond with success
    res.status(200).json({
      success: true,
      message: 'Logout successful'
    });

  } catch (err) {
    console.error(`Logout Error: ${err.message}`);
    res.status(500).json({
      success: false,
      message: 'Server error during logout'
    });
  }
};

// @desc    Logout user from all devices
// @route   POST /api/v1/auth/logout-all
// @access  Private
const logoutAllDevices = async (req, res) => {
  try {
    // 1) Get user from database
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // 2) Clear all device sessions
    user.devices = user.devices.map(device => {
      device.isCurrent = false;
      device.token = '';
      return device;
    });

    // 3) Update user status
    user.ActiveIndicator = false;
    
    await user.save();

    // 4) Respond with success
    res.status(200).json({
      success: true,
      message: 'Logged out from all devices successfully'
    });

  } catch (err) {
    console.error(`Logout All Error: ${err.message}`);
    res.status(500).json({
      success: false,
      message: 'Server error during logout from all devices'
    });
  }
};

// @desc    Get current user
// @route   GET /api/auth/me
// @access  Private
// @desc    Get current user
// @route   GET /api/auth/me
// @access  Private
const getCurrentUser = async (req, res) => {
  try {
    console.log('Fetching user with ID:', req.user.id);
    
    const user = await User.findById(req.user.id)
      .select('-password -__v')
      .lean(); // Convert to plain JavaScript object
    
    if (!user) {
      console.error('User not found with ID:', req.user.id);
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    console.log('Successfully fetched user:', user._id);
    
    res.status(200).json({
      success: true,
      data: user,
      message: 'User retrieved successfully'
    });
  } catch (err) {
    console.error('Error in getCurrentUser:', {
      message: err.message,
      stack: err.stack,
      userID: req.user?.id
    });
    
    res.status(500).json({
      success: false,
      message: 'Server error while retrieving user',
      error: process.env.NODE_ENV === 'development' ? {
        message: err.message,
        stack: err.stack
      } : undefined
    });
  }
};

// @route   PUT /api/users/update
// @access  Private
const updateUser = async (req, res) => {
  const { name, username, email, phoneNumber, bio, link, password, profilePicture, country, dateOfBirth, settings } = req.body;
  const io = req.io;

  try {
    // Check if username or email is being updated to an existing one
    if (username || email) {
      const existingUser = await User.findOne({
        $or: [{ username }, { email }],
        _id: { $ne: req.user.id }, // use req.user.id instead of userId
      });

      if (existingUser) {
        return res.status(409).json({
          success: false,
          message: "Username or email already in use by another user",
        });
      }
    }

    // Prepare update fields
    const updateFields = {};
    if (name) updateFields.name = name;
    if (username) updateFields.username = username;
    if (email) updateFields.email = email;
    if (phoneNumber) updateFields.phoneNumber = phoneNumber;
    if (profilePicture) updateFields.profilePicture = profilePicture;
    if (country) updateFields.country = country;
    if (dateOfBirth) updateFields.dateOfBirth = dateOfBirth;
    if (bio) updateFields.bio = bio;
    if (link) updateFields.link = link;

    // Handle settings updates
    if (settings) {
      updateFields.settings = {};
      
      if (settings.notifications) {
        updateFields.settings.notifications = {};
        const notificationFields = ['email', 'push', 'friendRequests', 'messages', 'mentions', 'postLikes', 'postComments'];
        notificationFields.forEach(field => {
          if (settings.notifications[field] !== undefined) {
            updateFields.settings.notifications[field] = settings.notifications[field];
          }
        });
      }
      
      if (settings.privacy) {
        updateFields.settings.privacy = {};
        const privacyFields = ['profileVisibility', 'searchVisibility', 'activityVisibility', 'messageRequests'];
        privacyFields.forEach(field => {
          if (settings.privacy[field] !== undefined) {
            updateFields.settings.privacy[field] = settings.privacy[field];
          }
        });
      }
    }

    
    if (password) {
      updateFields.password = await bcrypt.hash(password, 12);
      updateFields.passwordChangedAt = Date.now();
    }

    // Update user
    const updatedUser = await User.findByIdAndUpdate(
      req.user.id,
      updateFields,
      { new: true, runValidators: true }
    ).select('-password -verificationCode -verificationExpires');

    //  create notification
    if (profilePicture || bio) {
      const followers = updatedUser.followers;
      const notificationContent = profilePicture
        ? `${updatedUser.name} updated their profile picture`
        : `${updatedUser.name} updated their bio`;
      
      const notifications = followers.map(followerId => ({
        recipient: followerId,
        sender: updatedUser._id,
        type: 'system',
        content: notificationContent,
        priority: 'low',
      }));

      await Notification.insertMany(notifications);

      followers.forEach(followerId => {
        if (io._activeUsers[followerId]) {
          io.to(`user_${followerId}`).emit('new-notification', {
            recipient: followerId,
            sender: updatedUser._id,
            type: 'system',
            content: notificationContent,
            createdAt: new Date(),
            read: false,
          });
        }
      });
    }

    res.status(200).json({
      success: true,
      data: updatedUser,
      message: "Profile updated successfully",
    });
  } catch (err) {
    console.error(`Update User Error: ${err.message}`);
    res.status(500).json({ 
      success: false, 
      message: "Server error",
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

// @desc    Delete user account
// @route   DELETE /api/auth/delete
// @access  Private
const deleteUser = async (req, res) => {
  try {
    await User.findByIdAndDelete(req.user.id);
    
    res.status(200).json({ 
      success: true, 
      message: "User account deleted successfully" 
    });
  } catch (err) {
    console.error(`Delete User Error: ${err.message}`);
    res.status(500).json({ 
      success: false, 
      message: "Server error",
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

module.exports = {
  validateRegister: exports.validateRegister,
  validateLogin: exports.validateLogin,
  registerUser,
  loginUser,
  getCurrentUser,
  updateUser,
  deleteUser,
  verifyEmail,
  logoutUser,
  logoutAllDevices
};