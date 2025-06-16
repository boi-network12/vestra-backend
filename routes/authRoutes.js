const express = require('express');
const router = express.Router();
const {
  register,
  login,
  forgotPassword,
  resetPassword,
  resendVerificationCode,
  checkUsername,
  verifyUser,
} = require('../controllers/authController');

router.post('/register', register);
router.post('/login', login);
router.post('/forgot-password', forgotPassword);
router.post('/check-username', checkUsername)
router.post('/resend-verification', resendVerificationCode);
router.put('/reset-password/:token', resetPassword);
router.post('/verify', verifyUser);

module.exports = router;