const express = require('express');
const router = express.Router();
const {
  register,
  login,
  forgotPassword,
  resetPassword,
  resendVerificationCode,
} = require('../controllers/authController');

router.post('/register', register);
router.post('/login', login);
router.post('/forgot-password', forgotPassword);
router.post('/resend-verification', resendVerificationCode);
router.put('/reset-password/:token', resetPassword);

module.exports = router;