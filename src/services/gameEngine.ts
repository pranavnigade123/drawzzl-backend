import { Server } from 'socket.io';
import { Room } from '../models/Room.js';
import type { Player } from '../types/index.js';
import { gameConfig, WORDS } from '../config/game.js';
import {
  getDrawer,
  getDrawerIndex,
  hasPlayers,
  maskWord,
  generateWordChoices,
  generateProgressiveHint,
} from '../utils/helpers.js';

const { ROOM_TICK_MS, TURN_SECONDS } = gameConfig;

// Track per-room ticking intervals
export const roomIntervals = new Map<string, NodeJS.Timeout>();

export async function endTurn(io: Server, roomId: string) {
  try {
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

      const sorted = [...room.players].sort(
        (a, b) => (b.score || 0) - (a.score || 0)
      );
      io.to(roomId).emit('gameOver', { players: sorted });
      room.gameStarted = false;
      room.currentWord = undefined;
      room.correctGuessers = [];

      // Use retry logic for save
      await saveWithRetry(room, roomId);
      return;
    }

    // Intermission then next turn
    room.currentWord = undefined;
    room.correctGuessers = [];
    room.revealedPositions = [];

    // Use retry logic for save
    await saveWithRetry(room, roomId);

    setTimeout(async () => {
      const fresh = await Room.findOne({ roomId });
      if (fresh) startTurn(io, fresh);
    }, 2000);
  } catch (err) {
    console.error('Error in endTurn:', err);
  }
}

export function startTurn(io: Server, room: any) {
  try {
    if (!hasPlayers(room)) return;

    // Mark drawer on players array
    const safeIdx = getDrawerIndex(room);
    room.players = room.players.map((p: Player, idx: number) => ({
      ...p,
      isDrawer: idx === safeIdx,
    }));

    const drawer = getDrawer(room);

    // Generate 3 random word choices
    const wordChoices = generateWordChoices(3);

    // Send word choices to drawer
    if (drawer?.id) {
      io.to(drawer.id).emit('chooseWord', {
        words: wordChoices,
        timeLimit: 10, // 10 seconds to choose
      });
    }

    // Set a timeout for auto-selection if drawer doesn't choose
    setTimeout(async () => {
      try {
        // Check if word was already chosen
        const freshRoom = await Room.findOne({ roomId: room.roomId });
        if (freshRoom && !freshRoom.currentWord && freshRoom.gameStarted) {
          // Auto-select first word if no choice made
          const autoWord = wordChoices[0];
          startTurnWithWord(io, freshRoom, autoWord);
        }
      } catch (err) {
        console.error('Error in auto-select timeout:', err);
      }
    }, 10000);

    room.gameStarted = true;
    room.correctGuessers = [];

    // Save the room state
    room.markModified?.('players');
    void room.save();
  } catch (err) {
    console.error('Error in startTurn:', err);
    throw err;
  }
}

export function startTurnWithWord(io: Server, room: any, word: string) {
  if (!hasPlayers(room)) return;

  room.currentWord = word;
  room.turnEndsAt = new Date(Date.now() + TURN_SECONDS * 1000);
  room.revealedPositions = []; // Reset revealed positions for new turn

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

    // Generate progressive hint with persistent positions
    let progressiveHint = maskWord(r.currentWord || '');
    if (r.currentWord) {
      const result = generateProgressiveHint(
        r.currentWord,
        secs,
        TURN_SECONDS,
        r.revealedPositions || []
      );
      progressiveHint = result.hint;

      // Update revealed positions in database if changed
      if (
        JSON.stringify(result.revealedPositions) !==
        JSON.stringify(r.revealedPositions)
      ) {
        r.revealedPositions = result.revealedPositions;
        await r.save().catch((err) => console.error('Error saving hint:', err));
      }
    }

    io.to(room.roomId).emit('tick', {
      timeLeft: secs,
      wordHint: progressiveHint,
    });

    // End when timer hits zero or all guessers (except drawer) finished
    const everyoneGuessed =
      (r.correctGuessers?.length || 0) >= Math.max(0, r.players.length - 1);

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

// Helper function for retry logic
async function saveWithRetry(room: any, roomId: string) {
  let retries = 3;
  while (retries > 0) {
    try {
      await room.save();
      break;
    } catch (err: any) {
      if (err.name === 'VersionError' && retries > 1) {
        retries--;
        const fresh = await Room.findOne({ roomId });
        if (!fresh) return;
        Object.assign(room, fresh);
      } else {
        console.error('Error saving room:', err);
        break;
      }
    }
  }
}
