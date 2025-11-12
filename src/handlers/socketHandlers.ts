import { Server, Socket } from 'socket.io';
import { Room } from '../models/Room.js';
import type { Player } from '../types/index.js';
import { generateRoomId, getDrawer, sanitizeInput } from '../utils/helpers.js';
import { endTurn, roomIntervals, startTurn } from '../services/gameEngine.js';

export function registerSocketHandlers(io: Server, socket: Socket) {
  console.log('Player connected:', socket.id);

  // CREATE ROOM
  socket.on('createRoom', async ({ playerName }) => {
    try {
      const sanitizedName = sanitizeInput(playerName, 16);
      if (!sanitizedName) {
        return socket.emit('error', { message: 'Invalid player name' });
      }

      const roomId = generateRoomId();
      const newRoom = new Room({
        roomId,
        players: [
          { id: socket.id, name: sanitizedName, score: 0, isDrawer: true },
        ],
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
      console.log(`Room ${roomId} created by ${sanitizedName}`);
    } catch (err) {
      socket.emit('error', { message: 'Failed to create room' });
    }
  });

  // JOIN ROOM
  socket.on('joinRoom', async ({ roomId, playerName }) => {
    try {
      const sanitizedRoomId = sanitizeInput(roomId, 6).toUpperCase();
      const sanitizedName = sanitizeInput(playerName, 16);

      if (!sanitizedRoomId || !sanitizedName) {
        return socket.emit('error', { message: 'Invalid room code or name' });
      }

      const room = await Room.findOne({ roomId: sanitizedRoomId });
      if (!room) return socket.emit('error', { message: 'Room not found' });
      if (room.players.length >= room.maxPlayers)
        return socket.emit('error', { message: 'Room is full' });

      const alreadyIn = room.players.some((p: Player) => p.id === socket.id);
      if (!alreadyIn) {
        room.players.push({ id: socket.id, name: sanitizedName, score: 0 });
        await room.save();
      }

      socket.join(sanitizedRoomId);
      socket.emit('roomJoined', { roomId: sanitizedRoomId });

      io.to(sanitizedRoomId).emit('playerJoined', { players: room.players });
      console.log(`${sanitizedName} joined ${sanitizedRoomId}`);
    } catch (err) {
      socket.emit('error', { message: 'Failed to join room' });
    }
  });

  // START GAME
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

  // DRAW
  socket.on('draw', ({ roomId, lines }) => {
    socket.to(roomId).emit('draw', { lines });
  });

  // CLEAR CANVAS
  socket.on('clearCanvas', ({ roomId }) => {
    socket.to(roomId).emit('clearCanvas');
  });

  // CHAT
  socket.on('chat', async ({ roomId, msg, name }) => {
    const room = await Room.findOne({ roomId });
    if (!room) return;

    const sanitizedMsg = sanitizeInput(msg, 200);
    const sanitizedName = sanitizeInput(name, 16);

    if (!sanitizedMsg) return;

    room.chat = Array.isArray(room.chat) ? room.chat : [];
    room.chat.push({
      id: socket.id,
      name: sanitizedName,
      msg: sanitizedMsg,
      ts: new Date(),
    });
    await room.save();
    io.to(roomId).emit('chat', {
      id: socket.id,
      name: sanitizedName,
      msg: sanitizedMsg,
    });
  });

  // GUESS
  socket.on('guess', async ({ roomId, guess, name }) => {
    try {
      const room = await Room.findOne({ roomId });
      if (!room || !room.currentWord || !room.gameStarted) return;

      const sanitizedGuess = sanitizeInput(guess, 50);
      const sanitizedName = sanitizeInput(name, 16);

      if (!sanitizedGuess) return;

      const g = sanitizedGuess.toLowerCase();
      const ans = room.currentWord.toLowerCase();

      if (g === ans) {
        const isDrawer = socket.id === getDrawer(room)?.id;
        const already = room.correctGuessers?.includes(socket.id);
        if (isDrawer || already) return;

        room.correctGuessers = Array.isArray(room.correctGuessers)
          ? room.correctGuessers
          : [];
        room.correctGuessers.push(socket.id);

        // Scoring: 10 + timeLeft
        const endsAt = room.turnEndsAt
          ? new Date(room.turnEndsAt).getTime()
          : 0;
        const secs = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
        const points = 10 + secs;

        const player = room.players.find((p: Player) => p.id === socket.id);
        if (player) player.score = (player.score || 0) + points;

        // Retry save with version error handling
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

              if (!fresh.correctGuessers?.includes(socket.id)) {
                fresh.correctGuessers = Array.isArray(fresh.correctGuessers)
                  ? fresh.correctGuessers
                  : [];
                fresh.correctGuessers.push(socket.id);
                const freshPlayer = fresh.players.find(
                  (p: Player) => p.id === socket.id
                );
                if (freshPlayer)
                  freshPlayer.score = (freshPlayer.score || 0) + points;
                Object.assign(room, fresh);
              } else {
                return;
              }
            } else {
              console.error('Error saving guess:', err);
              return;
            }
          }
        }

        io.to(roomId).emit('correctGuess', {
          playerId: socket.id,
          name: sanitizedName,
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
        io.to(roomId).emit('chat', {
          id: socket.id,
          name: sanitizedName,
          msg: sanitizedGuess,
        });
      }
    } catch (err) {
      console.error('Error in guess handler:', err);
    }
  });

  // DISCONNECT
  socket.on('disconnect', async () => {
    console.log('Player disconnected:', socket.id);

    const rooms = Array.from(socket.rooms).filter((r) => r !== socket.id);
    for (const roomId of rooms) {
      const room = await Room.findOne({ roomId });
      if (!room) continue;

      const wasDrawer = getDrawer(room)?.id === socket.id;
      const wasGameStarted = room.gameStarted;

      room.players = room.players.filter((p: Player) => p.id !== socket.id);

      // If room empty → delete
      if (room.players.length === 0) {
        await Room.deleteOne({ roomId });
        const t = roomIntervals.get(roomId);
        if (t) clearInterval(t);
        roomIntervals.delete(roomId);
        console.log(`Room ${roomId} deleted – empty`);
        continue;
      }

      // If only 1 player left and game was running → end game
      if (room.players.length === 1 && wasGameStarted) {
        const t = roomIntervals.get(roomId);
        if (t) clearInterval(t);
        roomIntervals.delete(roomId);

        room.gameStarted = false;
        room.currentWord = undefined;
        room.correctGuessers = [];
        await room.save();

        io.to(roomId).emit('gameOver', { players: room.players });
        console.log(`Room ${roomId} game ended – only 1 player left`);
        continue;
      }

      // If drawer disconnected mid-game → end turn early
      if (wasDrawer && wasGameStarted) {
        if ((room.drawerIndex ?? 0) >= room.players.length) {
          room.drawerIndex = 0;
        }
        await room.save();

        console.log(`Drawer disconnected from ${roomId} – ending turn`);
        await endTurn(io, roomId);
      } else {
        if ((room.drawerIndex ?? 0) >= room.players.length) {
          room.drawerIndex = 0;
        }
        await room.save();
      }

      io.to(roomId).emit('playerJoined', { players: room.players });
    }
  });
}
