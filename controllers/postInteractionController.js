const Post = require('../model/Post');
const User = require('../model/userModel');
const Comment = require('../model/Comment');
const Notification = require('../model/Notification');
const mongoose = require('mongoose');
const geoip = require('geoip-lite');

// Like a post
// Like a post
exports.likePost = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const post = await Post.findById(id).populate('user', 'blockedUsers');
    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found',
      });
    }

    // Check if user is blocked by post author
    if (post.user.blockedUsers.includes(userId)) {
      return res.status(403).json({
        success: false,
        message: 'You are blocked by the post author',
      });
    }

    // Check if already liked
    if (post.likes.includes(userId)) {
      return res.status(400).json({
        success: false,
        message: 'You already liked this post',
      });
    }

    // Update post
    post.likes.push(userId);
    post.likeCount = post.likes.length;
    await post.save();

    // Create notification if not the post author
    if (post.user._id.toString() !== userId) {
      const notification = await Notification.create({
        recipient: post.user._id,
        sender: userId,
        type: 'like',
        content: `${req.user.name} liked your post`,
        relatedItem: post._id,
        priority: 'medium',
      });

      // Send real-time notification
      const io = req.io;
      if (io._activeUsers[post.user.toString()]) {
        io.to(`user_${post.user.toString()}`).emit('new-notification', {
          ...notification.toObject(),
          sender: {
            _id: req.user._id,
            name: req.user.name,
            username: req.user.username,
            profilePicture: req.user.profilePicture,
          },
        });
      }
    }

    res.status(200).json({
      success: true,
      message: 'Post liked successfully',
      data: {
        likeCount: post.likeCount,
        isLiked: true,
      },
    });
  } catch (error) {
    console.error('Like post error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to like post',
    });
  }
};

// Unlike a post
// Unlike a post
exports.unlikePost = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const post = await Post.findById(id);
    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found',
      });
    }

    // Check if liked
    if (!post.likes.includes(userId)) {
      return res.status(400).json({
        success: false,
        message: 'You have not liked this post',
      });
    }

    // Update post
    post.likes = post.likes.filter(like => like.toString() !== userId);
    post.likeCount = post.likes.length;
    await post.save();

    // Delete notification if exists
    await Notification.findOneAndDelete({
      recipient: post.user,
      sender: userId,
      type: 'like',
      relatedItem: post._id,
    });

    res.status(200).json({
      success: true,
      message: 'Post unliked successfully',
      data: {
        likeCount: post.likeCount,
        isLiked: false,
      },
    });
  } catch (error) {
    console.error('Unlike post error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to unlike post',
    });
  }
};

// Comment on a post
exports.createComment = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const { content, parentCommentId } = req.body;

    const post = await Post.findById(id);
    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    // Check if user is blocked by post author
    const author = await User.findById(post.user);
    if (author.blockedUsers.includes(userId)) {
      return res.status(403).json({
        success: false,
        message: 'You are blocked by the post author'
      });
    }

    // Create comment
    const commentData = {
      post: id,
      user: userId,
      content,
      media: req.mediaFiles || []
    };

    if (parentCommentId) {
      commentData.parentComment = parentCommentId;
    }

    const comment = await Comment.create(commentData);

    // Update post comment count
    post.commentCount += 1;
    await post.save();

    // Populate user details
    const populatedComment = await Comment.findById(comment._id)
      .populate('user', 'name username profilePicture');

    // Create notification if not the post author
    if (post.user.toString() !== userId) {
      const notification = await Notification.create({
        recipient: post.user,
        sender: userId,
        type: 'comment',
        content: `${req.user.name} commented on your post`,
        relatedItem: post._id,
        priority: 'medium'
      });

      // Send real-time notification
      const io = req.io;
      if (io._activeUsers[post.user.toString()]) {
        io.to(`user_${post.user.toString()}`).emit('new-notification', {
          ...notification.toObject(),
          sender: {
            _id: req.user._id,
            name: req.user.name,
            username: req.user.username,
            profilePicture: req.user.profilePicture
          }
        });
      }
    }

    res.status(201).json({
      success: true,
      data: populatedComment,
      message: 'Comment added successfully'
    });

  } catch (error) {
    console.error('Create comment error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add comment'
    });
  }
};

