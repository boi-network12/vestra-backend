const express = require("express");
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

module.exports = (io) => {
  const router = express.Router();

  
// Follow routes
  router.post("/", protect, validateFollowOperations, ( req, res ) => followUser(req, res, io));
  
  router.delete("/:userId", protect, unfollowUser);
  router.get("/followers", protect, getFollowers);
  router.get("/following", protect, getFollowing);
  router.get("/status/:userId", protect, checkFollowStatus);
  router.get("/suggested", protect, getSuggestedFriends);

  return router
}
