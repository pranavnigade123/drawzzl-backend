import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import 'dotenv/config';
import { connectDB } from './lib/db.js';
import { registerSocketHandlers } from './handlers/socketHandlers.js';
import { roomIntervals } from './services/gameEngine.js';

// Initialize Express app
const app = express();
app.use(cors());

// Create HTTP server and Socket.IO instance
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
});

// Connect to MongoDB
connectDB().catch((err: Error) => {
  console.error('DB connection failed:', err);
  process.exit(1);
});

// Register Socket.IO event handlers
io.on('connection', (socket) => {
  registerSocketHandlers(io, socket);
});

// Start server
const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`drawzzl backend running on port ${PORT}`);
});

// Graceful shutdown
const shutdown = () => {
  console.log('Shutting down gracefully...');
  roomIntervals.forEach((timer) => clearInterval(timer));
  roomIntervals.clear();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
