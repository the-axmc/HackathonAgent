# 🤖 Elias Nova — The Hackathon Catalyst Agent

**Elias Nova** is an AI-driven agent built on the [Eliza Framework](https://github.com/elizaOS/eliza-starter).  
He’s designed to act as a **Hackathon Lead**, supporting organizers, developers, and sponsors during events — ensuring logistics run smoothly and participants stay motivated.

Elias lives on **Telegram**, runs autonomously via **PM2**, and uses the **Groq LLaMA 3.3 (70B)** model for fast, reliable reasoning.

---

## 🚀 Features

- 🧠 Built with **ElizaOS Agent Framework**
- 💬 Integrated with **Telegram Bot API**
- ⚙️ Powered by **Groq LLaMA 3.3 (70B Versatile)**
- 🪄 Memory & context via SQLite cache
- 🔄 Auto-restarts & persists using **PM2**
- 🌍 Easily deployable on **Render**, **Railway**, or any VPS

---

## 📁 Project Structure

eliza-starter/
│
├── src/

│ ├── index.ts # Main entry point (agent startup)

│ ├── chat/ # CLI and Telegram message handling

│ ├── clients/ # Telegram client integration

│ ├── cache/ # Persistent memory and cache

│ ├── config/ # Character + runtime configuration

│ ├── database/ # SQLite adapter
│ └── character.ts # Character definitions
│
├── characters/
│ └── eliasnova.character.json # Personality file for Elias
│
├── .env # API keys and environment variables
├── package.json
├── tsconfig.json
└── README.md

---

## ⚙️ Environment Setup

Create a `.env` file in your project root:

```bash
TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here
GROQ_API_KEY=your_groq_api_key_here
GROQ_MODEL=llama-3.3-70b-versatile
```

> 🧩 You can create a Telegram bot using @BotFather

## Troubleshooting

| Issue                   | Fix                                                           |
| ----------------------- | ------------------------------------------------------------- |
| `FetchError: ETIMEDOUT` | Check internet connection or Telegram API availability        |
| `model_decommissioned`  | Update `.env` to use a valid model: `llama-3.3-70b-versatile` |
| Bot doesn’t reply       | Ensure `.env` is loaded and tokens are valid                  |
| Multiple PM2 instances  | Run `pm2 delete all` and restart one clean instance           |
