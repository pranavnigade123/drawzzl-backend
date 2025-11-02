// src/index.ts
import express from 'express';
import http from 'http';
import { Server, Socket } from 'socket.io';
import cors from 'cors';
import 'dotenv/config';
import { connectDB } from './lib/db.js';
import { Room } from './models/Room.js';

interface Player {
  id: string;
  name: string;
  score: number;
  isDrawer?: boolean;
}

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
});

// ---------------------------------------------------------------------
// DB
// ---------------------------------------------------------------------
connectDB().catch((err: Error) => {
  console.error('DB connection failed:', err);
  process.exit(1);
});

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------
function generateRoomId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

const WORDS = [
  'apple', 'house', 'pizza', 'cat', 'dog', 'tree', 'sun', 'moon',
  'star', 'fish', 'car', 'plane', 'boat', 'flower', 'mountain',
  'beach', 'robot', 'rocket', 'cake', 'icecream'
];

// ---------------------------------------------------------------------
// Socket connection
// ---------------------------------------------------------------------
io.on('connection', (socket: Socket) => {
  console.log('Player connected:', socket.id);

  // -------------------------------------------------
  // CREATE ROOM
  // -------------------------------------------------
  socket.on('createRoom', async ({ playerName }) => {
    try {
      const roomId = generateRoomId();
      const newRoom = new Room({
        roomId,
        players: [{ id: socket.id, name: playerName, score: 0, isDrawer: true }],
        gameStarted: false,
      });
      await newRoom.save();

      socket.join(roomId);
      socket.emit('roomCreated', { roomId, playerId: socket.id });
      console.log(`Room ${roomId} created by ${playerName}`);
    } catch (err) {
      socket.emit('error', { message: 'Failed to create room' });
    }
  });

  // -------------------------------------------------
  // JOIN ROOM
  // -------------------------------------------------
  socket.on('joinRoom', async ({ roomId, playerName }) => {
    try {
      const room = await Room.findOne({ roomId });
      if (!room) return socket.emit('error', { message: 'Room not found' });
      if (room.players.length >= room.maxPlayers)
        return socket.emit('error', { message: 'Room is full' });

      const alreadyIn = room.players.some((p: Player) => p.id === socket.id);
      if (!alreadyIn) {
        room.players.push({ id: socket.id, name: playerName, score: 0 });
        await room.save();
      }

      socket.join(roomId);
      socket.emit('roomJoined', { roomId });

      // broadcast fresh player list
      io.to(roomId).emit('playerJoined', { players: room.players });
      console.log(`${playerName} joined ${roomId}`);
    } catch (err) {
      socket.emit('error', { message: 'Failed to join room' });
    }
  });

  // -------------------------------------------------
  // START GAME (creator only, 2+ players)
  // -------------------------------------------------
  socket.on('startGame', async ({ roomId }) => {
    try {
      const room = await Room.findOne({ roomId });
      if (!room) return socket.emit('error', { message: 'Room not found' });
      if (!room.players[0] || room.players[0].id !== socket.id)
        return socket.emit('error', { message: 'Only creator can start' });
      if (room.players.length < 2)
        return socket.emit('error', { message: 'Need 2+ players' });
      if (room.gameStarted) return;

      // pick random word
      const word = WORDS[Math.floor(Math.random() * WORDS.length)] || 'default';
      room.currentWord = word;
      room.gameStarted = true;
      room.round = 1;
      await room.save();

      const hint = '_ '.repeat(word.length).trim();

      // 1. hint + timer to everyone
      io.to(roomId).emit('gameStarted', {
        drawerId: room.players[0].id,
        wordHint: hint,
        timeLeft: 60,
      });

      // 2. real word only to drawer
      io.to(room.players[0].id).emit('yourWord', { word });

      console.log(`Game started in ${roomId} – drawer ${room.players[0].name} – word: ${word}`);
    } catch (err) {
      socket.emit('error', { message: 'Failed to start game' });
    }
  });

  // -------------------------------------------------
  // DRAW & CLEAR (unchanged)
  // -------------------------------------------------
  socket.on('draw', ({ roomId, lines }) => {
    socket.to(roomId).emit('draw', { lines });
  });

  socket.on('clearCanvas', ({ roomId }) => {
    socket.to(roomId).emit('clearCanvas');
  });

  // -------------------------------------------------
  // DISCONNECT – clean up player & possibly end game
  // -------------------------------------------------
  socket.on('disconnect', async () => {
    console.log('Player disconnected:', socket.id);

    // find all rooms the socket was in (usually one)
    const rooms = Array.from(socket.rooms).filter(r => r !== socket.id);
    for (const roomId of rooms) {
      const room = await Room.findOne({ roomId });
      if (!room) continue;

      // remove player
      room.players = room.players.filter((p: Player) => p.id !== socket.id);
      await room.save();

      // if creator left, end game & notify
      if (room.players.length === 0) {
        await Room.deleteOne({ roomId });
        console.log(`Room ${roomId} deleted – empty`);
        continue;
      }

      if (room.players[0] && room.players[0].id !== socket.id) {
        // just broadcast updated list
        io.to(roomId).emit('playerJoined', { players: room.players });
      } else {
        // creator left → reset game
        room.gameStarted = false;
        room.currentWord = undefined;
        await room.save();
        io.to(roomId).emit('gameAborted', { reason: 'Creator left' });
        io.to(roomId).emit('playerJoined', { players: room.players });
      }
    }
  });
});

// ---------------------------------------------------------------------
// Server start
// ---------------------------------------------------------------------
const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`drawzzl backend running on port ${PORT}`);
});