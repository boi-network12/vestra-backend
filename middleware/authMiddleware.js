const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { RateLimiterMemory } = require('rate-limiter-flexible');

// Rate limiter for auth attempts
const authLimiter = new RateLimiterMemory({
  points: 10, // 10 attempts
  duration: 3600, // per hour per IP
});

exports.protect = async (req, res, next) => {
  try {
    // Rate limit check
    await authLimiter.consume(req.ip);

    // Get token from header or cookies
    let token;
    if (
      req.headers.authorization &&
      req.headers.authorization.startsWith('Bearer')
    ) {
      token = req.headers.authorization.split(' ')[1];
    } else if (req.cookies?.accessToken) {
      token = req.cookies.accessToken;
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'No authentication token provided',
      });
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Check if user exists
    const currentUser = await User.findById(decoded.id).select('+sessions');
    if (!currentUser) {
      return res.status(401).json({
        success: false,
        message: 'User associated with this token no longer exists',
      });
    }

    // Check if session is valid
    const session = currentUser.sessions.find(
      (s) => s.token === token && s.active
    );
    if (!session) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired session. Please log in again',
      });
    }

    // Check password change
    if (currentUser.changedPasswordAfter(decoded.iat)) {
      return res.status(401).json({
        success: false,
        message: 'Password changed recently. Please log in again',
      });
    }

    // Attach user to request
    req.user = currentUser;
    next();
  } catch (err) {
    console.error('Authentication Error:', err.message);

    let message = 'Not authorized to access this route';
    let status = 401;

    if (err.name === 'TokenExpiredError') {
      message = 'Token expired. Please log in again';
    } else if (err.name === 'JsonWebTokenError') {
      message = 'Invalid token. Please log in again';
    } else if (err.message.includes('Rate limit')) {
      message = 'Too many authentication attempts. Try again later';
      status = 429;
    }

    res.status(status).json({
      success: false,
      message,
    });
  }
};

// Role-based authorization
exports.restrictTo = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to perform this action',
      });
    }
    next();
  };
};