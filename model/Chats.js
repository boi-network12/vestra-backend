const mongoose = require('mongoose');

const chatSchema = new mongoose.Schema({
  chatId: { 
    type: String, 
    required: true, 
    unique: true,
    index: true 
  },
  participants: [{ 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true,
    validate: {
      validator: function(arr) {
        return arr.length === 2 && new Set(arr).size === 2;
      },
      message: 'Chat must have exactly 2 unique participants'
    }
  }],
  lastMessage: { 
    type: String, 
    default: '' 
  },
  updatedAt: { 
    type: Date, 
    default: Date.now,
    index: true 
  },
}, {
  timestamps: true
});

// Ensure participants are always sorted to prevent duplicate chats
chatSchema.pre('save', function(next) {
  this.participants.sort();
  next();
});

module.exports = mongoose.model('Chat', chatSchema);