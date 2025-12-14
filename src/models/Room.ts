// src/models/Room.ts
import mongoose, { Document, Schema } from 'mongoose';

export interface Player {
  id: string;              // Socket ID (changes on reconnect)
  sessionId: string;       // Persistent session ID (never changes)
  name: string;
  score: number;
  isDrawer?: boolean;
  avatar?: number[];       // [colorIdx, eyeIdx, mouthIdx, accessoryIdx]
  isConnected: boolean;    // Connection status
  lastSeen: Date;          // Last activity timestamp
}

export interface ChatItem {
  id: string;
  name: string;
  msg: string;
  ts: Date;
}

/**
 * Room document
 */
export interface IRoom extends Document {
  roomId: string;
  players: Player[];
  maxPlayers: number;

  // gameplay flags/state
  gameStarted: boolean;
  currentWord: string | undefined;
  round: number;
  drawerIndex: number;

  // new fields for turn engine
  maxRounds: number;                 // total rounds (default: 3)
  turnEndsAt?: Date;                 // server-authoritative turn end
  correctGuessers: string[];         // socket ids of correct guessers for this turn
  chat: ChatItem[];                  // minimal chat feed

  // game settings
  drawTime: number;                  // seconds per turn (30-180)
  wordCount: number;                 // number of word choices (3-5)
  customWords: string[];             // custom words list
  customWordProbability: number;     // 0-100 percentage

  // round tracking
  roundPoints: Map<string, number>;  // sessionId -> points earned this round
  revealedLetters: number[];         // indices of revealed letters

  // canvas persistence
  currentDrawing: any[];             // Current drawing data for reconnection

  createdAt: Date;
  lastActivity: Date;                // Last activity in room (for cleanup)
}

const ChatSchema = new Schema<ChatItem>(
  {
    id: { type: String, required: true },
    name: { type: String, required: true },
    msg: { type: String, required: true },
    ts: { type: Date, required: true },
  },
  { _id: false }
);

const RoomSchema = new Schema<IRoom>(
  {
    roomId: { type: String, required: true, unique: true },
    players: [
      {
        id: { type: String, required: true },           // Socket ID
        sessionId: { type: String, required: true },    // Persistent session ID
        name: { type: String, required: true },
        score: { type: Number, default: 0 },
        isDrawer: { type: Boolean, default: false },
        avatar: { type: [Number], default: [0, 0, 0, 0] },
        isConnected: { type: Boolean, default: true },
        lastSeen: { type: Date, default: Date.now },
      },
    ],
    maxPlayers: { type: Number, default: 8 },

    gameStarted: { type: Boolean, default: false },
    currentWord: { type: String },               // optional/undefined allowed
    round: { type: Number, default: 1 },
    drawerIndex: { type: Number, default: 0 },

    // new
    maxRounds: { type: Number, default: 3 },
    turnEndsAt: { type: Date },
    correctGuessers: { type: [String], default: [] },
    chat: { type: [ChatSchema], default: [] },

    // game settings
    drawTime: { type: Number, default: 60 },
    wordCount: { type: Number, default: 3 },
    customWords: { type: [String], default: [] },
    customWordProbability: { type: Number, default: 0 },

    // round tracking
    roundPoints: { type: Map, of: Number, default: new Map() },
    revealedLetters: { type: [Number], default: [] },

    // canvas persistence
    currentDrawing: { type: Array, default: [] },

    createdAt: { type: Date, default: Date.now },
    lastActivity: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

export const Room = mongoose.model<IRoom>('Room', RoomSchema);
