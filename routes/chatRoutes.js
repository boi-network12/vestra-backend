const express = require('express');
const router = express.Router();
const Chat = require('../model/Chats');
const Message = require('../model/Message');
const { protect } = require('../middleware/authMiddleware');


// Get chat history
router.get('/:chatId/messages', protect, async (req, res) => {
  try {
    const { chatId } = req.params;
    const { limit = 50, skip = 0 } = req.query;

    const messages = await Message.find({ chatId })
      .sort({ createdAt: -1 })
      .skip(parseInt(skip))
      .limit(parseInt(limit))
      .lean();

    res.json(messages.reverse()); // Return oldest first
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// Create or get chat
router.post('/', protect, async (req, res) => {
  try {
    const { participantId } = req.body;
    const userId = req.user._id;

    if (!participantId) {
      return res.status(400).json({ error: 'Participant ID is required' });
    }

    if (participantId === userId.toString()) {
      return res.status(400).json({ error: 'Cannot create chat with yourself' });
    }

    const participants = [userId, participantId].sort();
    const chatId = participants.join('_');

    let chat = await Chat.findOne({ chatId }).populate('participants');

    if (!chat) {
      chat = await Chat.create({
        chatId,
        participants,
        lastMessage: '',
        updatedAt: new Date()
      });

      // Populate participants for response
      chat = await Chat.findById(chat._id).populate('participants');
    }

    res.json(chat);
  } catch (error) {
    console.error('Error creating chat:', error);
    res.status(500).json({ error: 'Failed to create chat' });
  }
});

module.exports = router;