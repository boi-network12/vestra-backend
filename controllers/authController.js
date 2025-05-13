const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const UserHistory = require('../models/UserHistory');
const { sendVerificationEmail, sendWelcomeEmail } = require('../utils/email');

// Generate JWT
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '30d' });
};

// Register User
exports.register = async (req, res) => {
  try {
    const { username, email, password, firstName, lastName, middleName } = req.body;

    // Validate required fields
    if (!username || !email || !password || !firstName || !lastName) {
      return res.status(400).json({ success: false, message: 'All required fields must be provided' });
    }

    // Check if user exists
    const userExists = await User.findOne({ $or: [{ email }, { username }] });
    if (userExists) {
      return res.status(400).json({ success: false, message: 'Email or username already taken' });
    }

    // Get location from request
    const { latitude, longitude, city, country } = req.body.location || {};
    const location = latitude && longitude ? { coordinates: [longitude, latitude], city, country } : {};

    // Create user
    const user = await User.create({
      username,
      email,
      password,
      profile: {
        firstName,
        lastName,
        middleName: middleName || '',
        location,
      },
      createdAt: new Date(),
    });

    // Generate and send verification code
    const verificationToken = user.createVerificationToken();
    await user.save({ validateBeforeSave: false });

    try {
      await sendVerificationEmail(email, firstName, verificationToken);
      user.verificationMethod = 'email';
      await user.save({ validateBeforeSave: false });
    } catch (err) {
      user.verificationMethod = 'manual';
      await user.save({ validateBeforeSave: false });
    }

    // Send welcome email
    try {
      await sendWelcomeEmail(email, firstName);
    } catch (err) {
      console.error('Failed to send welcome email:', err);
    }

    res.status(201).json({
      success: true,
      data: {
        _id: user._id,
        username: user.username,
        email: user.email,
        token: generateToken(user._id),
      },
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Verify User
exports.verifyUser = async (req, res) => {
  try {
    const { code } = req.body;
    const hashedCode = crypto.createHash('sha256').update(code).digest('hex');

    const user = await User.findOne({
      verificationToken: hashedCode,
      verificationTokenExpires: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({ success: false, message: 'Invalid or expired code' });
    }

    user.isVerified = true;
    user.verificationToken = undefined;
    user.verificationTokenExpires = undefined;
    await user.save();

    res.json({ success: true, message: 'Account verified successfully' });
  } catch (err) {
    console.error('Verify user error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Login User
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Please provide email and password' });
    }

    const user = await User.findOne({ email }).select('+password');
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    if (!user.isVerified) {
      // Check daily OTP request limit
      const today = new Date().setHours(0, 0, 0, 0);
      if (user.verificationAttempts.lastAttempt && new Date(user.verificationAttempts.lastAttempt).setHours(0, 0, 0, 0) === today) {
        if (user.verificationAttempts.count >= 3) {
          return res.status(429).json({
            success: false,
            message: 'Too many verification requests today. Please try again tomorrow.',
          });
        }
        user.verificationAttempts.count += 1;
      } else {
        user.verificationAttempts.count = 1;
        user.verificationAttempts.lastAttempt = new Date();
      }

      // Generate and send new verification code
      const verificationToken = user.createVerificationToken();
      await user.save({ validateBeforeSave: false });

      try {
        await sendVerificationEmail(user.email, user.profile.firstName, verificationToken);
        user.verificationMethod = 'email';
        await user.save({ validateBeforeSave: false });
      } catch (err) {
        user.verificationMethod = 'manual';
        await user.save({ validateBeforeSave: false });
        return res.status(500).json({ success: false, message: 'Failed to send verification email' });
      }

      return res.status(403).json({
        success: false,
        message: 'Please verify your account. A new verification code has been sent to your email.',
      });
    }

    // Update last login
    const token = generateToken(user._id);
    user.sessions.push({
      token,
      device: req.headers['user-agent'] || 'unknown',
      ipAddress: req.ip,
      lastActive: new Date(),
    });
    await user.save();

    res.json({
      success: true,
      data: {
        _id: user._id,
        username: user.username,
        email: user.email,
        token,
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Forgot Password
exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email });

    if (!user) {
      return res.status(404).json({ success: false, message: 'No user found with that email' });
    }

    const resetToken = user.createPasswordResetToken();
    await user.save({ validateBeforeSave: false });

    const resetUrl = `${req.protocol}://${req.get('host')}/api/auth/reset-password/${resetToken}`;
    const message = `You requested a password reset. Please use the following link to reset your password:\n\n${resetUrl}\n\nThis link is valid for 10 minutes.`;

    try {
      await sendVerificationEmail(user.email, user.profile.firstName, message);
      res.json({ success: true, message: 'Password reset email sent' });
    } catch (err) {
      user.passwordResetToken = undefined;
      user.passwordResetExpires = undefined;
      await user.save({ validateBeforeSave: false });
      return res.status(500).json({ success: false, message: 'Error sending email' });
    }
  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Reset Password
exports.resetPassword = async (req, res) => {
  try {
    const { token } = req.params;
    const { password } = req.body;

    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
    const user = await User.findOne({
      passwordResetToken: hashedToken,
      passwordResetExpires: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({ success: false, message: 'Token is invalid or expired' });
    }

    user.password = password;
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    await user.save();

    res.json({
      success: true,
      data: {
        _id: user._id,
        username: user.username,
        email: user.email,
        token: generateToken(user._id),
      },
    });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Resend Verification Code
exports.resendVerificationCode = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, message: 'Please provide an email' });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ success: false, message: 'No user found with that email' });
    }

    if (user.isVerified) {
      return res.status(400).json({ success: false, message: 'Account is already verified' });
    }

    // Check daily OTP request limit
    const today = new Date().setHours(0, 0, 0, 0);
    if (user.verificationAttempts.lastAttempt && new Date(user.verificationAttempts.lastAttempt).setHours(0, 0, 0, 0) === today) {
      if (user.verificationAttempts.count >= 3) {
        return res.status(429).json({
          success: false,
          message: 'Too many verification requests today. Please try again tomorrow.',
        });
      }
      user.verificationAttempts.count += 1;
    } else {
      user.verificationAttempts.count = 1;
      user.verificationAttempts.lastAttempt = new Date();
    }

    // Generate and send new verification code
    const verificationToken = user.createVerificationToken();
    await user.save({ validateBeforeSave: false });

    try {
      await sendVerificationEmail(user.email, user.profile.firstName, verificationToken);
      user.verificationMethod = 'email';
      await user.save({ validateBeforeSave: false });
    } catch (err) {
      user.verificationMethod = 'manual';
      await user.save({ validateBeforeSave: false });
      return res.status(500).json({ success: false, message: 'Failed to send verification email' });
    }

    res.json({ success: true, message: 'Verification code sent to your email' });
  } catch (err) {
    console.error('Resend verification code error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Subscribe to Premium Plan
exports.subscribe = async (req, res) => {
  try {
    const { plan } = req.body; // 'Premium' or 'Elite'
    const user = await User.findById(req.user._id);

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (!['Premium', 'Elite'].includes(plan)) {
      return res.status(400).json({ success: false, message: 'Invalid subscription plan' });
    }

    // TODO: Integrate with payment gateway (e.g., Stripe)
    const paymentSuccessful = true; // Replace with actual payment processing

    if (!paymentSuccessful) {
      return res.status(400).json({ success: false, message: 'Payment processing failed' });
    }

    // Update subscription
    user.subscription.plan = plan;
    user.subscription.status = 'active';
    user.subscription.expiryDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
    await user.save();

    // Log subscription change
    await UserHistory.create({
      userId: user._id,
      field: 'subscription.plan',
      oldValue: 'Basic',
      newValue: plan,
      ipAddress: req.ip,
      device: req.headers['user-agent'] || 'unknown',
    });

    res.json({
      success: true,
      message: `Successfully subscribed to ${plan} plan`,
      data: {
        plan: user.subscription.plan,
        status: user.subscription.status,
        expiryDate: user.subscription.expiryDate,
        features: user.subscription.features,
      },
    });
  } catch (err) {
    console.error('Subscription error:', err);
    res.status(500).json({ success: false, message: 'Failed to process subscription' });
  }
};