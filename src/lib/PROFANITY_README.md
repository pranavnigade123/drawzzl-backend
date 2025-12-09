# Profanity Filter

This module provides chat moderation by filtering inappropriate language from messages.

## Features

- **Profanity Detection**: Checks messages for vulgar/offensive words
- **Auto-Filtering**: Replaces profanity with asterisks (****)
- **Spam Prevention**: Blocks messages with excessive repeated characters
- **Length Validation**: Limits messages to 200 characters
- **Name Validation**: Filters inappropriate player names

## How It Works

1. **Message Validation**: All chat messages and guesses are validated
2. **Profanity Check**: Scans for words in the profanity list
3. **Filtering**: Replaces offensive words with asterisks
4. **Blocking**: Rejects messages that are spam or too long

## Adding Words to Filter

Edit `profanityFilter.ts` and add words to the `PROFANITY_LIST` array:

```typescript
const PROFANITY_LIST = [
  'badword1',
  'badword2',
  // Add more words here
];
```

## Usage

The filter is automatically applied to:
- Chat messages
- Player guesses (wrong answers shown in chat)
- Player names (on room creation/join)

## Error Messages

When content is blocked, users see:
- "Message blocked: inappropriate content or spam"
- "Guess blocked: inappropriate content"
- "Invalid name: inappropriate content"

## Customization

You can adjust the filter behavior in `profanityFilter.ts`:
- Modify `PROFANITY_LIST` to add/remove words
- Change max message length (default: 200 chars)
- Adjust spam detection pattern
