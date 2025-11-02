// src/models/Room.ts
import mongoose, { Document, Schema } from 'mongoose';

export interface Player {
  id: string;
  name: string;
  score: number;
  isDrawer?: boolean;
}

/* --------------------------------------------------------------
   IRoom – the document interface
   currentWord is optional → string | undefined
   -------------------------------------------------------------- */
export interface IRoom extends Document {
  roomId: string;
  players: Player[];
  maxPlayers: number;
  gameStarted: boolean;
  currentWord: string | undefined;   // <-- changed: explicitly allow undefined
  round?: number;
  drawerIndex?: number;
  createdAt: Date;
}

/* --------------------------------------------------------------
   Schema – Mongoose must match the interface exactly
   -------------------------------------------------------------- */
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
    currentWord: { type: String },           // no `required` → undefined allowed
    round: { type: Number, default: 1 },
    drawerIndex: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

export const Room = mongoose.model<IRoom>('Room', RoomSchema);