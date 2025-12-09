import wordsData from '../data/words.json' with { type: 'json' };

// Flatten all category words into a single array
export const WORDS: string[] = Object.values(wordsData.categories).flat();

// Export categories for potential future use
export const WORD_CATEGORIES = wordsData.categories;

// Export difficulty levels
export const WORD_DIFFICULTY = wordsData.difficulty;

// Helper function to get words by category
export function getWordsByCategory(category: keyof typeof wordsData.categories): string[] {
  return wordsData.categories[category] || [];
}

// Helper function to get words by difficulty
export function getWordsByDifficulty(difficulty: 'easy' | 'medium' | 'hard'): string[] {
  return wordsData.difficulty[difficulty] || [];
}

// Helper function to get random word from specific category
export function getRandomWordFromCategory(category: keyof typeof wordsData.categories): string {
  const words = getWordsByCategory(category);
  return words[Math.floor(Math.random() * words.length)] || 'default';
}

// Helper function to get random word by difficulty
export function getRandomWordByDifficulty(difficulty: 'easy' | 'medium' | 'hard'): string {
  const words = getWordsByDifficulty(difficulty);
  return words[Math.floor(Math.random() * words.length)] || 'default';
}