# Simple Chatbot

A MERN stack web app that wraps the OpenAI Chat API with user accounts, persistent per-user conversation history, and streaming responses.

## Stack

| Layer    | Technology                          |
|----------|-------------------------------------|
| Frontend | React 18 + Vite + TypeScript        |
| Backend  | Node.js + Express + TypeScript      |
| Database | MongoDB + Mongoose                  |
| AI       | OpenAI API (swappable — see below)  |

---

## Prerequisites

- **Node.js** 18 or later
- **MongoDB** running locally (default: `mongodb://localhost:27017`) — or supply a remote URI
- An **OpenAI API key**

Install MongoDB locally with Homebrew if needed:

```bash
brew tap mongodb/brew
brew install mongodb-community
brew services start mongodb-community
```

---

## Project Structure

```
simple-chatbot/
├── server/                   # Express API
│   ├── config/
│   │   └── chatbot.config.ts # System prompt, model, history window ← edit this
│   ├── models/
│   │   ├── User.ts
│   │   └── Message.ts
│   ├── middleware/
│   │   └── auth.ts           # JWT via httpOnly cookie
│   ├── routes/
│   │   ├── auth.ts           # /api/auth/*
│   │   └── chat.ts           # /api/chat/*
│   ├── services/
│   │   └── aiService.ts      # OpenAI streaming — swap provider here
│   ├── server.ts
│   └── tsconfig.json
│
├── client/                   # React SPA
│   ├── src/
│   │   ├── context/AuthContext.tsx
│   │   ├── api/client.ts
│   │   ├── pages/
│   │   │   ├── Login.tsx
│   │   │   ├── Register.tsx
│   │   │   └── Chat.tsx
│   │   ├── App.tsx
│   │   └── App.css
│   ├── index.html
│   ├── vite.config.ts
│   ├── tsconfig.json
│   └── tsconfig.node.json
│
├── .env.example
└── README.md
```

---

## Setup

### 1. Environment variables

Copy `.env.example` into `server/.env` and fill in your values:

```bash
cp .env.example server/.env
```

```env
MONGODB_URI=mongodb://localhost:27017/chatbot
JWT_SECRET=replace-with-a-long-random-string
OPENAI_API_KEY=<your API key>
OPENAI_BASE_URL=<your gateway URL>   # optional — see below
PORT=5000
NODE_ENV=development
CLIENT_URL=http://localhost:5173
```

> **JWT_SECRET** — use any long random string, e.g. output of `openssl rand -hex 32`.

#### Standard OpenAI
Set `OPENAI_API_KEY` to your OpenAI secret key and leave `OPENAI_BASE_URL` blank.

#### University of Michigan UMGPT (or any OpenAI-compatible gateway)
Set both variables using the credentials from the UMGPT portal:
```env
OPENAI_API_KEY=<UMGPT API key>
OPENAI_BASE_URL=<UMGPT Gateway Base URL>
```
Also confirm the model name in `server/config/chatbot.config.ts` matches one available through your gateway (e.g. `gpt-4o`).

### 2. Install dependencies

```bash
# Server
cd server && npm install

# Client (separate terminal tab)
cd client && npm install
```

### 3. Run locally

In one terminal:

```bash
cd server && npm run dev
# → Server running on port 5000
# → MongoDB connected
```

In another terminal:

```bash
cd client && npm run dev
# → Local:   http://localhost:5173
```

Open **http://localhost:5173** in your browser. Register an account and start chatting.

---

## Configuration

All chatbot behavior lives in **[`server/config/chatbot.config.ts`](server/config/chatbot.config.ts)**:

```ts
const config: ChatbotConfig = {
  // Edit this to change the assistant's persona and behavior
  systemPrompt: `You are a helpful, knowledgeable, and friendly assistant...`,

  // How many recent messages (user + assistant combined) to include per turn.
  // Increase for longer memory; decrease to reduce token usage.
  historyWindowSize: 20,

  // OpenAI model — change to 'gpt-4o-mini', 'gpt-4-turbo', etc.
  model: 'gpt-4o',

  temperature: 0.7,
  maxTokens: 1024,
};
```

Changes to this file take effect on server restart (automatically with `tsx watch`).

---

## Swapping the AI Provider

The streaming abstraction lives in [`server/services/aiService.ts`](server/services/aiService.ts). The exported interface is:

```ts
export async function* streamTokens(
  messages: ChatCompletionMessageParam[]
): AsyncGenerator<string> { ... }
```

To switch to Anthropic, Gemini, or any other provider, replace the body of `streamTokens` while keeping the same signature. No other files need to change.

---

## API Reference

### Auth

| Method | Path                | Body                        | Description           |
|--------|---------------------|-----------------------------|-----------------------|
| POST   | `/api/auth/register`| `{ username, password }`    | Create account, sets cookie |
| POST   | `/api/auth/login`   | `{ username, password }`    | Login, sets cookie    |
| POST   | `/api/auth/logout`  | —                           | Clears cookie         |
| GET    | `/api/auth/me`      | —                           | Returns `{ username }` for current session |

### Chat

| Method | Path               | Body              | Description                         |
|--------|--------------------|-------------------|-------------------------------------|
| GET    | `/api/chat/history`| —                 | Returns full message history for the authenticated user |
| POST   | `/api/chat/message`| `{ content }`     | Sends a message; streams SSE response tokens |

The `/api/chat/message` response is a `text/event-stream`. Each event is:

```
data: {"token":"Hello"}\n\n   ← content token
data: [DONE]\n\n               ← stream complete
data: {"error":"..."}\n\n      ← error mid-stream
```

---

## Notes

- Sessions persist via a 7-day `httpOnly` cookie. Users stay logged in across browser restarts.
- Conversation history is stored indefinitely in MongoDB. All messages for a user are loaded in the chat UI on page load; only the most recent `historyWindowSize` messages are sent to the AI as context per turn.
- `Enter` sends a message; `Shift+Enter` inserts a newline.
