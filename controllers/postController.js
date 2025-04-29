const Post = require('../model/Post');
const User = require('../model/userModel');
const cloudinary = require('cloudinary').v2;
const Notification = require('../model/Notification');
const { handleNSFWViolation } = require('../middleware/uploadMiddleware');
const mongoose = require('mongoose');
const { check, validationResult } = require('express-validator');
const { Types } = mongoose;
const geoip = require('geoip-lite');

// Validation rules
exports.validateCreatePost = [
    check('content')
      .optional()
      .trim()
      .isLength({ max: 2000 }).withMessage('Post content cannot exceed 2000 characters'),
    check('visibility')
      .optional()
      .isIn(['public', 'friends', 'private']).withMessage('Invalid visibility setting'),
    check('taggedUsers')
      .optional()
      .isArray().withMessage('Tagged users must be an array'),
    check('taggedUsers.*')
      .isMongoId().withMessage('Invalid user ID in tagged users'),
    check('location.name')
      .optional()
      .isString().withMessage('Location name must be a string')
      .trim()
      .isLength({ max: 100 }).withMessage('Location name cannot exceed 100 characters'),
  ];

// Create a new post
exports.createPost = async (req, res) => {

  try {
    if (req.body.taggedUsers && typeof req.body.taggedUsers === 'string') {
      req.body.taggedUsers = JSON.parse(req.body.taggedUsers);
    }


    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const { content, visibility = 'public', taggedUsers = [], location } = req.body;
    const userId = req.user.id;

    // Check if user is blocked by any tagged users
    if (taggedUsers.length > 0) {
      const blockedBy = await User.find({
        _id: { $in: taggedUsers },
        blockedUsers: userId
      }).select('_id');

      if (blockedBy.length > 0) {
        return res.status(403).json({
          success: false,
          message: `You cannot tag users who have blocked you: ${blockedBy.map(u => u._id).join(', ')}`
        });
      }
    }

    const userIp = req.user.ipAddress || req.user.devices.find(device => device.isCurrent)?.ipAddress || '::ffff:127.0.0.1';
    const ipWithoutPrefix = userIp.replace('::ffff:', '');

    // Fetch location from IP using geoip-lite
    const geo = geoip.lookup(ipWithoutPrefix);
    let coordinates = [0, 0];
    let defaultLocationName = 'Unknown Location';

    if (geo) {
        coordinates = [parseFloat(geo.ll[1]), parseFloat(geo.ll[0])]; // [longitude, latitude]
        defaultLocationName = geo.city || geo.region || 'Current Location';
      } else {
        console.warn('GeoIP lookup failed, using default coordinates');
      }


    // Create post
    const postData = {
      user: userId,
      content,
      visibility,
      taggedUsers,
      media: req.mediaFiles || []
    };

       postData.location = {
        type: 'Point',
        coordinates,
        name: location?.name ? location.name.trim() : defaultLocationName,
      };


    const post = await Post.create(postData);

    // Populate user details for response
    const populatedPost = await Post.findById(post._id)
        .populate('user', 'name username profilePicture email phoneNumber bio link country dateOfBirth role following followers blockedUsers ActiveIndicator disabled interests lastActive verified devices lastLogin ipAddress settings')
        .populate('taggedUsers', 'name username profilePicture email phoneNumber bio link country dateOfBirth role following followers blockedUsers ActiveIndicator disabled interests lastActive verified devices lastLogin ipAddress settings')
        .lean()

    // Create notifications for tagged users
    if (taggedUsers.length > 0) {
    const notifications = taggedUsers.map(taggedUserId => ({
      recipient: taggedUserId,
      sender: userId,
      type: 'tag',
      url: `post-view/${post._id}`,
      content: `${req.user.name} tagged you in a post`,
      relatedItem: {
        post: populatedPost,
        user: req.user 
      },
      priority: 'high'
    }));

    await Notification.insertMany(notifications);

      // Send real-time notifications
      const io = req.io;
      taggedUsers.forEach(userId => {
        if (io._activeUsers[userId]) {
          io.to(`user_${userId}`).emit('new-notification', {
            recipient: userId,
            sender: req.user._id,
            type: 'tag',
            content: `${req.user.name} tagged you in a post`,
            relatedItem: {
              post: populatedPost,
              user: req.user // Include full sender user data
            },
            createdAt: new Date(),
            read: false
          });
        }
      });
    }

    res.status(201).json({
      success: true,
      data: populatedPost,
      message: 'Post created successfully'
    });

  } catch (error) {
    console.error('Create post error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create post'
    });
  }
};

