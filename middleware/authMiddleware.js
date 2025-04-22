const jwt = require('jsonwebtoken');
const User = require('../model/userModel');

// Protect routes with JWT
exports.protect = async (req, res, next) => {
  try {
    // 1) Get token from header
    let token;
    if (
      req.headers.authorization &&
      req.headers.authorization.startsWith('Bearer')
    ) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Not authorized to access this route'
      });
    }

    // 2) Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // 3) Check if user still exists
    const currentUser = await User.findById(decoded.id);
    if (!currentUser) {
      return res.status(401).json({
        success: false,
        message: 'The user belonging to this token no longer exists'
      });
    }

    // 4) Check if user changed password after token was issued
    if (currentUser.changedPasswordAfter(decoded.iat)) {
      return res.status(401).json({
        success: false,
        message: 'User recently changed password. Please log in again'
      });
    }

    // 5) Check if the token matches any active device
    const activeDevice = currentUser.devices.find(
      (device) => device.isCurrent && device.ipAddress === req.ip
    );
    
    if (!activeDevice) {
      return res.status(401).json({
        success: false,
        message: 'Session expired or invalid. Please log in again',
      });
    }
    

    // GRANT ACCESS TO PROTECTED ROUTE
    req.user = currentUser;
    next();
  } catch (err) {
    console.error('Authentication Error:', err.message);
    
    let message = 'Not authorized to access this route';
    if (err.name === 'TokenExpiredError') {
      message = 'Your token has expired. Please log in again';
    } else if (err.name === 'JsonWebTokenError') {
      message = 'Invalid token. Please log in again';
    }

    res.status(401).json({
      success: false,
      message
    });
  }
};