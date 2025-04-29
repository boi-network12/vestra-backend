const Notification = require('../model/Notification');
const User = require('../model/userModel');
const { validationResult } = require('express-validator');
const asyncHandler = require('express-async-handler');

// @desc    Get user's notifications
// @route   GET /api/notifications
// @access  Private
const getNotifications = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const skip = (page - 1) * limit;
  const read = req.query.read === 'true' ? true : req.query.read === 'false' ? false : undefined;

  const query = { recipient: req.user.id };
  if (read !== undefined) query.read = read;

  const [notifications, total] = await Promise.all([
    Notification.find(query)
      .populate('sender', 'name username profilePicture')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Notification.countDocuments(query)
  ]);

  // Process notifications to ensure data consistency
  const processedNotifications = notifications.map(notif => {
    // If relatedItem exists but is not in the new format, convert it
    if (notif.relatedItem && !notif.relatedItem.post) {
      return {
        ...notif,
        relatedItem: {
          post: notif.relatedItem,
          user: notif.sender
        }
      };
    }
    return notif;
  });

  res.status(200).json({
    success: true,
    data: processedNotifications,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit)
    }
  });
});

// @desc    Mark notification as read
// @route   PUT /api/notifications/:id/read
// @access  Private
const markAsRead = asyncHandler(async (req, res) => {
  const notification = await Notification.findOne({
    _id: req.params.id,
    recipient: req.user.id
  });

  if (!notification) {
    res.status(404);
    throw new Error('Notification not found');
  }

  notification.read = true;
  await notification.save();

  res.status(200).json({
    success: true,
    data: notification,
    message: 'Notification marked as read'
  });
});

// @desc    Mark all notifications as read
// @route   PUT /api/notifications/read-all
// @access  Private
const markAllAsRead = asyncHandler(async (req, res) => {
  await Notification.updateMany(
    { recipient: req.user.id, read: false },
    { $set: { read: true } }
  );

  res.status(200).json({
    success: true,
    message: 'All notifications marked as read'
  });
});

// @desc    Delete a notification
// @route   DELETE /api/notifications/:id
// @access  Private
const deleteNotification = asyncHandler(async (req, res) => {
  const notification = await Notification.findOneAndDelete({
    _id: req.params.id,
    recipient: req.user.id
  });

  if (!notification) {
    res.status(404);
    throw new Error('Notification not found');
  }

  res.status(200).json({
    success: true,
    message: 'Notification deleted successfully'
  });
});

// @desc    Delete all notifications for user
// @route   DELETE /api/notifications
// @access  Private
const deleteAllNotifications = asyncHandler(async (req, res) => {
  await Notification.deleteMany({ recipient: req.user.id });

  res.status(200).json({
    success: true,
    message: 'All notifications deleted successfully'
  });
});

// @desc    Create a notification (internal use)
// @access  Internal
const createNotification = async ({
  recipientId,
  senderId,
  type,
  content,
  referenceId,
  referenceModel,
  priority = 'medium'
}) => {
  try {
    const recipient = await User.findById(recipientId);
    if (!recipient || recipient.disabled) return null;

    const sender = await User.findById(senderId).select('-password');
    if (!sender) return null;

    const notification = await Notification.create({
      recipient: recipientId,
      sender: senderId,
      type,
      content,
      referenceId,
      referenceModel,
      priority
    });

    // Emit real-time notification via Socket.IO
    const io = require('../index').io; // Access Socket.IO instance
    if (io && recipientId) {
      io.to(`user_${recipientId}`).emit('new-notification', {
        ...notification.toObject(),
        sender: sender
      });
    }

    return notification;
  } catch (error) {
    console.error('Error creating notification:', error);
    return null;
  }
};

module.exports = {
  getNotifications,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  deleteAllNotifications,
  createNotification
};