// Get user's friends (following users) and similar usernames
exports.getFriends = async (req, res) => {
  console.log('Typing')
  try {
    const userId = req.user.id;
    const { searchQuery = '' } = req.query; // Optional search query
    
    // First, fetch the user's following list
    const user = await User.findById(userId).select('following');
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    // Build the query for following users
    const followingQuery = {
      _id: { $in: user.following },
      blockedUsers: { $ne: userId }
    };

    // If there's a search query, add it to the conditions
    if (searchQuery) {
      followingQuery.$or = [
        { username: { $regex: searchQuery, $options: 'i' } },
        { name: { $regex: searchQuery, $options: 'i' } }
      ];
    }

    // Find matching users from the following list
    const followingFriends = await User.find(followingQuery)
      .select('-password')
      .limit(10);

    // If we found matching following users, return them
    if (followingFriends.length > 0) {
      return res.status(200).json({
        success: true,
        data: followingFriends,
        source: 'following'
      });
    }

    // If no matches in following list, search among all users with similar usernames/names
    const similarUsersQuery = {
      _id: { $ne: userId }, // Not the current user
      blockedUsers: { $ne: userId } // Not blocked by the user
    };

    if (searchQuery) {
      similarUsersQuery.$or = [
        { username: { $regex: searchQuery, $options: 'i' } },
        { name: { $regex: searchQuery, $options: 'i' } }
      ];
    }

    const similarUsers = await User.find(similarUsersQuery)
      .select('-password')
      .limit(10);

    res.status(200).json({
      success: true,
      data: similarUsers,
      source: 'similar'
    });

  } catch (error) {
    console.error('Get friends error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch friends',
    });
  }
};

// Get posts with advanced filtering and pagination
exports.getPosts = async (req, res) => {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 10, filter = 'all', search } = req.query;


    // Get user's preferences and relationships
    const user = await User.findById(userId).select('following blockedUsers blockingUsers settings.privacy.profileVisibility');
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    // Ensure blockedUsers and blockingUsers are arrays
    const blockedUsers = Array.isArray(user.blockedUsers) ? user.blockedUsers : [];
    const blockingUsers = Array.isArray(user.blockingUsers) ? user.blockingUsers : [];


    // Base query conditions
    const conditions = {
      isDeleted: false,
      isNSFW: false
    };

    // Apply visibility filters based on user's preference
    if (filter === 'following') {
      conditions.$or = [
        { user: { $in: user.following } },
        { user: userId }
      ];
      conditions.visibility = { $in: ['public', 'friends'] };
    } else if (filter === 'bookmarked' ) {
      conditions.bookmarks = userId;
    } else {
      // For 'all' filter, show public posts or posts from friends if visibility is friends
      conditions.$or = [
        { visibility: 'public' },
        {
          visibility: 'friends',
          user: { $in: user.following }
        },
        { user: userId } // Always show user's own posts
      ];
    }

     // Exclude posts from blocked users and users who blocked the current user
    conditions.user = {
      $nin: [...blockedUsers, ...blockingUsers]
    };


    // Search functionality
    if (search) {
      conditions.$or = [
        { content: { $regex: search, $options: 'i' } },
        { 'user.username': { $regex: search, $options: 'i' } },
        { 'user.name': { $regex: search, $options: 'i' } }
      ];
    }

    // Advanced sorting algorithm
    const sort = {
      createdAt: -1,
      likeCount: -1,
      commentCount: -1
    };

    // Get posts with pagination
    const options = {
      page: parseInt(page),
      limit: parseInt(limit),
      sort,
      populate: [
        { path: 'user', select: '-password' },
        { path: 'taggedUsers', select: '-password' },
        { path: 'repost', populate: { path: 'user', select: '-password' } } // Add this to populate repost.user
      ],
      lean: true
    };


    const posts = await Post.paginate(conditions, options);

    // Add isLiked field to each post
    const postsWithIsLiked = posts.docs.map((post) => ({
      ...post,
      isLiked: post.likes.map(id => id.toString()).includes(userId.toString()),
      isBookmarked: post.bookmarks.map(id => id.toString()).includes(userId.toString()),
    }));


    res.status(200).json({
      success: true,
      data: {
        docs: postsWithIsLiked,
        totalDocs: posts.totalDocs,
        page: posts.page,
        totalPages: posts.totalPages,
        hasNextPage: posts.hasNextPage,
        hasPrevPage: posts.hasPrevPage
      }
    });

  } catch (error) {
    console.error('Get posts error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch posts'
    });
  }
};

