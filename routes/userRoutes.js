const express = require("express");
const {
  registerUser,
  loginUser,
  updateUser,
  deleteUser,
  getCurrentUser,
  validateRegister,
  validateLogin,
  logoutUser,
  logoutAllDevices
} = require("../controllers/authController");
const { protect } = require("../middleware/authMiddleware");

module.exports = (io) => {
   const router = express.Router();

   router.use((req, res, next) => {
      req.io = io;
      next();
    });

   // Public routes
    router.post("/register", validateRegister, registerUser);
    router.post("/login", validateLogin, loginUser);

    // Protected routes
    // Protected route with enhanced error handling
    router.get("/me", protect, async (req, res, next) => {
      try {
        await getCurrentUser(req, res);
      } catch (err) {
        console.error('Error in /me route handler:', err);
        next(err);
      }
    });
    router.put("/update", protect, updateUser);
    router.delete("/delete", protect, deleteUser);
    
    // Logout routes
    router.post('/logout', protect, logoutUser);
    router.post('/logout-all', protect, logoutAllDevices);

  return router;
}
