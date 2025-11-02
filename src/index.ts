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

// === Turn engine config ===
const ROOM_TICK_MS = 1000;
const TURN_SECONDS = 60;

// Track per-room ticking intervals
const roomIntervals = new Map<string, NodeJS.Timeout>();

function maskWord(word: string) {
  return '_ '.repeat(word.length).trim();
}

// --- Safe drawer helpers ---
function getDrawerIndex(room: any): number {
  const len = Array.isArray(room?.players) ? room.players.length : 0;
  if (len === 0) return 0;
  const idx = typeof room?.drawerIndex === 'number' ? room.drawerIndex : 0;
  // clamp between 0 and len-1
  return Math.min(Math.max(0, idx), len - 1);
}

function getDrawer(room: any): Player | undefined {
  const len = Array.isArray(room?.players) ? room.players.length : 0;
  if (len === 0) return undefined;
  return room.players[getDrawerIndex(room)];
}

function hasPlayers(room: any): boolean {
  return Array.isArray(room?.players) && room.players.length > 0;
}

async function endTurn(io: Server, roomId: string) {
  const room = await Room.findOne({ roomId });
  if (!room || !hasPlayers(room)) return;

  // Drawer bonus based on # correct guessers
  const drawer = getDrawer(room);
  const drawerBonus = 5 * (room.correctGuessers?.length || 0);
  if (drawer) {
    drawer.score = (drawer.score || 0) + drawerBonus;
  }

  io.to(roomId).emit('turnEnded', {
    word: room.currentWord,
    correctGuessers: room.correctGuessers ?? [],
    drawerBonus,
  });

  // Rotate drawer safely
  if (room.players.length > 0) {
    const nextIdx = (getDrawerIndex(room) + 1) % room.players.length;
    room.drawerIndex = nextIdx;

    // If wrapped, increment round
    if (nextIdx === 0) {
      room.round = (room.round || 1) + 1;
    }
  }

  // Game end?
  if ((room.round || 1) > (room.maxRounds || 3)) {
    const t = roomIntervals.get(roomId);
    if (t) clearInterval(t);
    roomIntervals.delete(roomId);

    const sorted = [...room.players].sort((a, b) => (b.score || 0) - (a.score || 0));
    io.to(roomId).emit('gameOver', { players: sorted });
    room.gameStarted = false;
    room.currentWord = undefined;
    room.correctGuessers = [];
    await room.save();
    return;
  }

  // Intermission then next turn
  room.currentWord = undefined;
  room.correctGuessers = [];
  await room.save();

  setTimeout(async () => {
    const fresh = await Room.findOne({ roomId });
    if (fresh) startTurn(io, fresh);
  }, 2000);
}

