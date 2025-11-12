import type { Player } from '../types/index.js';

export function generateRoomId(): string {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

export function maskWord(word: string): string {
  return '_ '.repeat(word.length).trim();
}

export function getDrawerIndex(room: any): number {
  const len = Array.isArray(room?.players) ? room.players.length : 0;
  if (len === 0) return 0;
  const idx = typeof room?.drawerIndex === 'number' ? room.drawerIndex : 0;
  return Math.min(Math.max(0, idx), len - 1);
}

export function getDrawer(room: any): Player | undefined {
  const len = Array.isArray(room?.players) ? room.players.length : 0;
  if (len === 0) return undefined;
  return room.players[getDrawerIndex(room)];
}

export function hasPlayers(room: any): boolean {
  return Array.isArray(room?.players) && room.players.length > 0;
}

export function sanitizeInput(input: string, maxLength: number): string {
  return (input || '').trim().slice(0, maxLength);
}
