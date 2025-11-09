// ---------------------------------------------------------------------------
// 🌍 Load .env reliably
// ---------------------------------------------------------------------------
import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

// 🧠 Global Fetch Patch — ensure Groq model is never overridden
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
// 📦 Imports
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
// 🧩 Paths & Helpers
// ---------------------------------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const wait = (minTime = 1000, maxTime = 3000) =>
  new Promise((resolve) =>
    setTimeout(
      resolve,
      Math.floor(Math.random() * (maxTime - minTime + 1)) + minTime
    )
  );

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
// 🧠 Force Groq Model (Env Sync)
// ---------------------------------------------------------------------------
const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
process.env.GROQ_MODEL = GROQ_MODEL;
process.env.GROQ_API_MODEL = GROQ_MODEL;
(globalThis as any).LLAMA_DEFAULT_MODEL = GROQ_MODEL;

// ---------------------------------------------------------------------------
// 🧩 Helper — Replace $VARS in character JSON with .env values
// ---------------------------------------------------------------------------
function resolveEnvPlaceholders(obj: any): any {
  if (typeof obj === "string") {
    const match = obj.match(/^\$(\w+)$/);
    if (match) {
      const envValue = process.env[match[1]];
      if (!envValue)
        console.warn(`⚠️ Missing environment variable for ${match[1]}`);
      return envValue || obj;
    }
    return obj;
  }
  if (Array.isArray(obj)) return obj.map(resolveEnvPlaceholders);
  if (typeof obj === "object" && obj !== null) {
    const newObj: any = {};
    for (const [k, v] of Object.entries(obj)) {
      newObj[k] = resolveEnvPlaceholders(v);
    }
    return newObj;
  }
  return obj;
}

// ---------------------------------------------------------------------------
// ⚙️ Create AgentRuntime
// ---------------------------------------------------------------------------
let nodePlugin: any | undefined;

export function createAgent(
  character: Character,
  db: any,
  cache: any,
  token: string
) {
  logger.success("Creating runtime for character", character.name);

  nodePlugin ??= createNodePlugin();
  if (!character.settings) character.settings = {};
  character.settings.model = GROQ_MODEL;

  return new AgentRuntime({
    databaseAdapter: db,
    token,
    modelProvider: character.modelProvider,
    evaluators: [],
    character,
    plugins: [
      bootstrapPlugin,
      nodePlugin,
      character.settings?.secrets?.WALLET_PUBLIC_KEY ? solanaPlugin : null,
    ].filter(Boolean),
    providers: [],
    actions: [],
    services: [],
    managers: [],
    cacheManager: cache,
  });
}

// ---------------------------------------------------------------------------
// 🚀 Start One Agent Runtime
// ---------------------------------------------------------------------------
async function startAgent(character: Character, directClient: DirectClient) {
  try {
    character = resolveEnvPlaceholders(character);
    character.id ??= stringToUuid(character.name);
    character.username ??= character.name;
    character.settings = { ...character.settings, model: GROQ_MODEL };

    const token = getTokenForProvider(character.modelProvider, character);
    const dataDir = path.join(__dirname, "../data");
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

    const db = initializeDatabase(dataDir);
    await db.init();

    const cache = initializeDbCache(character, db);
    const runtime = createAgent(character, db, cache, token);

    await runtime.initialize();
    runtime.clients = await initializeClients(character, runtime);
    directClient.registerAgent(runtime);

    logger.success(`✅ Started ${character.name} using model ${GROQ_MODEL}`);
    return runtime;
  } catch (error) {
    logger.error("Unhandled error in startAgent:", error);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// ⚙️ Start All Agents
// ---------------------------------------------------------------------------
const checkPortAvailable = (port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") resolve(false);
    });
    server.once("listening", () => {
      server.close();
      resolve(true);
    });
    server.listen(port);
  });

const startAgents = async () => {
  const directClient = new DirectClient();
  let serverPort = parseInt(settings.SERVER_PORT || "3000");
  const args = parseArguments();

  let charactersArg = args.characters || args.character;
  let characters = [character];

  if (charactersArg) {
    characters = await loadCharacters(charactersArg);
  }

  characters = characters.map((ch) => resolveEnvPlaceholders(ch));

  try {
    for (const ch of characters) {
      await startAgent(ch, directClient);
    }
  } catch (error) {
    logger.error("Error starting agents:", error);
  }

  while (!(await checkPortAvailable(serverPort))) {
    logger.warn(`Port ${serverPort} is in use, trying ${serverPort + 1}`);
    serverPort++;
  }

  directClient.startAgent = async (ch: Character) =>
    startAgent(ch, directClient);
  directClient.start(serverPort);

  if (serverPort !== parseInt(settings.SERVER_PORT || "3000")) {
    logger.log(`Server started on alternate port ${serverPort}`);
  }

  // Disable interactive chat when deployed to cloud (Render has no stdin)
  const isDaemonProcess = process.env.DAEMON_PROCESS === "true";
  const isRender = !!process.env.RENDER; // Render automatically sets RENDER=true

  if (!isDaemonProcess && !isRender) {
    logger.log("💬 Chat started. Type 'exit' to quit.");
    const chat = startChat(characters);
    chat();
  } else {
    logger.log("🌐 Running in non-interactive mode (Render detected).");
  }
};

// ---------------------------------------------------------------------------
// 🧩 Run Everything
// ---------------------------------------------------------------------------
startAgents().catch((error) => {
  logger.error("Unhandled error in startAgents:", error);
  process.exit(1);
});
