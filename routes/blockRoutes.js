// routes/blockRoutes.js
const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/authMiddleware");
const {
  validateBlockOperations,
  blockUser,
  unblockUser,
  getBlockedUsers,
  checkBlockStatus,
  isBlockedByUser
} = require("../controllers/blockController");

// Block routes
router.post("/", protect, validateBlockOperations, blockUser);
router.delete("/:userId", protect, validateBlockOperations, unblockUser);
router.get("/", protect, getBlockedUsers);
router.get("/check/:userId", protect, checkBlockStatus);
router.get("/is-blocked-by/:userId", protect, isBlockedByUser);

module.exports = router;