const express = require('express');
const router = express.Router();
const {
  getUserDetails,
  updateUserDetails,
  updateProfilePicture,
  getUserHistory,
} = require('../controllers/userController');
const { protect } = require('../middleware/authMiddleware');

router.use(protect); // Protect all routes below

router.get('/me', getUserDetails);
router.put('/me', updateUserDetails);
router.put('/me/avatar', updateProfilePicture);
router.get('/history/:userId', getUserHistory); // Admin only

module.exports = router;