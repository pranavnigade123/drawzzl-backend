# Drawzzl Word Dictionary

This directory contains the word dictionary used in the Drawzzl game.

## File Structure

- `words.json` - Main word dictionary with categories and difficulty levels

## How to Add More Words

### 1. Edit words.json

Open `words.json` and add words to the appropriate category:

```json
{
  "categories": {
    "animals": ["cat", "dog", "YOUR_NEW_ANIMAL"],
    "food": ["pizza", "burger", "YOUR_NEW_FOOD"],
    ...
  }
}
```

### 2. Available Categories

- **animals** - All types of animals (pets, wild, sea creatures, insects)
- **food** - Food items, drinks, snacks, desserts
- **objects** - Everyday items, tools, electronics, furniture
- **nature** - Natural elements, places, weather, buildings
- **vehicles** - All types of transportation
- **music** - Musical instruments and entertainment
- **sports** - Sports, activities, hobbies
- **body** - Body parts
- **emotions** - Feelings and actions
- **shapes** - Shapes and colors
- **fantasy** - Fantasy elements, professions, mythical creatures
- **insects** - Bugs and insects

### 3. Difficulty Levels

You can also categorize words by difficulty:

```json
{
  "difficulty": {
    "easy": ["cat", "sun", "car"],
    "medium": ["elephant", "guitar", "castle"],
    "hard": ["rhinoceros", "kaleidoscope", "archipelago"]
  }
}
```

**Guidelines:**
- **Easy**: 3-5 letters, common words everyone knows
- **Medium**: 6-10 letters, moderately common words
- **Hard**: 10+ letters, complex or uncommon words

### 4. Word Guidelines

When adding words, make sure they are:
- ✅ **Drawable** - Can be represented visually
- ✅ **Appropriate** - Family-friendly content
- ✅ **Clear** - Not too abstract or ambiguous
- ✅ **Spelled correctly** - Use lowercase only
- ❌ **Avoid** - Proper nouns, brands, offensive content

### 5. Testing Your Words

After adding words:
1. Save the `words.json` file
2. Restart the backend server
3. The new words will be automatically loaded
4. Test in-game to ensure they work well

### 6. Word Count

The current dictionary contains **400+ words** across all categories.

To check the total count, look at the `metadata` section in `words.json`:

```json
{
  "metadata": {
    "totalWords": 400,
    "lastUpdated": "2024-12-09"
  }
}
```

Update this when adding significant numbers of words.

## Advanced Usage

The word system supports:
- Category-specific word selection (future feature)
- Difficulty-based word selection (future feature)
- Custom word pools per game mode

## Examples

### Adding a New Animal
```json
"animals": [
  "cat",
  "dog",
  "hamster"  // Add comma after previous word
]
```

### Adding Multiple Words
```json
"food": [
  "pizza",
  "burger",
  "taco",
  "sushi",
  "ramen",     // New word
  "dumpling",  // New word
  "tempura"    // New word (no comma on last item)
]
```

## Need Help?

If you're unsure about a word:
1. Check if it's drawable
2. Test with friends
3. Consider the difficulty level
4. Make sure it's spelled correctly

Happy word adding! 🎨✨
