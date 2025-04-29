// controllers/blockController.js
const User = require("../model/userModel");
const { validationResult } = require('express-validator');
const { check } = require('express-validator');
const NodeCache = require('node-cache');
const blockCache = new NodeCache({ stdTTL: 60 });

// Validation rules for block operations
exports.validateBlockOperations = [
  check('userId')
    .notEmpty().withMessage('User ID is required')
    .isMongoId().withMessage('Invalid user ID format')
];

// @desc    Block a user
// @route   POST /api/block
// @access  Private
exports.blockUser = async (req, res) => {
 console.log('Block user request received:', { userId: req.body.userId, currentUserId: req.user.id });
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { userId } = req.body;
  const currentUserId = req.user.id;

  try {
    // Check if users exist
    const [currentUser, userToBlock] = await Promise.all([
      User.findById(currentUserId),
      User.findById(userId)
    ]);

    if (!currentUser || !userToBlock) {
      return res.status(404).json({ 
        success: false,
        message: 'User not found' 
      });
    }

    // Check if trying to block self
    if (currentUserId === userId) {
      return res.status(400).json({ 
        success: false,
        message: 'You cannot block yourself' 
      });
    }

    // Check if already blocked
    if (currentUser.blockedUsers.includes(userId)) {
      return res.status(400).json({ 
        success: false,
        message: 'User is already blocked' 
      });
    }

    // Remove follow relationship if exists
    currentUser.following = currentUser.following.filter(
      id => id.toString() !== userId.toString()
    );
    userToBlock.followers = userToBlock.followers.filter(
      id => id.toString() !== currentUserId.toString()
    );

    // Add to blockedUsers list
    currentUser.blockedUsers.push(userId);

    await Promise.all([currentUser.save(), userToBlock.save()]);

    res.status(200).json({ 
      success: true,
      message: 'User blocked successfully',
      data: {
        blockedUser: {
          _id: userToBlock._id,
          name: userToBlock.name,
          username: userToBlock.username
        }
      }
    });

  } catch (err) {
    console.error(`Block User Error: ${err.message}`);
    res.status(500).json({ 
      success: false, 
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

// @desc    Unblock a user
// @route   DELETE /api/block/:userId
// @access  Private
exports.unblockUser = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { userId } = req.params;
  const currentUserId = req.user.id;

  try {
    const currentUser = await User.findById(currentUserId);
    if (!currentUser) {
      return res.status(404).json({ 
        success: false,
        message: 'User not found' 
      });
    }

    // Check if user is actually blocked
    if (!currentUser.blockedUsers.includes(userId)) {
      return res.status(400).json({ 
        success: false,
        message: 'User is not blocked' 
      });
    }

    // Remove from blockedUsers list
    currentUser.blockedUsers = currentUser.blockedUsers.filter(
      id => id.toString() !== userId.toString()
    );

    await currentUser.save();

    const unblockedUser = await User.findById(userId).select('_id name username');

    res.status(200).json({ 
      success: true,
      message: 'User unblocked successfully',
      data: {
        unblockedUser
      }
    });

  } catch (err) {
    console.error(`Unblock User Error: ${err.message}`);
    res.status(500).json({ 
      success: false, 
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

// @desc    Get blocked users list
// @route   GET /api/block
// @access  Private
exports.getBlockedUsers = async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
      .populate({
        path: 'blockedUsers',
        select: '_id name username profilePicture'
      });

    if (!user) {
      return res.status(404).json({ 
        success: false,
        message: 'User not found' 
      });
    }

    res.status(200).json({ 
      success: true,
      data: user.blockedUsers,
      count: user.blockedUsers.length
    });

  } catch (err) {
    console.error(`Get Blocked Users Error: ${err.message}`);
    res.status(500).json({ 
      success: false, 
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

// @desc    Check if a user is blocked
// @route   GET /api/block/check/:userId
// @access  Private
exports.checkBlockStatus = async (req, res) => {
    const { userId } = req.params;
    const currentUserId = req.user.id;
  
    try {
      const currentUser = await User.findById(currentUserId);
      if (!currentUser) {
        return res.status(404).json({
          success: false,
          message: 'User not found',
        });
      }
  
      const isBlocked = currentUser.blockedUsers.includes(userId);
  
      res.status(200).json({
        success: true,
        isBlocked,
      });
    } catch (err) {
      console.error(`Check Block Status Error: ${err.message}`);
      res.status(500).json({
        success: false,
        message: 'Server error',
        error: process.env.NODE_ENV === 'development' ? err.message : undefined,
      });
    }
  };

  // @desc    Check if current user is blocked by another user
// @route   GET /api/block/is-blocked-by/:userId
// @access  Private
// controllers/blockController.js
exports.isBlockedByUser = async (req, res) => {
    const { userId } = req.params;
    const currentUserId = req.user.id;
    const cacheKey = `blocked-by:${userId}:${currentUserId}`;

    const cached = blockCache.get(cacheKey);
    if (cached !== undefined) {
      return res.status(200).json({
        success: true,
        isBlockedByUser: cached,
        cached: true
      });
    }
  
    try {
      const targetUser = await User.findById(userId);
      if (!targetUser) {
        console.log(`Target user not found: ${userId}`);
        return res.status(404).json({
          success: false,
          message: 'Target user not found',
        });
      }
  
      const isBlockedByUser = targetUser.blockedUsers.includes(currentUserId);

      blockCache.set(cacheKey, isBlockedByUser);
      res.status(200).json({
        success: true,
        isBlockedByUser,
      });
    } catch (err) {
      console.error(`Check Blocked By User Error: ${err.message}, userId: ${userId}, currentUserId: ${currentUserId}`);
      res.status(500).json({
        success: false,
        message: 'Server error',
        error: process.env.NODE_ENV === 'development' ? err.message : undefined,
      });
    }
  };