// Share a post
exports.sharePost = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const { content, visibility = 'public' } = req.body;

    const originalPost = await Post.findById(id)
      .populate('user', 'name username profilePicture blockedUsers');

    if (!originalPost) {
      return res.status(404).json({
        success: false,
        message: 'Original post not found'
      });
    }

    // Check if user is blocked by original post author
    if (originalPost.user.blockedUsers.includes(userId)) {
      return res.status(403).json({
        success: false,
        message: 'You are blocked by the original post author'
      });
    }

    // Fetch location from IP using geoip-lite
    const userIp = req.user.ipAddress || req.user.devices.find(device => device.isCurrent)?.ipAddress || '::ffff:127.0.0.1';
    const ipWithoutPrefix = userIp.replace('::ffff:', '');
    const geo = geoip.lookup(ipWithoutPrefix);
    let coordinates = [0, 0];
    let defaultLocationName = 'Unknown Location';

    if (geo) {
      coordinates = [parseFloat(geo.ll[1]), parseFloat(geo.ll[0])]; // [longitude, latitude]
      defaultLocationName = geo.city || geo.region || 'Current Location';
    } else {
      console.warn('GeoIP lookup failed, using default coordinates');
    }

    // Create shared post
    const sharedPost = await Post.create({
      user: userId,
      content,
      visibility,
      sharedPost: originalPost._id,
      location: {
        type: 'Point',
        coordinates,
        name: defaultLocationName
      }
    });

    // Update share count on original post
    originalPost.shareCount += 1;
    await originalPost.save();

    // Populate user details for response
    const populatedPost = await Post.findById(sharedPost._id)
      .populate('user', '-password')
      .populate('sharedPost');

    // Create notification for original post author
    if (originalPost.user._id.toString() !== userId) {
      const notification = await Notification.create({
        recipient: originalPost.user._id,
        sender: userId,
        type: 'share',
        content: `${req.user.name} shared your post`,
        relatedItem: originalPost._id,
        priority: 'medium'
      });

      // Send real-time notification
      const io = req.io;
      if (io._activeUsers[originalPost.user._id.toString()]) {
        io.to(`user_${originalPost.user._id.toString()}`).emit('new-notification', {
          ...notification.toObject(),
          sender: {
            _id: req.user._id,
            name: req.user.name,
            username: req.user.username,
            profilePicture: req.user.profilePicture
          }
        });
      }
    }

    res.status(201).json({
      success: true,
      data: populatedPost,
      message: 'Post shared successfully'
    });
  } catch (error) {
    console.error('Share post error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to share post'
    });
  }
};

// Get comments for a post
exports.getComments = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // Verify post exists
    const post = await Post.findById(id);
    if (!post || post.isDeleted) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    // Check if user is blocked by post author
    const author = await User.findById(post.user);
    if (author.blockedUsers.includes(userId)) {
      return res.status(403).json({
        success: false,
        message: 'You are blocked by the post author'
      });
    }

    // Check visibility
    if (post.visibility === 'private' && post.user.toString() !== userId) {
      return res.status(403).json({
        success: false,
        message: 'This post is private'
      });
    }

    if (post.visibility === 'friends') {
      const user = await User.findById(userId);
      if (!user.following.includes(post.user) && post.user.toString() !== userId) {
        return res.status(403).json({
          success: false,
          message: 'This post is only visible to friends of the author'
        });
      }
    }

    // Fetch comments with pagination
    const { page = 1, limit = 10 } = req.query;
    const comments = await Comment.paginate(
      { post: id, parentComment: null }, // Only top-level comments
      {
        page: parseInt(page),
        limit: parseInt(limit),
        sort: { createdAt: -1 },
        populate: [
          { path: 'user', select: 'name username profilePicture' },
          {
            path: 'replies',
            populate: { path: 'user', select: 'name username profilePicture' },
          },
        ],
        lean: true,
      }
    );

    res.status(200).json({
      success: true,
      data: comments,
    });
  } catch (error) {
    console.error('Get comments error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch comments',
    });
  }
};

