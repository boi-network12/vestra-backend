const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const connectDb = require("./config/db");
const { errorHandler } = require("./middleware/errorMiddleware");
const userRoutes = require("./routes/userRoutes");
const friendRoutes = require("./routes/friendsRoutes");
const chatRoutes = require("./routes/chatRoutes");
const helmet = require("helmet");
const morgan = require("morgan");
const rateLimit = require('express-rate-limit');
const { createServer } = require('http');
const { Server } = require('socket.io');
const Message = require('./model/Message'); 
const Chat = require('./model/Chats');
const messageRoutes = require('./routes/messageRootes');
const { generateLinkPreview } = require("./utils/linkPreview");
const mongoose = require('mongoose');
const blockRoutes = require("./routes/blockRoutes");



dotenv.config();

const app = express();

// Security Middleware
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

const httpServer = createServer(app);
const io = new Server(httpServer, {
  path: "/socket.io/",
  cors: {
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST'],
  }
})

const activeUsers = {};
const seenMessages = new Set();

io.on('connection', (socket) => {
  const userId = socket.handshake.query.userId;
  if (!userId) {
    console.log('No userId provided, disconnecting');
    return socket.disconnect(true);
  }

  activeUsers[userId] = socket.id;

  // Join user to their personal room
  socket.join(`user_${userId}`);

  socket.on('join-chat', (chatId) => {
    socket.join(`chat_${chatId}`);
  });

  // Handle marking messages as read
  socket.on('mark-messages-read', async ({ chatId, userId }) => {
    try {
      const updated = await Message.updateMany(
        { chatId, recipient: userId, status: { $in: ['sent', 'delivered'] } },
        { $set: { status: 'read' } }
      );

      if (updated.modifiedCount > 0) {
        io.to(`chat_${chatId}`).emit('message-read', { chatId, readerId: userId });
      }
    } catch (error) {
      console.error('Error marking messages as read:', error);
    }
  });

  socket.on('message-delivered', async ({ messageId, chatId, recipientId }) => {
    try {
      if (seenMessages.has(messageId)) return;
      seenMessages.add(messageId);

      await Message.updateOne(
        { _id: messageId, chatId, recipient: recipientId },
        { $set: { status: 'delivered' } }
      );

      io.to(`chat_${chatId}`).emit('message-delivered', { messageId });
    } catch (error) {
      console.error('Error marking message as delivered:', error);
    }
  });

  socket.on('typing', ({ chatId, senderId }) => {
    socket.to(`chat_${chatId}`).emit('typing', { senderId });
  });

  socket.on('stop-typing', ({ chatId, senderId }) => {
    socket.to(`chat_${chatId}`).emit('stop-typing', { senderId });
  });

  socket.on('send-message', async ({ chatId, messageData, recipientId }, callback) => {
    try {
      if (seenMessages.has(messageData._id)) {
        console.log('Duplicate message ignored:', messageData._id);
        return callback({ status: 'success', messageId: messageData._id });
      }
      seenMessages.add(messageData._id);

      const message = await Message.create({
        ...messageData,
        _id: messageData._id,
      });

      const participants = [messageData.sender, recipientId].sort();
      await Chat.findOneAndUpdate(
        { chatId },
        {
          chatId,
          participants,
          lastMessage: messageData.text || (messageData.files?.length > 0 ? 'Media' : ''),
          updatedAt: new Date(),
        },
        { upsert: true }
      );

      const responseData = message.toObject();
      io.to(`chat_${chatId}`).emit('new-message', responseData);
      if (activeUsers[recipientId]) {
        io.to(`user_${recipientId}`).emit('new-message', responseData);
      }

      callback({ status: 'success', messageId: message._id });
    } catch (error) {
      console.error('Error handling message:', error);
      callback({ status: 'error', error: error.message });
      socket.emit('message-error', { messageId: messageData._id, error: error.message });
    }
  });

  socket.on('initiate-call', ({ chatId, recipientId, callType }) => {
    if (activeUsers[recipientId]) {
      io.to(`user_${recipientId}`).emit('incoming-call', {
        chatId,
        callerId: userId,
        callType, // 'voice' or 'video'
      });
    } else {
      socket.emit('call-error', { message: 'Recipient is offline' });
    }
  });

  socket.on('accept-call', ({ chatId, callerId }) => {
    io.to(`user_${callerId}`).emit('call-accepted', { chatId, acceptorId: userId });
  });

  socket.on('reject-call', ({ chatId, callerId }) => {
    io.to(`user_${callerId}`).emit('call-rejected', { chatId });
  });

  socket.on('end-call', ({ chatId, recipientId }) => {
    io.to(`chat_${chatId}`).emit('call-ended', { chatId });
  });

  // WebRTC signaling
  socket.on('offer', ({ chatId, offer, recipientId }) => {
    if (activeUsers[recipientId]) {
      io.to(`user_${recipientId}`).emit('offer', { offer });
    }
  });

  socket.on('answer', ({ chatId, answer, recipientId }) => {
    if (activeUsers[recipientId]) {
      io.to(`user_${recipientId}`).emit('answer', { answer });
    }
  });

  socket.on('ice-candidate', ({ chatId, candidate, recipientId }) => {
    if (activeUsers[recipientId]) {
      io.to(`user_${recipientId}`).emit('ice-candidate', { candidate });
    }
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    delete activeUsers[userId]
    console.log(`User ${userId} disconnected`);
  });
})

