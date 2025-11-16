import type { Player } from '../types/index.js';

export function generateRoomId(): string {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

export function maskWord(word: string): string {
  return '_ '.repeat(word.length).trim();
}

export function generateProgressiveHint(
  word: string,
  timeLeft: number,
  totalTime: number,
  currentRevealedPositions: number[]
): { hint: string; revealedPositions: number[] } {
  const wordLength = word.length;
  const timeProgress = 1 - timeLeft / totalTime; // 0 to 1

  // Calculate how many letters should be revealed based on time
  let targetLettersToReveal = 0;

  if (timeProgress >= 0.75) {
    // Last 25% of time - reveal 50% of letters
    targetLettersToReveal = Math.ceil(wordLength * 0.5);
  } else if (timeProgress >= 0.5) {
    // Middle 25% of time - reveal 30% of letters
    targetLettersToReveal = Math.ceil(wordLength * 0.3);
  } else if (timeProgress >= 0.25) {
    // First 25% of time - reveal 1 letter
    targetLettersToReveal = Math.min(1, wordLength);
  }

  // Use existing revealed positions
  const revealedSet = new Set(currentRevealedPositions);

  // Add more positions if needed
  if (revealedSet.size < targetLettersToReveal) {
    const availablePositions = Array.from({ length: wordLength }, (_, i) => i)
      .filter((i) => !revealedSet.has(i));

    // Shuffle available positions
    for (let i = availablePositions.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [availablePositions[i], availablePositions[j]] = [
        availablePositions[j],
        availablePositions[i],
      ];
    }

    // Add new positions
    const needed = targetLettersToReveal - revealedSet.size;
    for (let i = 0; i < needed && i < availablePositions.length; i++) {
      revealedSet.add(availablePositions[i]);
    }
  }

  // Build hint string
  const hint = word
    .split('')
    .map((char, idx) => (revealedSet.has(idx) ? char : '_'))
    .join(' ');

  return {
    hint,
    revealedPositions: Array.from(revealedSet),
  };
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

export function generateWordChoices(count: number): string[] {
  // Import WORDS dynamically to avoid circular dependency
  const choices: string[] = [];
  const usedIndices = new Set<number>();
  
  // Temporary word list - will be replaced with proper import
  const wordList = [
    'apple', 'house', 'pizza', 'cat', 'dog', 'tree', 'sun', 'moon',
    'star', 'fish', 'car', 'plane', 'boat', 'flower', 'mountain',
    'beach', 'robot', 'rocket', 'cake', 'icecream'
  ];

  while (choices.length < count && choices.length < wordList.length) {
    const randomIndex = Math.floor(Math.random() * wordList.length);
    if (!usedIndices.has(randomIndex)) {
      usedIndices.add(randomIndex);
      choices.push(wordList[randomIndex]);
    }
  }

  return choices;
}