// Repost a post
  exports.repostPost = async (req, res) => {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      const { content, visibility = 'public' } = req.body;
  
      const originalPost = await Post.findById(id)
        .populate('user', '-password');
  
      if (!originalPost) {
        return res.status(404).json({
          success: false,
          message: 'Original post not found'
        });
      }
  
      // Check if user is blocked by original post author
      if (originalPost.user.blockedUsers.includes(userId)) {
        return res.status(403).json({
          success: false,
          message: 'You are blocked by the original post author'
        });
      }

      // Check if user has already reposted
      const existingRepost = await Post.findOne({
        user: userId,
        repost: id,
        isDeleted: false
      });

      if (existingRepost) {
        return res.status(400).json({
          success: false,
          message: 'You have already reposted this post'
        });
      }
  

      // Fetch location from IP using geoip-lite
      const userIp = req.user.ipAddress || req.user.devices.find(device => device.isCurrent)?.ipAddress || '::ffff:127.0.0.1';
      const ipWithoutPrefix = userIp.replace('::ffff:', '');
      const geo = geoip.lookup(ipWithoutPrefix);
      let coordinates = [0, 0];
      let defaultLocationName = 'Unknown Location';

      if (geo) {
        coordinates = [parseFloat(geo.ll[1]), parseFloat(geo.ll[0])]; // [longitude, latitude]
        defaultLocationName = geo.city || geo.region || 'Current Location';
      } else {
        console.warn('GeoIP lookup failed, using default coordinates');
      }

  
      // Create repost
      const repost = await Post.create({
        user: userId,
        content,
        visibility,
        repost: originalPost._id,
        media: req.mediaFiles || [],
        location: {
          type: 'Point',
          coordinates,
          name: defaultLocationName
        }
      });
  
      // Increment shareCount on original post
      originalPost.repostCount = (originalPost.repostCount || 0) + 1;
      await originalPost.save();
  
      // Populate user details for response
      const populatedPost = await Post.findById(repost._id)
        .populate('user', '-password')
        .populate('repost');
  
      // Create notification for original post author
      if (originalPost.user._id.toString() !== userId) {
        const notification = await Notification.create({
          recipient: originalPost.user._id,
          sender: userId,
          type: 'repost',
          content: `${req.user.name} reposted your post`,
          relatedItem: {
            post: originalPost._id,
            user: req.user
          },
          priority: 'medium'
        });
  
        // Send real-time notification
        const io = req.io;
        if (io._activeUsers[originalPost.user._id.toString()]) {
          io.to(`user_${originalPost.user._id.toString()}`).emit('new-notification', {
            ...notification.toObject(),
            sender: {
              _id: req.user._id,
              name: req.user.name,
              username: req.user.username,
              profilePicture: req.user.profilePicture
            }
          });
        }
      }
  
      res.status(201).json({
        success: true,
        data: populatedPost,
        message: 'Post reposted successfully'
      });
    } catch (error) {
      console.error('Repost post error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to repost post'
      });
    }
  };

  // Unrepost a post
exports.unrepostPost = async (req, res) => {
  try {
    const { id } = req.params; // ID of the original post
    const userId = req.user.id;

    // Find the repost created by the user
    const repost = await Post.findOne({
      user: userId,
      repost: id,
      isDeleted: false
    });

    if (!repost) {
      return res.status(404).json({
        success: false,
        message: 'Repost not found or already deleted'
      });
    }

    // Soft delete the repost
    repost.isDeleted = true;
    repost.deletedAt = new Date();
    await repost.save();

    // Decrement repostCount on the original post
    const originalPost = await Post.findById(id);
    if (originalPost) {
      originalPost.repostCount = Math.max(0, (originalPost.repostCount || 0) - 1);
      await originalPost.save();
    }

    res.status(200).json({
      success: true,
      message: 'Repost removed successfully',
      data: {
        repostCount: originalPost.repostCount
      }
    });
  } catch (error) {
    console.error('Unrepost post error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to unrepost post'
    });
  }
};
  
  // Bookmark a post
  exports.bookmarkPost = async (req, res) => {
    try {
      const { id } = req.params;
      const userId = req.user.id;
  
      const post = await Post.findById(id);
      if (!post) {
        return res.status(404).json({
          success: false,
          message: 'Post not found'
        });
      }
  
      // Check if already bookmarked
      if (post.bookmarks.includes(userId)) {
        return res.status(400).json({
          success: false,
          message: 'You already bookmarked this post'
        });
      }
  
      // Add bookmark
      post.bookmarks.push(userId);
      post.bookmarkCount = (post.bookmarkCount || 0) + 1;
      await post.save();
  
      res.status(200).json({
        success: true,
        message: 'Post bookmarked successfully',
        bookmarkCount: post.bookmarkCount,
        isBookmarked: true,
      });
    } catch (error) {
      console.error('Bookmark post error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to bookmark post'
      });
    }
  };
  
  // Remove bookmark from a post
  exports.removeBookmark = async (req, res) => {
    try {
      const { id } = req.params;
      const userId = req.user.id;
  
      const post = await Post.findById(id);
      if (!post) {
        return res.status(404).json({
          success: false,
          message: 'Post not found'
        });
      }
  
      // Check if bookmarked
      if (!post.bookmarks.includes(userId)) {
        return res.status(400).json({
          success: false,
          message: 'You have not bookmarked this post'
        });
      }
  
      // Remove bookmark and decrement bookmarkCount
      post.bookmarks = post.bookmarks.filter(bookmark => bookmark.toString() !== userId);
      post.bookmarkCount = Math.max(0, (post.bookmarkCount || 0) - 1);
      await post.save();

      res.status(200).json({
        success: true,
        message: 'Bookmark removed successfully',
        bookmarkCount: post.bookmarkCount,
        isBookmarked: false,
      });
    } catch (error) {
      console.error('Remove bookmark error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to remove bookmark'
      });
    }
  };
  
  // Increment view count
  exports.incrementViewCount = async (req, res) => {
    try {
      const { id } = req.params;
      const userId = req.user.id;
  
      const post = await Post.findById(id);
      if (!post) {
        return res.status(404).json({
          success: false,
          message: 'Post not found'
        });
      }
  
      // Check if user is blocked by post author
      const author = await User.findById(post.user);
      if (author.blockedUsers.includes(userId)) {
        return res.status(403).json({
          success: false,
          message: 'You are blocked by the post author'
        });
      }
  
      // Increment view count
      post.viewCount += 1;
      await post.save();
  
      res.status(200).json({
        success: true,
        message: 'View count incremented',
        viewCount: post.viewCount
      });
    } catch (error) {
      console.error('Increment view count error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to increment view count'
      });
    }
  };

  // Quote a post