// // Rate limiting
// const limiter = rateLimit({
//   windowMs: 15 * 60 * 1000, // 15 minutes
//   max: 100, // limit each IP to 100 requests per windowMs
//   message: 'Too many requests from this IP, please try again later'
// });
// app.use(limiter);

// Request logging
if (process.env.NODE_ENV === "development") {
  app.use(morgan("dev"));
} else {
  app.use(morgan("combined"));
}

// Enhanced request logging middleware
app.use((req, res, next) => {
  console.log(`\n[${new Date().toISOString()}] ${req.method} ${req.path}`);
  console.log('Headers:', {
    'content-type': req.headers['content-type'],
    authorization: req.headers.authorization ? '*****' : 'none',
    'user-agent': req.headers['user-agent']
  });
  
  if (req.body && Object.keys(req.body).length > 0) {
    console.log('Body:', JSON.stringify(req.body, null, 2));
  }
  
  next();
});


// Body parsers
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));


// Database connection with enhanced error handling
connectDb().catch(err => {
  console.error('Database connection error:', err);
  process.exit(1);
});

// Health check endpoint
app.get("/", (req, res) => {
  res.json({ 
    status: "running",
    environment: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString()
  });
});

// API routes
app.use("/api/users", userRoutes);
app.use("/api/friends", friendRoutes);
app.use("/api/block", blockRoutes);
app.use('/chats', chatRoutes);
app.use('/messages', messageRoutes)

// 404 handler
app.use((req, res, next) => {
  res.status(404).json({
    success: false,
    message: `Not Found - ${req.method} ${req.originalUrl}`
  });
});

// Error handler
app.use(errorHandler);

const PORT = process.env.PORT || 5000;
const server = httpServer.listen(PORT, () => {
  console.log(`🚀 Server running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`);
});


// Handle unhandled promise rejections
process.on("unhandledRejection", (err) => {
  console.error(`Unhandled Rejection: ${err.message}`);
  console.error(err.stack);
  server.close(() => process.exit(1));
});

// Handle uncaught exceptions
process.on("uncaughtException", (err) => {
  console.error(`Uncaught Exception: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received. Shutting down gracefully...');
  server.close(() => {
    console.log('Process terminated');
  });
});

setInterval(() => {
  console.log(`[${new Date().toString()} Backend still alive]`)
}, 10000)