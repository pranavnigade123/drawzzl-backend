// Profanity filter for chat messages
const PROFANITY_LIST = [
  // Common profanity (add more as needed)
  'fuck', 'shit', 'bitch', 'ass', 'damn', 'hell', 'crap', 'piss',
  'dick', 'cock', 'pussy', 'cunt', 'bastard', 'whore', 'slut',
  'fag', 'nigger', 'nigga', 'retard', 'rape', 'sex', 'porn',
  // Variations and leetspeak
  'f*ck', 'sh*t', 'b*tch', 'a$$', 'fuk', 'fck', 'sht', 'btch',
  'azz', 'arse', 'asshole', 'a**hole', 'dumbass', 'jackass',
  // Offensive terms
  'idiot', 'stupid', 'moron', 'dumb', 'loser', 'noob', 'trash',
  'kill yourself', 'kys', 'die', 'cancer', 'aids',
];

/**
 * Check if a message contains profanity
 */
export function containsProfanity(message: string): boolean {
  const lowerMessage = message.toLowerCase();
  
  // Check for exact matches and word boundaries
  for (const word of PROFANITY_LIST) {
    // Create regex with word boundaries to avoid false positives
    const regex = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (regex.test(lowerMessage)) {
      return true;
    }
    
    // Also check for the word with spaces or special chars around it
    if (lowerMessage.includes(word)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Filter profanity from a message by replacing with asterisks
 */
export function filterProfanity(message: string): string {
  let filtered = message;
  
  for (const word of PROFANITY_LIST) {
    const regex = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
    filtered = filtered.replace(regex, (match) => '*'.repeat(match.length));
  }
  
  return filtered;
}

/**
 * Validate and clean a message
 * Returns null if message should be blocked, otherwise returns cleaned message
 */
export function validateMessage(message: string): string | null {
  if (!message || message.trim().length === 0) {
    return null;
  }
  
  const trimmed = message.trim();
  
  // Check length
  if (trimmed.length > 200) {
    return null;
  }
  
  // Check for spam (repeated characters)
  if (/(.)\1{10,}/.test(trimmed)) {
    return null;
  }
  
  // Filter profanity
  if (containsProfanity(trimmed)) {
    return filterProfanity(trimmed);
  }
  
  return trimmed;
}
