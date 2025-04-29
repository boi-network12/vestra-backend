const express = require('express');
const router = express.Router();
const {
  getNotifications,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  deleteAllNotifications
} = require('../controllers/notificationController');
const { protect } = require('../middleware/authMiddleware');

router.use(protect);

router.route('/')
  .get(getNotifications)
  .delete(deleteAllNotifications);

router.route('/read-all')
  .put(markAllAsRead);

router.route('/:id')
  .delete(deleteNotification);

router.route('/:id/read')
  .put(markAsRead);

module.exports = router;