// Get a single post
exports.getPost = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid post ID'
      });
    }

    // Check if user is blocked by post author
    const post = await Post.findById(id)
      .populate('user', '-password')
      .populate('taggedUsers', '-password')
      .populate({
        path: 'repost',
        populate: [
          { path: 'user', select: '-password' },
          { path: 'media' } // Ensure media is populated
        ]
      })

      if (!post || post.isDeleted || post.isNSFW) {
        return res.status(404).json({
          success: false,
          message: 'Post not found or unavailable'
        });
      }

    // Check if user is blocked by post author
    const author = await User.findById(post.user._id).select('blockedUsers');
    if (author.blockedUsers.includes(userId)) {
      return res.status(403).json({
        success: false,
        message: 'You are blocked by the post author'
      });
    }

    // Check visibility
    if (post.visibility === 'private' && post.user._id.toString() !== userId) {
      return res.status(403).json({
        success: false,
        message: 'This post is private'
      });
    }

    if (post.visibility === 'friends') {
      const user = await User.findById(userId).select('following');
      if (!user.following.includes(post.user._id) && post.user._id.toString() !== userId) {
        return res.status(403).json({
          success: false,
          message: 'This post is only visible to friends of the author'
        });
      }
    }

    // Add isLiked field
    const postWithIsLiked = {
      ...post.toObject(),
      isLiked: post.likes.includes(userId),
      isBookmarked: post.bookmarks.includes(userId),
    };

    res.status(200).json({
      success: true,
      data: postWithIsLiked
    });

  } catch (error) {
    console.error('Get post error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch post'
    });
  }
};

// Delete a post
exports.deletePost = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const post = await Post.findOne({
      _id: id,
      user: userId
    });

    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found or you are not authorized to delete it'
      });
    }

    // Soft delete
    post.isDeleted = true;
    post.deletedAt = new Date();
    await post.save();

    // Delete associated media from Cloudinary
    if (post.media && post.media.length > 0) {
      const deletePromises = post.media.map(media => {
        return cloudinary.uploader.destroy(media.publicId, {
          resource_type: media.mediaType === 'video' ? 'video' : 'image'
        });
      });
      await Promise.all(deletePromises);
    }

    res.status(200).json({
      success: true,
      message: 'Post deleted successfully'
    });

  } catch (error) {
    console.error('Delete post error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete post'
    });
  }
};

// Report a post
exports.reportPost = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const { reason } = req.body;

    const post = await Post.findById(id);
    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    // Check if already reported by this user
    const alreadyReported = post.reportedBy.some(report => 
      report.user.toString() === userId
    );

    if (alreadyReported) {
      return res.status(400).json({
        success: false,
        message: 'You have already reported this post'
      });
    }

    // Add report
    post.reportedBy.push({
      user: userId,
      reason
    });

    // Check if post meets threshold for automatic action (e.g., 5 reports)
    if (post.reportedBy.length >= 5) {
      post.isNSFW = true;
      
      // Notify admins/moderators (implementation depends on your system)
      // await notifyModerators(post);
    }

    await post.save();

    res.status(200).json({
      success: true,
      message: 'Post reported successfully'
    });

  } catch (error) {
    console.error('Report post error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to report post'
    });
  }
};
