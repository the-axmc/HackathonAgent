// ---------------------------------------------------------------------------
// 🌍 Load environment
// ---------------------------------------------------------------------------
import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

// ---------------------------------------------------------------------------
// 🤖 Telegram Webhook Setup for Render
// ---------------------------------------------------------------------------
import express from "express";
import { Telegraf } from "telegraf";

const app = express();
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);

// Webhook endpoint (Render external URL required)
const webhookPath = "/elias";
const webhookUrl = `${process.env.RENDER_EXTERNAL_URL}${webhookPath}`;

app.use(bot.webhookCallback(webhookPath));

bot.telegram.setWebhook(webhookUrl);
console.log(`🌐 Telegram webhook set to ${webhookUrl}`);

// Simple route to verify Render service
app.get("/", (_, res) => {
  res.send("✅ Elias Nova Webhook is running.");
});

// ---------------------------------------------------------------------------
// 🧠 Force Groq model globally
// ---------------------------------------------------------------------------
const groqModel = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
(globalThis as any).LLAMA_DEFAULT_MODEL = groqModel;

const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  if (
    typeof url === "string" &&
    url.includes("api.groq.com/openai/v1/chat/completions")
  ) {
    try {
      const body = JSON.parse(options?.body || "{}");
      if (body.model && body.model !== groqModel) {
        body.model = groqModel;
        options.body = JSON.stringify(body);
        console.log("🔧 Forced Groq model globally to:", groqModel);
      }
    } catch {}
  }
  return originalFetch(url, options);
};

// ---------------------------------------------------------------------------
// 🧩 Eliza Runtime Imports
// ---------------------------------------------------------------------------
import { DirectClient } from "@elizaos/client-direct";
import {
  AgentRuntime,
  elizaLogger,
  settings,
  stringToUuid,
  type Character,
} from "@elizaos/core";
import { bootstrapPlugin } from "@elizaos/plugin-bootstrap";
import { createNodePlugin } from "@elizaos/plugin-node";
import { solanaPlugin } from "@elizaos/plugin-solana";
import fs from "fs";
import net from "net";
import { fileURLToPath } from "url";
import { initializeDbCache } from "./cache/index.ts";
import { character } from "./character.ts";
import { startChat } from "./chat/index.ts";
import { initializeClients } from "./clients/index.ts";
import {
  getTokenForProvider,
  loadCharacters,
  parseArguments,
} from "./config/index.ts";
import { initializeDatabase } from "./database/index.ts";

// ---------------------------------------------------------------------------
// 🧾 Logger Patch
// ---------------------------------------------------------------------------
const logger = {
  ...elizaLogger,
  log: (...args: unknown[]) =>
    (elizaLogger as any).info(args.map(String).join(" ")),
  success: (...args: unknown[]) =>
    (elizaLogger as any).info(args.map(String).join(" ")),
  error: (...args: unknown[]) =>
    (elizaLogger as any).error(args.map(String).join(" ")),
  warn: (...args: unknown[]) =>
    (elizaLogger as any).warn(args.map(String).join(" ")),
  debug: (...args: unknown[]) =>
    (elizaLogger as any).debug(args.map(String).join(" ")),
};

// ---------------------------------------------------------------------------
// 🧩 Helper — Replace $VARS in character JSON with .env values
// ---------------------------------------------------------------------------
function resolveEnvPlaceholders(obj: any): any {
  if (typeof obj === "string") {
    const match = obj.match(/^\$(\w+)$/);
    if (match) return process.env[match[1]] || obj;
    return obj;
  }
  if (Array.isArray(obj)) return obj.map(resolveEnvPlaceholders);
  if (typeof obj === "object" && obj !== null) {
    const newObj: any = {};
    for (const [k, v] of Object.entries(obj))
      newObj[k] = resolveEnvPlaceholders(v);
    return newObj;
  }
  return obj;
}

// ---------------------------------------------------------------------------
// 🧠 Create AgentRuntime
// ---------------------------------------------------------------------------
let nodePlugin: any | undefined;
function createAgent(character: Character, db: any, cache: any, token: string) {
  logger.success("Creating runtime for character", character.name);
  nodePlugin ??= createNodePlugin();

  return new AgentRuntime({
    databaseAdapter: db,
    token,
    modelProvider: character.modelProvider,
    evaluators: [],
    character,
    plugins: [bootstrapPlugin, nodePlugin, solanaPlugin].filter(Boolean),
    providers: [],
    actions: [],
    services: [],
    managers: [],
    cacheManager: cache,
  });
}

// ---------------------------------------------------------------------------
// 🚀 Start One Agent
// ---------------------------------------------------------------------------
async function startAgent(character: Character, directClient: DirectClient) {
  try {
    character = resolveEnvPlaceholders(character);
    character.id ??= stringToUuid(character.name);
    character.username ??= character.name;

    const token = getTokenForProvider(character.modelProvider, character);
    const dataDir = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "../data"
    );
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

    const db = initializeDatabase(dataDir);
    await db.init();
    const cache = initializeDbCache(character, db);
    const runtime = createAgent(character, db, cache, token);
    await runtime.initialize();
    runtime.clients = await initializeClients(character, runtime);
    directClient.registerAgent(runtime);

    logger.success(`✅ Started ${character.name} using model ${groqModel}`);
    return runtime;
  } catch (error) {
    logger.error("Unhandled error in startAgent:", error);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// 🧩 Start All Agents + Webhook Server
// ---------------------------------------------------------------------------
(async () => {
  const directClient = new DirectClient();
  const args = parseArguments();
  let charactersArg = args.characters || args.character;
  let characters = [character];

  if (charactersArg) characters = await loadCharacters(charactersArg);
  characters = characters.map(resolveEnvPlaceholders);

  for (const ch of characters) await startAgent(ch, directClient);

  // 🌐 Start Express server for Telegram webhook
  const PORT = parseInt(process.env.PORT || process.env.SERVER_PORT || "3000", 10);
  app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
})();
