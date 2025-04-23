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

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);


  const userId = socket.handshake.query.userId;
  if (!userId) {
    console.log('No userId provided, disconnecting');
    return socket.disconnect(true);
  }

  activeUsers[userId] = socket.id;

  // Join user to their personal room
  socket.join(`user_${userId}`);

  // Handle joining chat rooms
  socket.on('join-chat', (chatId) => {
    socket.join(`chat_${chatId}`);
    console.log(`User ${userId} joined chat ${chatId}`);
  });

  // Handle sending messages
  socket.on('send-message', async ({ chatId, encryptedMessage, recipientId, files, link }) => {
    try {
      // Validate input
      if (!chatId || !recipientId) {
        throw new Error('Missing required fields');
      }

      let linkPreview = null;
      if (link) {
        try {
          linkPreview = await generateLinkPreview(link);
        } catch (err) {
          console.error('Error generating link preview:', err);
        }
      }

      const messageData = {
        _id: encryptedMessage._id || new mongoose.Types.ObjectId(),
        chatId,
        sender: userId,
        recipient: recipientId,
        text: encryptedMessage?.text || '',
        encrypted: true, // Add encrypted flag
        files: files || [],
        linkPreview,
        status: 'sent',
        createdAt: new Date()
      };

      const message = await Message.create(messageData);

      // Update chat's last message
      let lastMessageText = '';
      if (files && files.length > 0) {
        const fileTypes = [...new Set(files.map(f => f.type))];
        if (fileTypes.includes('image')) lastMessageText = '📷 Image';
        else if (fileTypes.includes('video')) lastMessageText = '🎥 Video';
        else if (fileTypes.includes('audio')) lastMessageText = '🔊 Audio';
        else lastMessageText = '📄 File';
      } else if (link) {
        lastMessageText = '🔗 Link';
      } else {
        lastMessageText = encryptedMessage?.text || '';
      }

      // Update chat's last message
      await Chat.findOneAndUpdate(
        { chatId },
        { 
          lastMessage: encryptedMessage.text,
          updatedAt: new Date() 
        },
        { upsert: true }
      );

      await Message.updateMany(
        { encrypted: { $exists: false } },
        { $set: { encrypted: true } }
      )

      // Prepare the response data
      const responseData = {
        ...message.toObject(),
        _id: message._id,
        createdAt: message.createdAt,
        status: message.status
      };

      // Emit to chat room
      io.to(`chat_${chatId}`).emit('new-message', responseData);

      // Notify recipient if they're not in the chat room
      if (!socket.rooms.has(`chat_${chatId}`)) {
        io.to(`user_${recipientId}`).emit('new-message', responseData);
      }

      // Confirm delivery to sender
      socket.emit('message-delivered', message._id);

    } catch (error) {
      console.error('Error handling message:', error);
      socket.emit('message-error', {
        messageId: encryptedMessage?._id,
        error: 'Failed to send message'
      });
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
app.use('/', chatRoutes);
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