function startTurn(io: Server, room: any) {
  if (!hasPlayers(room)) return;

  // Pick new word and set timing
  const word = WORDS[Math.floor(Math.random() * WORDS.length)] || 'default';
  room.currentWord = word;
  room.correctGuessers = [];
  room.gameStarted = true;
  room.turnEndsAt = new Date(Date.now() + TURN_SECONDS * 1000);

  // Mark drawer on players array
  const safeIdx = getDrawerIndex(room);
  room.players = room.players.map((p: Player, idx: number) => ({
    ...p,
    isDrawer: idx === safeIdx,
  }));

  // Broadcast start-of-turn state
  const hint = maskWord(word);
  const drawer = getDrawer(room);
  io.to(room.roomId).emit('gameStarted', {
    drawerId: drawer?.id ?? null,
    wordHint: hint,
    timeLeft: TURN_SECONDS,
    round: room.round,
    maxRounds: room.maxRounds || 3,
  });

  // Send actual word to drawer only
  if (drawer?.id) {
    io.to(drawer.id).emit('yourWord', { word });
  }

  // Reset interval for this room
  const prev = roomIntervals.get(room.roomId);
  if (prev) clearInterval(prev);

  const timer = setInterval(async () => {
    const r = await Room.findOne({ roomId: room.roomId });
    if (!r) return;

    const endsAt = r.turnEndsAt ? new Date(r.turnEndsAt).getTime() : 0;
    const secs = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
    io.to(room.roomId).emit('tick', { timeLeft: secs });

    // End when timer hits zero or all guessers (except drawer) finished
    const everyoneGuessed = (r.correctGuessers?.length || 0) >= Math.max(0, (r.players.length - 1));

    if (secs <= 0 || everyoneGuessed) {
      clearInterval(timer);
      roomIntervals.delete(room.roomId);
      await endTurn(io, room.roomId);
    }
  }, ROOM_TICK_MS);

  roomIntervals.set(room.roomId, timer);

  // Persist state
  room.markModified?.('players');
  void room.save();
}

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
        round: 1,
        drawerIndex: 0,
        maxRounds: 3,
        correctGuessers: [],
        chat: [],
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

      const creatorId = room.players[0]?.id;
      if (!creatorId || creatorId !== socket.id)
        return socket.emit('error', { message: 'Only creator can start' });

      if (room.players.length < 2)
        return socket.emit('error', { message: 'Need 2+ players' });

      if (room.gameStarted) return;

      room.round = 1;
      room.drawerIndex = 0;
      await room.save();

      startTurn(io, room);
    } catch (err) {
      socket.emit('error', { message: 'Failed to start game' });
    }
  });

  // -------------------------------------------------
  // DRAW & CLEAR
  // -------------------------------------------------
  socket.on('draw', ({ roomId, lines }) => {
    socket.to(roomId).emit('draw', { lines });
  });

  socket.on('clearCanvas', ({ roomId }) => {
    socket.to(roomId).emit('clearCanvas');
  });

  // -------------------------------------------------
  // CHAT & GUESS
  // -------------------------------------------------
  socket.on('chat', async ({ roomId, msg, name }) => {
    const room = await Room.findOne({ roomId });
    if (!room || !msg?.trim()) return;
    room.chat = Array.isArray(room.chat) ? room.chat : [];
    room.chat.push({ id: socket.id, name, msg, ts: new Date() });
    await room.save();
    io.to(roomId).emit('chat', { id: socket.id, name, msg });
  });

  socket.on('guess', async ({ roomId, guess, name }) => {
    const room = await Room.findOne({ roomId });
    if (!room || !room.currentWord || !room.gameStarted) return;

    const g = (guess || '').trim().toLowerCase();
    if (!g) return;

    const ans = room.currentWord.toLowerCase();

    if (g === ans) {
      const isDrawer = socket.id === getDrawer(room)?.id;
      const already = room.correctGuessers?.includes(socket.id);
      if (isDrawer || already) return;

      room.correctGuessers = Array.isArray(room.correctGuessers) ? room.correctGuessers : [];
      room.correctGuessers.push(socket.id);

      // Scoring: 10 + timeLeft
      const endsAt = room.turnEndsAt ? new Date(room.turnEndsAt).getTime() : 0;
      const secs = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
      const points = 10 + secs;

      const player = room.players.find((p: Player) => p.id === socket.id);
      if (player) player.score = (player.score || 0) + points;

      await room.save();

      io.to(roomId).emit('correctGuess', {
        playerId: socket.id,
        name,
        points,
        total: player?.score ?? 0,
      });

      // Everyone (except drawer) guessed → end early
      const nonDrawers = Math.max(0, room.players.length - 1);
      if ((room.correctGuessers?.length || 0) >= nonDrawers) {
        await endTurn(io, roomId);
      }
    } else {
      // wrong guess → echo as chat message
      io.to(roomId).emit('chat', { id: socket.id, name, msg: guess });
    }
  });

  // -------------------------------------------------
  // DISCONNECT – clean up player & possibly end game
  // -------------------------------------------------
  socket.on('disconnect', async () => {
    console.log('Player disconnected:', socket.id);

    // Find all rooms the socket was in (usually one)
    const rooms = Array.from(socket.rooms).filter(r => r !== socket.id);
    for (const roomId of rooms) {
      const room = await Room.findOne({ roomId });
      if (!room) continue;

      // Remove player
      room.players = room.players.filter((p: Player) => p.id !== socket.id);

      // If the drawer index is now out of range, clamp it
      if ((room.drawerIndex ?? 0) >= room.players.length) {
        room.drawerIndex = 0;
      }

      await room.save();

      // If room empty → delete
      if (room.players.length === 0) {
        await Room.deleteOne({ roomId });
        const t = roomIntervals.get(roomId);
        if (t) clearInterval(t);
        roomIntervals.delete(roomId);
        console.log(`Room ${roomId} deleted – empty`);
        continue;
      }

      // broadcast updated players list
      io.to(roomId).emit('playerJoined', { players: room.players });
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
