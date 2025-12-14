import express from 'express';
import http from 'http';
import { Server, Socket } from 'socket.io';
import cors from 'cors';
import 'dotenv/config';
import { connectDB } from './lib/db.js';
import { Room } from './models/Room.js';
import { WORDS, getRandomWordByDifficulty } from './lib/words.js';
import { validateMessage, containsProfanity } from './lib/profanityFilter.js';

interface Player {
  id: string;
  sessionId: string;       // Persistent session ID
  name: string;
  score: number;
  isDrawer?: boolean;
  avatar?: number[]; // [colorIdx, eyeIdx, mouthIdx, accessoryIdx]
  isConnected: boolean;    // Connection status
  lastSeen: Date;          // Last activity timestamp
}

const app = express();
app.use(cors());

// Health check endpoint for monitoring
app.get('/health', async (req, res) => {
  try {
    // Check database connection
    const dbStatus = dbConnected ? 'connected' : 'disconnected';
    
    // Get basic stats
    const roomCount = await Room.countDocuments();
    const activeRooms = await Room.countDocuments({ 
      'players.isConnected': true 
    });

    res.status(200).json({ 
      status: 'ok', 
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      database: dbStatus,
      rooms: {
        total: roomCount,
        active: activeRooms
      },
      memory: {
        used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
        total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + 'MB'
      }
    });
  } catch (error) {
    res.status(500).json({ 
      status: 'error', 
      message: 'Health check failed',
      timestamp: new Date().toISOString()
    });
  }
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { 
    origin: [
      'http://localhost:3000',
      /\.vercel\.app$/, // Allow all Vercel deployments
      'https://drawzzl.drawfive.in',
      /\.drawfive\.in$/ // Allow all drawfive.in subdomains
    ],
    credentials: true 
  },
  // Production optimizations
  pingTimeout: 60000,
  pingInterval: 25000,
  upgradeTimeout: 30000,
  allowEIO3: true,
  transports: ['websocket', 'polling'],
});

// ---------------------------------------------------------------------
// DB
// ---------------------------------------------------------------------
let dbConnected = false;