exports.quotePost = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const { content, visibility = 'public' } = req.body;

    const originalPost = await Post.findById(id)
      .populate('user', '-password');

    if (!originalPost) {
      return res.status(404).json({
        success: false,
        message: 'Original post not found'
      });
    }

    // Check if user is blocked by original post author
    if (originalPost.user.blockedUsers.includes(userId)) {
      return res.status(403).json({
        success: false,
        message: 'You are blocked by the post author'
      });
    }

    // Fetch location from IP using geoip-lite
    const userIp = req.user.ipAddress || req.user.devices.find(device => device.isCurrent)?.ipAddress || '::ffff:127.0.0.1';
    const ipWithoutPrefix = userIp.replace('::ffff:', '');
    const geo = geoip.lookup(ipWithoutPrefix);
    let coordinates = [0, 0];
    let defaultLocationName = 'Unknown Location';

    if (geo) {
      coordinates = [parseFloat(geo.ll[1]), parseFloat(geo.ll[0])];
      defaultLocationName = geo.city || geo.region || 'Current Location';
    } else {
      console.warn('GeoIP lookup failed, using default coordinates');
    }

    // Create quote post
    const quotePost = await Post.create({
      user: userId,
      content,
      visibility,
      quote: originalPost._id,
      media: req.mediaFiles || [], // Support media in quote posts
      location: {
        type: 'Point',
        coordinates,
        name: defaultLocationName
      }
    });

    // Increment repostCount on original post (optional, depending on your requirements)
    originalPost.repostCount = (originalPost.repostCount || 0) + 1;
    await originalPost.save();

    // Populate user details for response
    const populatedPost = await Post.findById(quotePost._id)
      .populate('user', '-password')
      .populate('quote');

    // Create notification for original post author
    if (originalPost.user._id.toString() !== userId) {
      const notification = await Notification.create({
        recipient: originalPost.user._id,
        sender: userId,
        type: 'quote',
        content: `${req.user.name} quoted your post`,
        relatedItem: {
          post: originalPost._id,
          user: req.user
        },
        priority: 'medium'
      });

      // Send real-time notification
      const io = req.io;
      if (io._activeUsers[originalPost.user._id.toString()]) {
        io.to(`user_${originalPost.user._id.toString()}`).emit('new-notification', {
          ...notification.toObject(),
          sender: {
            _id: req.user._id,
            name: req.user.name,
            username: req.user.username,
            profilePicture: req.user.profilePicture
          }
        });
      }
    }

    res.status(201).json({
      success: true,
      data: populatedPost,
      message: 'Post quoted successfully'
    });
  } catch (error) {
    console.error('Quote post error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to quote post'
    });
  }
};