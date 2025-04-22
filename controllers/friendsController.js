const User = require("../model/userModel");
const { validationResult } = require('express-validator');
const { check } = require('express-validator');

// Validation rules for follow operations
exports.validateFollowOperations = [
  check('userId')
    .notEmpty().withMessage('User ID is required')
    .isMongoId().withMessage('Invalid user ID format')
];

// @desc    Get suggested friends
const getSuggestedFriends = async (req, res) => {
  try {
    const currentUserId = req.user.id;
    const currentUser = await User.findById(currentUserId).select('following followers interests blockedUsers');

    if (!currentUser) {
      return res.status(404).json({ 
        success: false,
        message: 'User not found' 
      });
    }

    const allUsers = await User.find({
      _id: { 
        $ne: currentUserId,
        $nin: currentUser.following,
        $nin: currentUser.blockedUsers || []
      }
    }).select('-password -verificationCode -verificationExpires');

    const scoredUsers = allUsers.map(user => {
      let score = 0;

      const mutualFollowers = user.followers.filter(followerId =>
        currentUser.followers.includes(followerId)
      ).length;
      score += mutualFollowers * 5;

      if (currentUser.interests && user.interests) {
        const commonInterests = currentUser.interests.filter(interest =>
          user.interests.includes(interest)
        ).length;
        score += commonInterests * 3;
      }

      score += user.followers.length * 0.5;

      const daysSinceActive = (new Date() - user.lastActive) / (1000 * 60 * 60 * 24);
      if (daysSinceActive < 7) {
        score += (7 - daysSinceActive) * 2;
      }

      return { ...user.toObject(), score };
    });

    const suggestedFriends = scoredUsers
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map(user => ({
        ...user,
        mutualConnections: user.followers.filter(followerId =>
          currentUser.followers.includes(followerId)
        ).length,
        commonInterests: currentUser.interests 
          ? currentUser.interests.filter(interest =>
              user.interests.includes(interest)
            ).length
          : 0
      }));

    res.status(200).json({ 
      success: true,
      data: suggestedFriends
    });

  } catch (err) {
    console.error(`Get Suggested Friends Error: ${err.message}`);
    res.status(500).json({ 
      success: false, 
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};


// @desc    Follow a user
// @route   POST /api/follow
// @access  Private
const followUser = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { userId } = req.body;
  const followerId = req.user.id;

  try {
    // Check if users exist
    const [follower, userToFollow] = await Promise.all([
      User.findById(followerId),
      User.findById(userId)
    ]);

    if (!follower || !userToFollow) {
      return res.status(404).json({ 
        success: false,
        message: 'User not found' 
      });
    }

    // Check if trying to follow self
    if (followerId === userId) {
      return res.status(400).json({ 
        success: false,
        message: 'You cannot follow yourself' 
      });
    }

    // Check if already following
    if (follower.following.includes(userId)) {
      return res.status(400).json({ 
        success: false,
        message: 'You are already following this user' 
      });
    }

    // Check if user is blocked
    if (userToFollow.blockedUsers.includes(followerId)) {
      return res.status(403).json({ 
        success: false,
        message: 'You cannot follow this user' 
      });
    }

    // Add to follower's following list and user's followers list
    follower.following.push(userId);
    userToFollow.followers.push(followerId);

    await Promise.all([follower.save(), userToFollow.save()]);

    res.status(200).json({ 
      success: true,
      message: 'Successfully followed user',
      data: {
        followedUser: {
          _id: userToFollow._id,
          name: userToFollow.name,
          username: userToFollow.username,
          profilePicture: userToFollow.profilePicture,
          followersCount: userToFollow.followers.length
        },
        followingCount: follower.following.length
      }
    });

  } catch (err) {
    console.error(`Follow User Error: ${err.message}`);
    res.status(500).json({ 
      success: false, 
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

// @desc    Unfollow a user
// @route   DELETE /api/follow/:userId
// @access  Private
const unfollowUser = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { userId } = req.params;
  const followerId = req.user.id;

  try {
    // Check if users exist
    const [follower, userToUnfollow] = await Promise.all([
      User.findById(followerId),
      User.findById(userId)
    ]);

    if (!follower || !userToUnfollow) {
      return res.status(404).json({ 
        success: false,
        message: 'User not found' 
      });
    }

    // Check if actually following
    if (!follower.following.includes(userId)) {
      return res.status(400).json({ 
        success: false,
        message: 'You are not following this user' 
      });
    }

    // Remove from follower's following list and user's followers list
    follower.following = follower.following.filter(
      id => id.toString() !== userId.toString()
    );
    userToUnfollow.followers = userToUnfollow.followers.filter(
      id => id.toString() !== followerId.toString()
    );

    await Promise.all([follower.save(), userToUnfollow.save()]);

    res.status(200).json({ 
      success: true,
      message: 'Successfully unfollowed user',
      data: {
        unfollowedUser: {
          _id: userToUnfollow._id,
          name: userToUnfollow.name,
          username: userToUnfollow.username,
          followersCount: userToUnfollow.followers.length
        },
        followingCount: follower.following.length
      }
    });

  } catch (err) {
    console.error(`Unfollow User Error: ${err.message}`);
    res.status(500).json({ 
      success: false, 
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

// @desc    Get followers list
// @route   GET /api/follow/followers
// @access  Private
const getFollowers = async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
      .populate({
        path: 'followers',
        select: '_id name username profilePicture bio'
      });

    if (!user) {
      return res.status(404).json({ 
        success: false,
        message: 'User not found' 
      });
    }

    res.status(200).json({ 
      success: true,
      data: user.followers,
      count: user.followers.length
    });

  } catch (err) {
    console.error(`Get Followers Error: ${err.message}`);
    res.status(500).json({ 
      success: false, 
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

// @desc    Get following list
// @route   GET /api/follow/following
// @access  Private
const getFollowing = async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
      .populate({
        path: 'following',
        select: '_id name username profilePicture bio'
      });

    if (!user) {
      return res.status(404).json({ 
        success: false,
        message: 'User not found' 
      });
    }

    res.status(200).json({ 
      success: true,
      data: user.following,
      count: user.following.length
    });

  } catch (err) {
    console.error(`Get Following Error: ${err.message}`);
    res.status(500).json({ 
      success: false, 
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

// @desc    Check follow status
// @route   GET /api/follow/status/:userId
// @access  Private
// @desc    Check follow status
// @route   GET /api/follow/status/:userId
// @access  Private
const checkFollowStatus = async (req, res) => {
  try {
    const { userId } = req.params;
    const currentUserId = req.user.id;

    // Check if users exist
    const [currentUser, otherUser] = await Promise.all([
      User.findById(currentUserId).select('following followers'),
      User.findById(userId).select('followers blockedUsers')
    ]);

    if (!currentUser || !otherUser) {
      return res.status(404).json({ 
        success: false,
        message: 'User not found' 
      });
    }

    // Check if blocked
    if (otherUser.blockedUsers.includes(currentUserId)) {
      return res.status(200).json({ 
        success: true,
        status: 'blocked',
        isFollowingYou: otherUser.followers.includes(currentUserId),
        message: 'You are blocked by this user'
      });
    }

    // Check if following
    if (currentUser.following.includes(userId)) {
      return res.status(200).json({ 
        success: true,
        status: 'following',
        isFollowingYou: otherUser.followers.includes(currentUserId),
        message: 'You are following this user'
      });
    }

    // Check if they're following you
    if (otherUser.followers.includes(currentUserId)) {
      return res.status(200).json({ 
        success: true,
        status: 'not_following',
        isFollowingYou: true,
        message: 'This user is following you'
      });
    }

    // No relationship
    res.status(200).json({ 
      success: true,
      status: 'not_following',
      isFollowingYou: false,
      message: 'You are not following this user'
    });

  } catch (err) {
    console.error(`Check Follow Status Error: ${err.message}`);
    res.status(500).json({ 
      success: false, 
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

module.exports = {
  validateFollowOperations: exports.validateFollowOperations,
  followUser,
  unfollowUser,
  getFollowers,
  getFollowing,
  checkFollowStatus,
  getSuggestedFriends
};