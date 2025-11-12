export type Player = {
  id: string;
  name: string;
  score: number;
  isDrawer?: boolean;
};

export type GameConfig = {
  ROOM_TICK_MS: number;
  TURN_SECONDS: number;
  MAX_ROUNDS: number;
};
