const express = require("express");
const router = express.Router();
const {
  followUser,
  unfollowUser,
  getFollowers,
  getFollowing,
  checkFollowStatus,
  validateFollowOperations,
  getSuggestedFriends
} = require("../controllers/friendsController");
const { protect } = require("../middleware/authMiddleware");

// Follow routes
router.post("/", protect, validateFollowOperations, followUser);
router.delete("/:userId", protect, unfollowUser);
router.get("/followers", protect, getFollowers);
router.get("/following", protect, getFollowing);
router.get("/status/:userId", protect, checkFollowStatus);
router.get("/suggested", protect, getSuggestedFriends);

module.exports = router;