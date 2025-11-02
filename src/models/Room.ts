// src/models/Room.ts
import mongoose, { Document, Schema } from 'mongoose';

export interface Player {
  id: string;
  name: string;
  score: number;
  isDrawer?: boolean;
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

  createdAt: Date;
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
        id: { type: String, required: true },
        name: { type: String, required: true },
        score: { type: Number, default: 0 },
        isDrawer: { type: Boolean, default: false },
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

    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

export const Room = mongoose.model<IRoom>('Room', RoomSchema);
