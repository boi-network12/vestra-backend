const express = require('express');
const router = express.Router();
const postController = require('../controllers/postController');
const postInteractionController = require('../controllers/postInteractionController');
const { uploadMedia, processMediaUpload } = require('../middleware/uploadMiddleware');
const { validateCreatePost } = require('../controllers/postController');
const { protect } = require('../middleware/authMiddleware');

module.exports = (io) => {
    // Create a new post with media upload
    router.post(
      '/',
      protect,
      uploadMedia('media', 10),
      processMediaUpload,
      validateCreatePost,
      async (req, res) => {
        req.io = io;
        await postController.createPost(req, res); 
      }
    );

    router.get('/friends', protect, async (req, res) => {
      req.io = io;
      await postController.getFriends(req, res); 
    });
    

    // Other routes remain unchanged
    router.get('/', protect, async (req, res) => {
      req.io = io;
      await postController.getPosts(req, res); 
    });

    router.get('/:id', protect, async (req, res) => {
      req.io = io;
      await postController.getPost(req, res); 
    });

    router.delete('/:id', protect, async (req, res) => {
      req.io = io;
      await postController.deletePost(req, res);
    });

    router.post('/:id/report', protect, async (req, res) => {
      req.io = io;
      await postController.reportPost(req, res);
    });

    

    // interaction controller
    router.post('/:id/like', protect, async (req, res) => {
      req.io = io;
      await postInteractionController.likePost(req, res); 
    });

    router.delete('/:id/like', protect, async (req, res) => {
      req.io = io;
      await postInteractionController.unlikePost(req, res); 
    });

    router.post(
      '/:id/comments',
      protect,
      uploadMedia('media', 5),
      processMediaUpload,
      async (req, res) => {
        req.io = io;
        await postInteractionController.createComment(req, res);
      }
    );

    router.get('/:id/comments', protect, async (req, res) => {
      req.io = io;
      await postInteractionController.getComments(req, res);
    });

    router.post('/:id/share', protect, async (req, res) => {
      req.io = io;
      await postInteractionController.sharePost(req, res); 
    });

    router.post(
      '/:id/repost',
      protect,
      async (req, res) => {
        req.io = io;
        await postInteractionController.repostPost(req, res);
      }
    );

    router.post(
      '/:id/quote',
      protect,
      uploadMedia('media', 10),
      processMediaUpload,
      async (req, res) => {
        req.io = io;
        await postInteractionController.quotePost(req, res);
      }
    );

    router.delete('/:id/repost', protect, async (req, res) => {
      req.io = io;
      await postInteractionController.unrepostPost(req, res);
    });

    router.post(
      '/:id/bookmark',
      protect,
      async (req, res) => {
        req.io = io;
        await postInteractionController.bookmarkPost(req, res);
      }
    );
  
    // Remove bookmark
    router.delete(
      '/:id/bookmark',
      protect,
      async (req, res) => {
        req.io = io;
        await postInteractionController.removeBookmark(req, res);
      }
    );
  
    // Increment view count
    router.post(
      '/:id/view',
      protect,
      async (req, res) => {
        req.io = io;
        await postInteractionController.incrementViewCount(req, res);
      }
    );

    return router;
};