async function initializeServer() {
  try {
    await connectDB();
    dbConnected = true;
    console.log('Database connected, setting up socket handlers...');
    setupSocketHandlers();
  } catch (err) {
    console.error('DB connection failed:', err);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------
function generateRoomId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function generateSessionId() {
  return 'session_' + Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
}

// Rate limiting helper
function checkRateLimit(
  socketId: string, 
  limitMap: Map<string, { count: number; resetTime: number }>,
  maxCount: number,
  windowMs: number
): boolean {
  const now = Date.now();
  const userLimit = limitMap.get(socketId);

  if (!userLimit || now > userLimit.resetTime) {
    // Reset or create new limit
    limitMap.set(socketId, { count: 1, resetTime: now + windowMs });
    return true;
  }

  if (userLimit.count >= maxCount) {
    return false; // Rate limit exceeded
  }

  userLimit.count++;
  return true;
}

// Room cleanup function
async function cleanupInactiveRooms() {
  try {
    const now = new Date();
    const rooms = await Room.find({});
    
    for (const room of rooms) {
      const timeSinceActivity = now.getTime() - room.lastActivity.getTime();
      const connectedPlayers = room.players.filter(p => p.isConnected).length;
      
      let shouldDelete = false;
      let reason = '';
      
      // Delete empty rooms after 5 minutes
      if (connectedPlayers === 0 && timeSinceActivity > EMPTY_ROOM_EXPIRY) {
        shouldDelete = true;
        reason = 'empty room timeout';
      }
      // Delete inactive rooms after 1 hour
      else if (timeSinceActivity > ROOM_EXPIRY_TIME) {
        shouldDelete = true;
        reason = 'inactivity timeout';
      }
      
      if (shouldDelete) {
        console.log(`[CLEANUP] Deleting room ${room.roomId} (${reason})`);
        
        // Clear any intervals for this room
        const interval = roomIntervals.get(room.roomId);
        if (interval) {
          clearInterval(interval);
          roomIntervals.delete(room.roomId);
        }
        
        const timeout = wordSelectionTimeouts.get(room.roomId);
        if (timeout) {
          clearTimeout(timeout);
          wordSelectionTimeouts.delete(room.roomId);
        }
        
        endTurnInProgress.delete(room.roomId);
        
        // Delete the room
        await Room.deleteOne({ roomId: room.roomId });
      }
    }
  } catch (error) {
    console.error('[CLEANUP] Error cleaning up rooms:', error);
  }
}

// === Turn engine config ===
const ROOM_TICK_MS = 1000;
const TURN_SECONDS = 60;
const MAX_POINTS = 500;
const MIN_POINTS = 50;
const DRAWER_BONUS_PER_GUESSER = 50;

// Track per-room ticking intervals
const roomIntervals = new Map<string, NodeJS.Timeout>();
const wordSelectionTimeouts = new Map<string, NodeJS.Timeout>();
const endTurnInProgress = new Map<string, boolean>();

// Rate limiting maps
const drawingRateLimit = new Map<string, { count: number; resetTime: number }>();
const chatRateLimit = new Map<string, { count: number; resetTime: number }>();

// Rate limiting constants
const DRAWING_RATE_LIMIT = 50; // Max 50 drawing events per 5 seconds
const DRAWING_RATE_WINDOW = 5000; // 5 seconds
const CHAT_RATE_LIMIT = 10; // Max 10 messages per minute
const CHAT_RATE_WINDOW = 60000; // 1 minute

// Room cleanup constants
const ROOM_CLEANUP_INTERVAL = 10 * 60 * 1000; // Check every 10 minutes
const ROOM_EXPIRY_TIME = 60 * 60 * 1000; // 1 hour of inactivity
const EMPTY_ROOM_EXPIRY = 5 * 60 * 1000; // 5 minutes for empty rooms

function maskWord(word: string, revealedIndices: number[] = []) {
  return word
    .split('')
    .map((char, idx) => (revealedIndices.includes(idx) ? char : '_'))
    .join(' ');
}

// Get random indices to reveal (avoiding already revealed ones)
function getRevealIndices(word: string, count: number, alreadyRevealed: number[] = []): number[] {
  const availableIndices = Array.from({ length: word.length }, (_, i) => i)
    .filter(i => !alreadyRevealed.includes(i));
  
  const shuffled = availableIndices.sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

// Calculate Levenshtein Distance (Edit Distance)
function getEditDistance(str1: string, str2: string): number {
  const len1 = str1.length;
  const len2 = str2.length;
  const matrix: number[][] = [];

  // Initialize matrix
  for (let i = 0; i <= len1; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= len2; j++) {
    if (matrix[0]) {
      matrix[0][j] = j;
    }
  }

  // Fill matrix
  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      if (str1[i - 1] === str2[j - 1]) {
        const prevVal = matrix[i - 1]?.[j - 1];
        if (prevVal !== undefined) {
          matrix[i]![j] = prevVal;
        }
      } else {
        const sub = matrix[i - 1]?.[j - 1] ?? Infinity;
        const ins = matrix[i]?.[j - 1] ?? Infinity;
        const del = matrix[i - 1]?.[j] ?? Infinity;
        matrix[i]![j] = Math.min(sub + 1, ins + 1, del + 1);
      }
    }
  }

  return matrix[len1]?.[len2] ?? 0;
}

// Calculate points based on time remaining (5-second interval decay)
function calculatePoints(timeRemaining: number, maxTime: number): number {
  // Round down to nearest 5-second interval
  const intervalTime = Math.floor(timeRemaining / 5) * 5;
  const percentage = intervalTime / maxTime;
  const points = Math.floor(MAX_POINTS * percentage);
  return Math.max(MIN_POINTS, points); // Apply floor
}

// --- Safe drawer helpers ---
function getDrawerIndex(room: any): number {
  const len = Array.isArray(room?.players) ? room.players.length : 0;
  if (len === 0) return 0;
  const idx = typeof room?.drawerIndex === 'number' ? room.drawerIndex : 0;
  // clamp between 0 and len-1
  const clampedIdx = Math.min(Math.max(0, idx), len - 1);
  
  if (idx !== clampedIdx) {
    console.log(`[DRAWER DEBUG] DrawerIndex clamped: ${idx} -> ${clampedIdx} (players: ${len})`);
  }
  
  return clampedIdx;
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
  // Prevent duplicate endTurn calls
  if (endTurnInProgress.get(roomId)) {
    console.log(`[DRAWER DEBUG] EndTurn already in progress for room ${roomId}, skipping duplicate call`);
    return;
  }
  
  endTurnInProgress.set(roomId, true);
  console.log(`[DRAWER DEBUG] EndTurn started for room ${roomId}`);
  
  try {
    const room = await Room.findOne({ roomId });
    if (!room || !hasPlayers(room)) {
      endTurnInProgress.delete(roomId);
      return;
    }

  // Drawer bonus: flat bonus per correct guesser
  const drawer = getDrawer(room);
  const drawerBonus = DRAWER_BONUS_PER_GUESSER * (room.correctGuessers?.length || 0);
  if (drawer) {
    drawer.score = (drawer.score || 0) + drawerBonus;
    // Track drawer's round points
    room.roundPoints.set(drawer.sessionId, drawerBonus);
  }

  // Save room with updated scores
  await room.save();

  // Prepare round results with points earned this round
  const playersWithRoundPoints = room.players.map((p: Player) => ({
    id: p.id,
    name: p.name,
    score: p.score || 0,
    avatar: p.avatar,
    roundPoints: room.roundPoints.get(p.sessionId) || 0,
  }));

  io.to(roomId).emit('turnEnded', {
    word: room.currentWord,
    correctGuessers: room.correctGuessers ?? [],
    drawerBonus,
    players: playersWithRoundPoints,
  });

  // Rotate drawer safely
  if (room.players.length > 0) {
    const currentIdx = getDrawerIndex(room);
    const currentDrawer = getDrawer(room);
    console.log(`[DRAWER DEBUG] Turn ending - Current drawer: ${currentDrawer?.name} (index: ${currentIdx})`);
    
    const nextIdx = (currentIdx + 1) % room.players.length;
    const nextDrawer = room.players[nextIdx];
    room.drawerIndex = nextIdx;

    console.log(`[DRAWER DEBUG] Drawer rotation: ${currentIdx}:${currentDrawer?.name} -> ${nextIdx}:${nextDrawer?.name} (${room.players.length} players)`);

    // If wrapped, increment round
    if (nextIdx === 0) {
      room.round = (room.round || 1) + 1;
      console.log(`[DRAWER DEBUG] Round incremented to: ${room.round} (wrapped back to first player)`);
    }
  }

  // Game end?
  if ((room.round || 1) > (room.maxRounds || 3)) {
    console.log(`[DRAWER DEBUG] Game ending - Final round: ${room.round}, Max rounds: ${room.maxRounds}`);
    
    const t = roomIntervals.get(roomId);
    if (t) clearInterval(t);
    roomIntervals.delete(roomId);

    const sorted = [...room.players].sort((a, b) => (b.score || 0) - (a.score || 0));
    io.to(roomId).emit('gameOver', { players: sorted });
    room.gameStarted = false;
    room.currentWord = undefined;
    room.correctGuessers = [];
    await room.save();
    
    console.log(`[DRAWER DEBUG] Game ended and state reset`);
    endTurnInProgress.delete(roomId);
    return;
  }

  // Intermission then next turn (5 seconds for results display)
  room.currentWord = undefined;
  room.correctGuessers = [];
  
    console.log(`[DRAWER DEBUG] Saving room state - drawerIndex: ${room.drawerIndex}, round: ${room.round}`);
    
    // Handle MongoDB version conflicts with retry
    let saveAttempts = 0;
    const maxAttempts = 3;
    
    while (saveAttempts < maxAttempts) {
      try {
        await room.save();
        console.log(`[DRAWER DEBUG] Room state saved successfully (attempt ${saveAttempts + 1})`);
        break;
      } catch (error: any) {
        saveAttempts++;
        if (error.name === 'VersionError' && saveAttempts < maxAttempts) {
          console.log(`[DRAWER DEBUG] Version conflict, retrying save (attempt ${saveAttempts + 1}/${maxAttempts})`);
          // Reload fresh data and retry
          const freshRoom = await Room.findOne({ roomId });
          if (freshRoom) {
            freshRoom.drawerIndex = room.drawerIndex;
            freshRoom.round = room.round;
            freshRoom.currentWord = room.currentWord;
            freshRoom.correctGuessers = room.correctGuessers;
            // Update room properties instead of reassigning
            Object.assign(room, freshRoom);
          }
        } else {
          console.log(`[DRAWER DEBUG] Failed to save room state after ${saveAttempts} attempts:`, error);
          throw error;
        }
      }
    }

    setTimeout(async () => {
      console.log(`[DRAWER DEBUG] Loading fresh room data after 5 second delay...`);
      const fresh = await Room.findOne({ roomId });
      if (fresh) {
        console.log(`[DRAWER DEBUG] Fresh room loaded - drawerIndex: ${fresh.drawerIndex}, round: ${fresh.round}, next drawer: ${fresh.players[fresh.drawerIndex]?.name}`);
        startTurn(io, fresh);
      } else {
        console.log(`[DRAWER DEBUG] ERROR: Could not load fresh room data!`);
      }
      // Clear the endTurn lock after starting next turn
      endTurnInProgress.delete(roomId);
    }, 5000);
    
  } catch (error) {
    console.log(`[DRAWER DEBUG] Error in endTurn for room ${roomId}:`, error);
    endTurnInProgress.delete(roomId);
  }
}

// Select words based on custom word probability and difficulty
function selectWords(room: any, count: number): string[] {
  const selectedWords: string[] = [];
  const customWords = room.customWords || [];
  const probability = room.customWordProbability || 0;

  for (let i = 0; i < count; i++) {
    const useCustom = customWords.length > 0 && Math.random() * 100 < probability;
    
    if (useCustom && customWords.length > 0) {
      // Pick from custom words
      const word = customWords[Math.floor(Math.random() * customWords.length)] || 'default';
      selectedWords.push(word);
    } else {
      // Pick from server dictionary with weighted difficulty
      // 20% easy, 40% medium, 40% hard
      const rand = Math.random() * 100;
      let word: string;
      
      if (rand < 20) {
        // 20% chance - Easy word
        word = getRandomWordByDifficulty('easy');
      } else if (rand < 60) {
        // 40% chance - Medium word
        word = getRandomWordByDifficulty('medium');
      } else {
        // 40% chance - Hard word
        word = getRandomWordByDifficulty('hard');
      }
      
      selectedWords.push(word);
    }
  }

  return selectedWords;
}

function startTurn(io: Server, room: any) {
  if (!hasPlayers(room)) return;

  const drawer = getDrawer(room);
  if (!drawer) return;

  console.log(`[DRAWER DEBUG] Turn starting - Round ${room.round}, Selected drawer: ${drawer.name} (index: ${room.drawerIndex}), Total players: ${room.players.length}`);

  // Generate word choices
  const wordCount = room.wordCount || 3;
  const wordChoices = selectWords(room, wordCount);

  // Set timing (use room's drawTime setting)
  const drawTime = room.drawTime || 60;
  room.correctGuessers = [];
  room.gameStarted = true;
  room.turnEndsAt = new Date(Date.now() + (drawTime + 8) * 1000); // +8 for word selection

  // Mark drawer on players array
  const safeIdx = getDrawerIndex(room);
  room.players = room.players.map((p: Player, idx: number) => ({
    ...p,
    isDrawer: idx === safeIdx,
  }));

  // Clear canvas for new turn
  io.to(room.roomId).emit('clearCanvas');

  // Sort players by score for display
  const sortedPlayers = [...room.players].sort((a: Player, b: Player) => (b.score || 0) - (a.score || 0));

  // Send word choices to drawer for selection (8 seconds) with current scores
  io.to(drawer.id).emit('selectWord', { 
    words: wordChoices,
    timeLimit: 8,
    scores: sortedPlayers.map((p: Player) => ({ name: p.name, score: p.score || 0, avatar: p.avatar }))
  });

  // Broadcast to others that drawer is selecting with current scores
  io.to(room.roomId).emit('drawerSelecting', {
    drawerId: drawer.id,
    timeLimit: 8,
    scores: sortedPlayers.map((p: Player) => ({ name: p.name, score: p.score || 0, avatar: p.avatar }))
  });

  // Wait for drawer to select or auto-select randomly after 8 seconds
  const wordSelectionTimeout = setTimeout(async () => {
    const freshRoom = await Room.findOne({ roomId: room.roomId });
    if (!freshRoom || freshRoom.currentWord) return; // Already selected

    // Auto-select random word if drawer didn't choose
    const randomIndex = Math.floor(Math.random() * wordChoices.length);
    const selectedWord = wordChoices[randomIndex] || 'default';
    freshRoom.currentWord = selectedWord;
    await freshRoom.save();

    startDrawingPhase(io, freshRoom, selectedWord, drawTime);
  }, 8000);

  // Store timeout reference
  wordSelectionTimeouts.set(room.roomId, wordSelectionTimeout);

  // Persist state
  room.markModified?.('players');
  void room.save();
}

// Start the actual drawing phase after word is selected
function startDrawingPhase(io: Server, room: any, word: string, drawTime: number) {
  const drawer = getDrawer(room);

  // Reset round points and revealed letters for new turn
  room.roundPoints = new Map();
  room.revealedLetters = [];

  // Initial hint with no letters revealed
  const hint = maskWord(word, room.revealedLetters);

  // Mark drawer on players array
  const safeIdx = getDrawerIndex(room);
  room.players = room.players.map((p: Player, idx: number) => ({
    ...p,
    isDrawer: idx === safeIdx,
  }));

  // Broadcast start-of-drawing state
  io.to(room.roomId).emit('gameStarted', {
    drawerId: drawer?.id ?? null,
    wordHint: hint,
    timeLeft: drawTime,
    round: room.round,
    maxRounds: room.maxRounds || 3,
  });

  // Send actual word to drawer only
  if (drawer?.id) {
    io.to(drawer.id).emit('yourWord', { word });
  }

  // Reset interval for this room - CRITICAL: Clear old timer first
  const prev = roomIntervals.get(room.roomId);
  if (prev) {
    console.log(`[DRAWER DEBUG] Clearing previous timer for room ${room.roomId}`);
    clearInterval(prev);
    roomIntervals.delete(room.roomId);
  }

  // Calculate hint reveal times
  const halfTime = Math.floor(drawTime / 2);
  const firstHintTime = halfTime;
  const secondHintTime = 15;

  // Track hint reveals using closure
  const hintState = {
    firstRevealed: false,
    secondRevealed: false,
  };

  const timer = setInterval(async () => {
    try {
      const r = await Room.findOne({ roomId: room.roomId });
      if (!r || !r.currentWord) return;

      const endsAt = r.turnEndsAt ? new Date(r.turnEndsAt).getTime() : 0;
      const now = Date.now();
      const secs = Math.max(0, Math.ceil((endsAt - now) / 1000));
    
    // Reveal first hint at half time
    if (!hintState.firstRevealed && secs <= firstHintTime && secs > secondHintTime) {
      hintState.firstRevealed = true;
      const newIndices = getRevealIndices(r.currentWord, 1, r.revealedLetters);
      r.revealedLetters = [...r.revealedLetters, ...newIndices];
      const newHint = maskWord(r.currentWord, r.revealedLetters);
      await r.save();
      
      io.to(room.roomId).emit('hintUpdate', { 
        wordHint: newHint
      });
    }

    // Reveal second hint at 15 seconds
    if (!hintState.secondRevealed && secs <= secondHintTime) {
      hintState.secondRevealed = true;
      const newIndices = getRevealIndices(r.currentWord, 1, r.revealedLetters);
      r.revealedLetters = [...r.revealedLetters, ...newIndices];
      const newHint = maskWord(r.currentWord, r.revealedLetters);
      await r.save();
      
      io.to(room.roomId).emit('hintUpdate', { 
        wordHint: newHint
      });
    }

    io.to(room.roomId).emit('tick', { timeLeft: secs });

    // End when timer hits zero or all guessers (except drawer) finished
    const everyoneGuessed = (r.correctGuessers?.length || 0) >= Math.max(0, (r.players.length - 1));

      if (secs <= 0 || everyoneGuessed) {
        console.log(`[DRAWER DEBUG] Timer ending for room ${room.roomId} - Time: ${secs}s, Everyone guessed: ${everyoneGuessed}`);
        clearInterval(timer);
        roomIntervals.delete(room.roomId);
        await endTurn(io, room.roomId);
      }
    } catch (error) {
      console.error('Timer error for room', room.roomId, error);
      // Continue running timer even if one iteration fails
    }
  }, ROOM_TICK_MS);

  roomIntervals.set(room.roomId, timer);

  // Persist state
  room.markModified?.('players');
  void room.save();
}

// ---------------------------------------------------------------------
// Socket connection setup function
// ---------------------------------------------------------------------
function setupSocketHandlers() {
io.on('connection', (socket: Socket) => {
  console.log('Player connected:', socket.id);

  // -------------------------------------------------
  // CREATE ROOM
  // -------------------------------------------------
  socket.on('createRoom', async ({ playerName, avatar, sessionId }) => {
    try {
      // Validate player name
      const cleanedName = validateMessage(playerName);
      if (!cleanedName) {
        socket.emit('error', { message: 'Invalid name: inappropriate content' });
        return;
      }

      const roomId = generateRoomId();
      const playerSessionId = sessionId || generateSessionId();
      
      const newRoom = new Room({
        roomId,
        players: [{ 
          id: socket.id, 
          sessionId: playerSessionId,
          name: cleanedName, 
          score: 0, 
          isDrawer: true, 
          avatar: avatar || [0, 0, 0, 0],
          isConnected: true,
          lastSeen: new Date()
        }],
        gameStarted: false,
        round: 1,
        drawerIndex: 0,
        maxRounds: 3,
        correctGuessers: [],
        chat: [],
        drawTime: 60,
        wordCount: 3,
        customWords: [],
        customWordProbability: 0,
        roundPoints: new Map(),
        revealedLetters: [],
        currentDrawing: [],
      });
      await newRoom.save();

      socket.join(roomId);
      socket.emit('roomCreated', { 
        roomId, 
        playerId: socket.id, 
        sessionId: playerSessionId,
        isHost: true 
      });
      
      // Ensure creator gets player list
      const playerUpdate = { players: newRoom.players };
      socket.emit('playerJoined', playerUpdate);
      
      console.log(`Room ${roomId} created by ${playerName}`);
    } catch (err) {
      socket.emit('error', { message: 'Failed to create room' });
    }
  });

  // -------------------------------------------------
  // UPDATE GAME SETTINGS (creator only)
  // -------------------------------------------------
  socket.on('updateSettings', async ({ roomId, settings }) => {
    try {
      const room = await Room.findOne({ roomId });
      if (!room) {
        socket.emit('error', { message: 'Room not found' });
        return;
      }

      const creatorId = room.players[0]?.id;
      if (!creatorId || creatorId !== socket.id) {
        socket.emit('error', { message: 'Only creator can change settings' });
        return;
      }

      if (room.gameStarted) {
        socket.emit('error', { message: 'Cannot change settings during game' });
        return;
      }

      // Update settings
      room.maxRounds = settings.rounds || 3;
      room.drawTime = Math.max(30, Math.min(180, settings.drawTime || 60));
      room.wordCount = Math.max(3, Math.min(5, settings.wordCount || 3));
      room.maxPlayers = Math.max(2, Math.min(15, settings.maxPlayers || 8));
      
      // Parse custom words
      const customWordsStr = settings.customWords || '';
      room.customWords = customWordsStr
        .split(',')
        .map((w: string) => w.trim().toLowerCase())
        .filter((w: string) => w.length > 0);
      
      room.customWordProbability = Math.max(0, Math.min(100, settings.customWordProbability || 0));

      await room.save();

      // Broadcast updated settings to all players
      io.to(roomId).emit('settingsUpdated', {
        rounds: room.maxRounds,
        drawTime: room.drawTime,
        wordCount: room.wordCount,
        customWords: room.customWords.join(', '),
        customWordProbability: room.customWordProbability,
        maxPlayers: room.maxPlayers,
      });

      console.log(`Settings updated for room ${roomId}`);
    } catch (err) {
      socket.emit('error', { message: 'Failed to update settings' });
    }
  });

  // -------------------------------------------------
  // JOIN ROOM
  // -------------------------------------------------
  socket.on('joinRoom', async ({ roomId, playerName, avatar, sessionId }) => {
    try {
      // Validate player name
      const cleanedName = validateMessage(playerName);
      if (!cleanedName) {
        socket.emit('error', { message: 'Invalid name: inappropriate content' });
        return;
      }

      const room = await Room.findOne({ roomId });
      if (!room) {
        socket.emit('error', { message: 'Room not found' });
        return;
      }
      if (room.players.length >= room.maxPlayers) {
        socket.emit('error', { message: 'Room is full' });
        return;
      }

      const playerSessionId = sessionId || generateSessionId();
      const alreadyIn = room.players.some((p: Player) => p.id === socket.id);
      if (!alreadyIn) {
        room.players.push({ 
          id: socket.id, 
          sessionId: playerSessionId,
          name: cleanedName, 
          score: 0, 
          avatar: avatar || [0, 0, 0, 0],
          isConnected: true,
          lastSeen: new Date()
        });
        await room.save();
      }

      socket.join(roomId);
      const isHost = room.players[0]?.sessionId === playerSessionId;
      socket.emit('roomJoined', { 
        roomId, 
        sessionId: playerSessionId,
        isHost 
      });

      // broadcast fresh player list with acknowledgment
      const playerUpdate = { players: room.players };
      io.to(roomId).emit('playerJoined', playerUpdate);
      
      // Also send directly to joining player as backup
      socket.emit('playerJoined', playerUpdate);
      
      console.log(`[SESSION] ${cleanedName} joined ${roomId} (${playerSessionId})`);
    } catch (err) {
      socket.emit('error', { message: 'Failed to join room' });
    }
  });

  // -------------------------------------------------
  // RECONNECTION HANDLER
  // -------------------------------------------------
  socket.on('reconnectToRoom', async ({ sessionId, roomId }) => {
    try {
      // Check if database is connected
      if (!dbConnected) {
        console.log(`[SESSION] Database not ready, rejecting reconnection for ${sessionId}`);
        socket.emit('error', { message: 'Server not ready, please try again' });
        return;
      }

      console.log(`[SESSION] Reconnection attempt - Session: ${sessionId}, Room: ${roomId}`);
      
      const room = await Room.findOne({ roomId });
      if (!room) {
        socket.emit('error', { message: 'Room not found' });
        return;
      }

      // Find player by session ID
      const player = room.players.find((p: Player) => p.sessionId === sessionId);
      if (!player) {
        socket.emit('error', { message: 'Session not found in room' });
        return;
      }

      // Update player's socket ID and connection status
      player.id = socket.id;
      player.isConnected = true;
      player.lastSeen = new Date();
      await room.save();

      // Join socket to room
      socket.join(roomId);

      // Send complete game state for synchronization
      const isHost = room.players[0]?.sessionId === sessionId;
      const currentDrawer = getDrawer(room);
      const timeLeft = room.turnEndsAt ? Math.max(0, Math.ceil((new Date(room.turnEndsAt).getTime() - Date.now()) / 1000)) : 0;

      socket.emit('reconnectionSuccess', {
        roomId,
        sessionId,
        isHost,
        player: player,
        gameState: {
          gameStarted: room.gameStarted,
          round: room.round,
          maxRounds: room.maxRounds,
          timeLeft: timeLeft,
          currentDrawer: currentDrawer,
          wordHint: room.gameStarted ? maskWord(room.currentWord || '', room.revealedLetters || []) : '',
          isYourTurn: player.sessionId === currentDrawer?.sessionId,
          currentDrawing: room.currentDrawing || [],
          players: room.players,
          recentChat: room.chat.slice(-10) || []
        }
      });

      // Notify other players about reconnection
      socket.to(roomId).emit('playerReconnected', { 
        playerName: player.name,
        playerId: player.sessionId
      });

      // Send updated player list
      io.to(roomId).emit('playerJoined', { players: room.players });

      console.log(`[SESSION] ${player.name} reconnected to ${roomId} successfully`);
    } catch (err) {
      console.error('[SESSION] Reconnection error:', err);
      socket.emit('error', { message: 'Failed to reconnect' });
    }
  });

  // -------------------------------------------------
  // WORD SELECTION (drawer only)
  // -------------------------------------------------
  socket.on('wordSelected', async ({ roomId, word }) => {
    try {
      const room = await Room.findOne({ roomId });
      if (!room || !room.gameStarted) return;

      const drawer = getDrawer(room);
      if (!drawer || drawer.id !== socket.id) return;

      // Clear word selection timeout
      const timeout = wordSelectionTimeouts.get(roomId);
      if (timeout) {
        clearTimeout(timeout);
        wordSelectionTimeouts.delete(roomId);
      }

      // Set the selected word
      room.currentWord = word;
      const drawTime = room.drawTime || 60;
      room.turnEndsAt = new Date(Date.now() + drawTime * 1000);
      await room.save();

      startDrawingPhase(io, room, word, drawTime);
    } catch (err) {
      socket.emit('error', { message: 'Failed to select word' });
    }
  });

  // -------------------------------------------------
  // START GAME (creator only, 2+ players)
  // -------------------------------------------------
  socket.on('startGame', async ({ roomId }) => {
    try {
      const room = await Room.findOne({ roomId });
      if (!room) {
        socket.emit('error', { message: 'Room not found' });
        return;
      }

      const creatorId = room.players[0]?.id;
      if (!creatorId || creatorId !== socket.id) {
        socket.emit('error', { message: 'Only creator can start' });
        return;
      }

      if (room.players.length < 2) {
        socket.emit('error', { message: 'Need 2+ players' });
        return;
      }

      if (room.gameStarted) return;

      room.round = 1;
      room.drawerIndex = 0;
      await room.save();

      console.log(`[DRAWER DEBUG] Game starting - Players: [${room.players.map((p, i) => `${i}:${p.name}`).join(', ')}], Initial drawerIndex: ${room.drawerIndex}`);
      
      startTurn(io, room);
    } catch (err) {
      socket.emit('error', { message: 'Failed to start game' });
    }
  });

  // -------------------------------------------------
  // DRAW & CLEAR
  // -------------------------------------------------
  socket.on('draw', async ({ roomId, lines }) => {
    // Rate limiting for drawing events
    if (!checkRateLimit(socket.id, drawingRateLimit, DRAWING_RATE_LIMIT, DRAWING_RATE_WINDOW)) {
      socket.emit('error', { message: 'Drawing too fast! Please slow down.' });
      return;
    }

    // Broadcast immediately for low latency
    socket.to(roomId).emit('draw', { lines });

    // Update room activity
    updateRoomActivity(roomId);
    
    // Save drawing state with retry logic to handle version conflicts
    setImmediate(async () => {
      let retries = 3;
      while (retries > 0) {
        try {
          await Room.updateOne(
            { roomId }, 
            { 
              currentDrawing: lines,
              lastActivity: new Date()
            }
          );
          break; // Success, exit retry loop
        } catch (error) {
          retries--;
          if (retries === 0) {
            console.error('[CANVAS] Failed to save drawing state after retries:', error);
          } else {
            // Wait a bit before retrying
            await new Promise(resolve => setTimeout(resolve, 10));
          }
        }
      }
    });
  });

  socket.on('clearCanvas', async ({ roomId }) => {
    // Clear saved drawing state with retry logic
    let retries = 3;
    while (retries > 0) {
      try {
        await Room.updateOne(
          { roomId }, 
          { 
            currentDrawing: [],
            lastActivity: new Date()
          }
        );
        break; // Success, exit retry loop
      } catch (error) {
        retries--;
        if (retries === 0) {
          console.error('[CANVAS] Failed to clear drawing state after retries:', error);
        } else {
          // Wait a bit before retrying
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      }
    }
    
    socket.to(roomId).emit('clearCanvas');
  });

  // -------------------------------------------------
  // CHAT & GUESS
  // -------------------------------------------------
  socket.on('chat', async ({ roomId, msg, name }) => {
    if (!msg?.trim()) return;

    // Rate limiting for chat messages
    if (!checkRateLimit(socket.id, chatRateLimit, CHAT_RATE_LIMIT, CHAT_RATE_WINDOW)) {
      socket.emit('error', { message: 'Sending messages too fast! Please wait a moment.' });
      return;
    }
    
    // Validate and filter message
    const cleanedMsg = validateMessage(msg);
    if (!cleanedMsg) {
      socket.emit('error', { message: 'Message blocked: inappropriate content or spam' });
      return;
    }

    // Broadcast immediately for fast user feedback
    io.to(roomId).emit('chat', { id: socket.id, name, msg: cleanedMsg });

    // Update room activity and save chat asynchronously
    updateRoomActivity(roomId);
    setImmediate(async () => {
      try {
        await Room.updateOne(
          { roomId },
          { 
            $push: { 
              chat: { 
                $each: [{ id: socket.id, name, msg: cleanedMsg, ts: new Date() }],
                $slice: -50 // Keep only last 50 messages
              }
            },
            lastActivity: new Date()
          }
        );
      } catch (error) {
        console.error('[CHAT] Failed to save message:', error);
      }
    });
  });

  socket.on('guess', async ({ roomId, guess, name }) => {
    // Fast initial validation without database lookup
    if (!guess?.trim()) return;
    
    const cleanedGuess = validateMessage(guess);
    if (!cleanedGuess) {
      socket.emit('error', { message: 'Guess blocked: inappropriate content' });
      return;
    }

    const g = cleanedGuess.trim().toLowerCase().replace(/\s+/g, '');
    if (!g) return;

    // Get room data
    const room = await Room.findOne({ roomId });
    if (!room || !room.currentWord || !room.gameStarted) return;

    const ans = room.currentWord.toLowerCase();

    // Check if exact match
    if (g === ans) {
      const player = room.players.find((p: Player) => p.id === socket.id);
      if (!player) return;
      
      const drawer = getDrawer(room);
      const isDrawer = player.sessionId === drawer?.sessionId;
      const already = room.correctGuessers?.includes(player.sessionId);
      if (isDrawer || already) return;

      // Calculate points based on time remaining
      const endsAt = room.turnEndsAt ? new Date(room.turnEndsAt).getTime() : 0;
      const timeRemaining = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
      const points = calculatePoints(timeRemaining, TURN_SECONDS);

      // Broadcast correct guess IMMEDIATELY for fast feedback
      io.to(roomId).emit('correctGuess', {
        playerId: player.sessionId,
        name,
        points,
        total: (player.score || 0) + points,
      });

      // Update database asynchronously
      setImmediate(async () => {
        try {
          // Use atomic operations to prevent conflicts
          const updateResult = await Room.updateOne(
            { 
              roomId,
              'players.sessionId': player.sessionId,
              correctGuessers: { $ne: player.sessionId } // Ensure not already guessed
            },
            {
              $addToSet: { correctGuessers: player.sessionId },
              $inc: { [`players.$.score`]: points },
              $set: { 
                [`roundPoints.${player.sessionId}`]: points,
                lastActivity: new Date()
              }
            }
          );

          if (updateResult.modifiedCount > 0) {
            // Check if everyone guessed for early end
            const updatedRoom = await Room.findOne({ roomId });
            if (updatedRoom) {
              const drawer = getDrawer(updatedRoom);
              const connectedNonDrawers = updatedRoom.players.filter(p => 
                p.isConnected && p.sessionId !== drawer?.sessionId
              ).length;
              
              if ((updatedRoom.correctGuessers?.length || 0) >= connectedNonDrawers) {
                await endTurn(io, roomId);
              }
            }
          }
        } catch (error) {
          console.error('[GUESS] Failed to save correct guess:', error);
        }
      });
      
      return; // Exit early for correct guess
    }

    // Check for "close" guess using edit distance
    const distance = getEditDistance(g, ans);
    
    // Only check closeness if word is 3+ letters and distance is exactly 1
    if (ans.length >= 3 && distance === 1) {
      // Send private "close" message only to this player
      socket.emit('closeGuess', { 
        message: 'You are very close!' 
      });
    }
    
    // Echo wrong guess as chat message immediately (use cleaned version)
    io.to(roomId).emit('chat', { id: socket.id, name, msg: cleanedGuess });
    
    // Save wrong guess to chat history asynchronously
    updateRoomActivity(roomId);
    setImmediate(async () => {
      try {
        await Room.updateOne(
          { roomId },
          { 
            $push: { 
              chat: { 
                $each: [{ id: socket.id, name, msg: cleanedGuess, ts: new Date() }],
                $slice: -50 // Keep only last 50 messages
              }
            },
            lastActivity: new Date()
          }
        );
      } catch (error) {
        console.error('[GUESS] Failed to save wrong guess:', error);
      }
    });
  });

  // -------------------------------------------------
  // DISCONNECT – clean up player & possibly end game
  // -------------------------------------------------
  socket.on('disconnect', async () => {
    console.log('[SESSION] Player disconnected:', socket.id);

    // Clean up rate limiting data for this socket
    drawingRateLimit.delete(socket.id);
    chatRateLimit.delete(socket.id);

    // Find all rooms the socket was in (usually one)
    const rooms = Array.from(socket.rooms).filter(r => r !== socket.id);
    for (const roomId of rooms) {
      const room = await Room.findOne({ roomId });
      if (!room) continue;

      const disconnectingPlayer = room.players.find(p => p.id === socket.id);
      if (!disconnectingPlayer) continue;
      
      console.log(`[SESSION] Player ${disconnectingPlayer.name} (${disconnectingPlayer.sessionId}) disconnected from ${roomId}`);

      // Mark player as disconnected instead of removing them
      disconnectingPlayer.isConnected = false;
      disconnectingPlayer.lastSeen = new Date();

      // Check if all players are disconnected
      const connectedPlayers = room.players.filter(p => p.isConnected);
      
      if (connectedPlayers.length === 0) {
        // All players disconnected - clean up room after delay
        console.log(`[SESSION] All players disconnected from ${roomId}, scheduling cleanup`);
        setTimeout(async () => {
          const freshRoom = await Room.findOne({ roomId });
          if (freshRoom && freshRoom.players.every(p => !p.isConnected)) {
            await Room.deleteOne({ roomId });
            const t = roomIntervals.get(roomId);
            if (t) clearInterval(t);
            roomIntervals.delete(roomId);
            const wst = wordSelectionTimeouts.get(roomId);
            if (wst) clearTimeout(wst);
            wordSelectionTimeouts.delete(roomId);
            endTurnInProgress.delete(roomId);
            console.log(`[SESSION] Room ${roomId} deleted - all players offline`);
          }
        }, 300000); // 5 minutes delay
      }

      await room.save();

      // Notify other players about disconnection
      socket.to(roomId).emit('playerDisconnected', { 
        playerName: disconnectingPlayer.name,
        playerId: disconnectingPlayer.sessionId
      });

      // Send updated player list
      io.to(roomId).emit('playerJoined', { players: room.players });
    }
  });
});
} // End of setupSocketHandlers function

// ---------------------------------------------------------------------
// Server start
// ---------------------------------------------------------------------
const PORT = process.env.PORT || 4000;

// Helper function to update room activity
async function updateRoomActivity(roomId: string) {
  try {
    await Room.updateOne({ roomId }, { lastActivity: new Date() });
  } catch (error) {
    console.error('[ACTIVITY] Failed to update room activity:', error);
  }
}

// Initialize database and then start server
initializeServer();

// Cleanup rate limiting data periodically
function cleanupRateLimits() {
  const now = Date.now();
  
  // Clean expired drawing rate limits
  for (const [socketId, limit] of drawingRateLimit.entries()) {
    if (now > limit.resetTime) {
      drawingRateLimit.delete(socketId);
    }
  }
  
  // Clean expired chat rate limits
  for (const [socketId, limit] of chatRateLimit.entries()) {
    if (now > limit.resetTime) {
      chatRateLimit.delete(socketId);
    }
  }
  
  console.log(`[CLEANUP] Rate limits cleaned. Drawing: ${drawingRateLimit.size}, Chat: ${chatRateLimit.size}`);
}

// Start cleanup intervals
setInterval(cleanupInactiveRooms, ROOM_CLEANUP_INTERVAL);
setInterval(cleanupRateLimits, 5 * 60 * 1000); // Clean rate limits every 5 minutes
console.log('[CLEANUP] Cleanup services started');

server.listen(PORT, () => {
  console.log(`drawzzl backend running on port ${PORT}`);
});
