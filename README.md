# 🎮 Drawzzl Backend

<div align="center">

**High-performance real-time game server for multiplayer drawing and guessing**

[![Node.js](https://img.shields.io/badge/Node.js-18+-green?style=for-the-badge&logo=node.js)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue?style=for-the-badge&logo=typescript)](https://www.typescriptlang.org/)
[![Socket.IO](https://img.shields.io/badge/Socket.IO-4.8-black?style=for-the-badge&logo=socket.io)](https://socket.io/)
[![MongoDB](https://img.shields.io/badge/MongoDB-7.0-green?style=for-the-badge&logo=mongodb)](https://www.mongodb.com/)
[![Express](https://img.shields.io/badge/Express-4.18-lightgrey?style=for-the-badge&logo=express)](https://expressjs.com/)

[🚀 Deploy on Railway](https://railway.app) • [📖 API Docs](#api-documentation) • [🔧 Configuration](#configuration)

</div>

---

## ⚡ Features

### 🎯 **Real-time Game Engine**
- **WebSocket Communication** - Ultra-low latency Socket.IO implementation
- **Turn-based System** - Robust drawer rotation with race condition prevention
- **Timer Management** - Precise game timing with automatic turn transitions
- **State Synchronization** - Bulletproof game state management across all clients

### 🏗️ **Scalable Architecture**
- **MongoDB Integration** - Persistent game rooms and player data
- **Express REST API** - Health checks and monitoring endpoints
- **Memory Management** - Efficient cleanup of game sessions and timers
- **Error Recovery** - Graceful handling of network interruptions and crashes

### 🛡️ **Security & Reliability**
- **Input Validation** - Comprehensive message filtering and sanitization
- **Profanity Filter** - Advanced content moderation system
- **Rate Limiting** - Protection against spam and abuse
- **CORS Configuration** - Secure cross-origin resource sharing

### 🎨 **Game Features**
- **Dynamic Word Selection** - Smart word difficulty balancing
- **Custom Word Lists** - Support for user-defined vocabulary
- **Progressive Hints** - Timed letter reveals for better gameplay
- **Scoring Algorithm** - Time-based point calculation with bonuses

---

## 🚀 Quick Start

### Prerequisites
- **Node.js** 18.0 or higher
- **MongoDB** database (local or cloud)
- **npm** or **yarn** package manager

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/drawzzl-backend.git
cd drawzzl-backend

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env

# Build TypeScript
npm run build

# Start the server
npm start
```

### Environment Configuration

Create a `.env` file in the root directory:

```env
# Database Configuration
MONGODB_URI=mongodb://localhost:27017/drawzzl
# or MongoDB Atlas: mongodb+srv://username:password@cluster.mongodb.net/drawzzl

# Server Configuration
PORT=4000
NODE_ENV=production

# Optional: Additional configurations
MAX_ROOMS=1000
CLEANUP_INTERVAL=300000
```

---

## 🛠️ Development

### Available Scripts

```bash
# Development with hot reload
npm run dev

# Build TypeScript
npm run build

# Start production server
npm start

# Type checking
npm run type-check

# Run tests (if available)
npm test
```

### Project Structure

```
drawzzl-backend/
├── src/
│   ├── index.ts                # Main server entry point
│   ├── models/
│   │   └── Room.ts             # MongoDB room schema
│   ├── lib/
│   │   ├── db.ts               # Database connection
│   │   ├── words.ts            # Word dictionary management
│   │   └── profanityFilter.ts  # Content moderation
│   └── data/
│       └── words.json          # Game word database
├── dist/                       # Compiled JavaScript (generated)
├── .env.example               # Environment template
├── package.json               # Dependencies and scripts
└── tsconfig.json              # TypeScript configuration
```

---

## 🎮 Game Engine Architecture

### Core Components

#### **Room Management System**
```typescript
interface Room {
  roomId: string;           // Unique 6-character room code
  players: Player[];        // Connected players array
  gameStarted: boolean;     // Current game state
  currentWord: string;      // Active drawing word
  drawerIndex: number;      // Current drawer position
  round: number;           // Current round number
  maxRounds: number;       // Total rounds to play
  correctGuessers: string[]; // Players who guessed correctly
  // ... additional game state
}
```

#### **Player Data Structure**
```typescript
interface Player {
  id: string;              // Socket.IO connection ID
  name: string;            // Player display name
  score: number;           // Current game score
  isDrawer?: boolean;      // Current drawer flag
  avatar?: number[];       // Avatar customization data
}
```

### Game Flow Logic

#### **1. Room Creation & Joining**
```typescript
// Create new room
socket.emit('createRoom', { playerName, avatar });

// Join existing room
socket.emit('joinRoom', { roomId, playerName, avatar });
```

#### **2. Game Initialization**
```typescript
// Start game (host only)
socket.emit('startGame', { roomId });

// Server response with game state
socket.on('gameStarted', { drawerId, wordHint, timeLeft, round });
```

#### **3. Drawing & Guessing**
```typescript
// Real-time drawing data
socket.emit('draw', { roomId, lines });

// Player guesses
socket.emit('guess', { roomId, guess, name });

// Correct guess notification
socket.on('correctGuess', { playerId, name, points, total });
```

---

## 🔧 Configuration

### Game Settings

| Setting | Default | Range | Description |
|---------|---------|-------|-------------|
| `maxRounds` | 3 | 1-10 | Number of rounds per game |
| `drawTime` | 60 | 30-180 | Seconds per drawing turn |
| `wordCount` | 3 | 3-5 | Word choices for drawer |
| `maxPlayers` | 8 | 2-15 | Maximum room capacity |

### Scoring System

```typescript
// Point calculation formula
const points = Math.floor(MAX_POINTS * (timeRemaining / maxTime));
const finalPoints = Math.max(MIN_POINTS, points);

// Constants
const MAX_POINTS = 500;           // Maximum points for instant guess
const MIN_POINTS = 50;            // Minimum points guarantee
const DRAWER_BONUS_PER_GUESSER = 50; // Drawer bonus per correct guess
```

### Word Selection Algorithm

```typescript
// Difficulty distribution
const wordSelection = {
  easy: 20,    // 20% easy words
  medium: 40,  // 40% medium words  
  hard: 40     // 40% hard words
};

// Custom word probability (user-defined)
const customWordChance = room.customWordProbability; // 0-100%
```

---

## 📡 API Documentation

### Socket.IO Events

#### **Client → Server Events**

| Event | Parameters | Description |
|-------|------------|-------------|
| `createRoom` | `{ playerName, avatar }` | Create new game room |
| `joinRoom` | `{ roomId, playerName, avatar }` | Join existing room |
| `startGame` | `{ roomId }` | Start game (host only) |
| `wordSelected` | `{ roomId, word }` | Select drawing word |
| `draw` | `{ roomId, lines }` | Send drawing data |
| `guess` | `{ roomId, guess, name }` | Submit word guess |
| `chat` | `{ roomId, msg, name }` | Send chat message |
| `updateSettings` | `{ roomId, settings }` | Update game settings |

#### **Server → Client Events**

| Event | Data | Description |
|-------|------|-------------|
| `roomCreated` | `{ roomId, playerId }` | Room creation success |
| `roomJoined` | `{ roomId }` | Successfully joined room |
| `playerJoined` | `{ players }` | Updated player list |
| `gameStarted` | `{ drawerId, wordHint, timeLeft }` | Game initialization |
| `selectWord` | `{ words, timeLimit }` | Word selection prompt |
| `yourWord` | `{ word }` | Drawer's selected word |
| `tick` | `{ timeLeft }` | Timer countdown |
| `correctGuess` | `{ playerId, name, points }` | Successful guess |
| `turnEnded` | `{ word, players, correctGuessers }` | Round completion |
| `gameOver` | `{ players }` | Game finished |
| `error` | `{ message }` | Error notification |

### REST Endpoints

#### **Health Check**
```http
GET /health
```

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "uptime": 3600
}
```

---

## 🚀 Deployment

### Railway (Recommended)

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login to Railway
railway login

# Deploy to Railway
railway up
```

**Environment Variables in Railway:**
- `MONGODB_URI`: Your MongoDB connection string
- `NODE_ENV`: `production`

### Docker Deployment

```dockerfile
FROM node:18-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

COPY . .
RUN npm run build

EXPOSE 4000
CMD ["npm", "start"]
```

### Manual Server Deployment

```bash
# On your server
git clone https://github.com/yourusername/drawzzl-backend.git
cd drawzzl-backend

# Install dependencies
npm ci --only=production

# Build application
npm run build

# Start with PM2 (recommended)
npm install -g pm2
pm2 start dist/index.js --name "drawzzl-backend"

# Or start directly
npm start
```

---

## 🔍 Monitoring & Debugging

### Logging System

The server includes comprehensive logging for debugging:

```typescript
// Game state logging
[DRAWER DEBUG] Game starting - Players: [0:Alice, 1:Bob], Initial drawerIndex: 0
[DRAWER DEBUG] Turn starting - Round 1, Selected drawer: Alice (index: 0)
[DRAWER DEBUG] Drawer rotation: 0:Alice -> 1:Bob (2 players)
[DRAWER DEBUG] Room state saved successfully (attempt 1)
```

### Performance Monitoring

```typescript
// Key metrics to monitor
- Active rooms count
- Connected players
- Average game duration
- Database query performance
- Memory usage patterns
```

### Health Checks

```bash
# Check server status
curl http://localhost:4000/health

# Monitor logs
tail -f logs/app.log

# Check MongoDB connection
mongosh $MONGODB_URI --eval "db.adminCommand('ping')"
```

---

## 🛡️ Security Features

### Input Validation
- **Message Sanitization**: All user inputs are validated and cleaned
- **Profanity Filtering**: Advanced content moderation system
- **Rate Limiting**: Protection against spam and abuse
- **SQL Injection Prevention**: Mongoose ODM provides built-in protection

### CORS Configuration
```typescript
const corsOptions = {
  origin: [
    'http://localhost:3000',
    /\.vercel\.app$/,
    'https://yourdomain.com'
  ],
  credentials: true
};
```

### Data Protection
- **No Sensitive Data Storage**: Only game-related data is persisted
- **Automatic Cleanup**: Rooms are automatically deleted when empty
- **Session Management**: Secure socket session handling

---

## 🧪 Testing

### Manual Testing
```bash
# Test room creation
curl -X POST http://localhost:4000/test/create-room

# Test health endpoint
curl http://localhost:4000/health

# Monitor WebSocket connections
wscat -c ws://localhost:4000
```

### Load Testing
```bash
# Install artillery for load testing
npm install -g artillery

# Run load test
artillery run load-test.yml
```

---

## 🤝 Contributing

We welcome contributions! Please follow these guidelines:

### Development Setup
1. **Fork** the repository
2. **Clone** your fork locally
3. **Install** dependencies: `npm install`
4. **Create** a feature branch: `git checkout -b feature/amazing-feature`
5. **Make** your changes
6. **Test** thoroughly
7. **Commit** with clear messages
8. **Push** and create a Pull Request

### Code Standards
- Follow TypeScript best practices
- Use meaningful variable names
- Add proper error handling
- Include JSDoc comments for functions
- Maintain consistent formatting

### Testing Requirements
- Test all new features thoroughly
- Ensure backward compatibility
- Verify database operations
- Test WebSocket functionality

---

## 📊 Performance Optimization

### Database Optimization
```typescript
// Efficient queries with proper indexing
await Room.findOne({ roomId }).lean(); // Use lean() for read-only operations

// Batch operations where possible
await Room.updateMany({ gameStarted: false }, { $unset: { expiredAt: 1 } });
```

### Memory Management
```typescript
// Proper cleanup of intervals and timeouts
const cleanup = () => {
  roomIntervals.forEach(interval => clearInterval(interval));
  wordSelectionTimeouts.forEach(timeout => clearTimeout(timeout));
};
```

### Socket.IO Optimization
```typescript
// Efficient event handling
io.to(roomId).emit('playerJoined', { players }); // Room-specific broadcasts
socket.broadcast.to(roomId).emit('draw', { lines }); // Exclude sender
```

---

## 📝 License

This project is licensed under the **MIT License** - see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

- **Socket.IO Team** - For excellent real-time communication framework
- **MongoDB Team** - For robust document database
- **Express.js** - For lightweight web framework
- **TypeScript Team** - For type-safe JavaScript development
- **Railway** - For seamless deployment platform

---

<div align="center">

**Built with ⚡ by the Drawzzl Team**

[🐛 Report Bug](https://github.com/yourusername/drawzzl-backend/issues) • [✨ Request Feature](https://github.com/yourusername/drawzzl-backend/issues) • [📚 Wiki](https://github.com/yourusername/drawzzl-backend/wiki)

</div>