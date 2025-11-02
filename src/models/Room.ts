import { Schema, model, Document } from 'mongoose';

export interface Player {
  id: string;
  name: string;
  score: number;
  isDrawer?: boolean;
}

export interface IRoom extends Document {
  roomId: string;
  players: Player[];
  maxPlayers: number;
  round: number;
  currentWord?: string;
  drawerIndex: number;
  createdAt: Date;
}

const roomSchema = new Schema<IRoom>({
  roomId: { type: String, required: true, unique: true },
  players: [
    {
      id: String,
      name: String,
      score: { type: Number, default: 0 },
      isDrawer: { type: Boolean, default: false },
    },
  ],
  maxPlayers: { type: Number, default: 8 },
  round: { type: Number, default: 1 },
  currentWord: String,
  drawerIndex: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
});

export const Room = model<IRoom>('Room', roomSchema);
