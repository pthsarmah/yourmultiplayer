# Word Oracle

A multiplayer word guessing game powered by AI. Players join a game room, choose a theme, and take turns asking questions to an AI Oracle who knows a secret word. The Oracle answers truthfully without revealing the word directly.

## Features

- **AI Oracle** - An LLM-powered oracle answers questions about the secret word using web search for accurate responses
- **Theme Categories** - 12 themes including Sports, Celebrities, Food, Animals, Movies, Music, History, Science, Geography, Gaming, and Literature
- **Real-Time Multiplayer** - WebSocket-based synchronization for up to 8 players
- **Scoring System** - First to guess the word wins the round and earns a point

## Tech Stack

- **Bun** - Runtime, package manager, and server
- **React 19** - Frontend UI
- **Tailwind CSS** - Styling
- **Groq API / Local LLM** - Oracle responses
- **DuckDuckGo API** - Web search for context-aware answers
- **WebSocket** - Real-time communication (Bun built-in)

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) installed
- A [Groq API key](https://console.groq.com/) (or a local LLM server)

### Installation

```bash
bun install
```

### Configuration

Create a `.env` file:

```bash
# For Groq API (default)
GROQ_API_KEY=your_groq_api_key
GROQ_MODEL=llama-3.3-70b-versatile  # optional

# For local model (optional)
USE_LOCAL_MODEL=true
LOCAL_MODEL_URL=http://localhost:8080/v1/chat/completions
```

### Development

```bash
bun dev
```

### Production

```bash
bun start
```

## How to Play

1. Players connect to the game at `http://localhost:3000`
2. Each player gets a unique name, color, and avatar
3. Select a theme category to start the game
4. Ask the Oracle yes/no questions or descriptive questions about the secret word
5. To make a guess, prefix your message with `Guess:` (e.g., "Guess: pizza")
6. First player to guess correctly wins the round and scores a point
7. A new word is chosen and the next round begins

## Project Structure

```
├── index.ts          # Backend server with WebSocket and LLM integration
├── frontend.tsx      # React frontend component
├── index.html        # HTML entry point
├── styles.css        # Styling
├── words.db          # SQLite database for word storage
└── package.json      # Dependencies
```

## License

MIT
