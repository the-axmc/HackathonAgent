// Load .env
import "dotenv/config";
// 🧠 Global Fetch Patch — before Eliza loads anything
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
import path from "path";
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

/* -------------------------------------------------------------------------- */
/* 📁 Paths & Helpers                                                         */
/* -------------------------------------------------------------------------- */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const wait = (minTime = 1000, maxTime = 3000) =>
  new Promise((resolve) =>
    setTimeout(
      resolve,
      Math.floor(Math.random() * (maxTime - minTime + 1)) + minTime
    )
  );

/* -------------------------------------------------------------------------- */
/* 🧩 Logger Patch                                                            */
/* -------------------------------------------------------------------------- */
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

/* -------------------------------------------------------------------------- */
/* 🧠 Force Groq Model                                                        */
/* -------------------------------------------------------------------------- */
const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
process.env.GROQ_MODEL = GROQ_MODEL;
process.env.GROQ_API_MODEL = GROQ_MODEL;
(globalThis as any).LLAMA_DEFAULT_MODEL = GROQ_MODEL;

let nodePlugin: any | undefined;

/* -------------------------------------------------------------------------- */
/* 🧩 Create AgentRuntime                                                     */
/* -------------------------------------------------------------------------- */
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

/* -------------------------------------------------------------------------- */
/* 🚀 Start One Agent Runtime                                                 */
/* -------------------------------------------------------------------------- */
async function startAgent(character: Character, directClient: DirectClient) {
  try {
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

    /* ---------------------------------------------------------------------- */
    /* 🧠 Final Groq Model Enforcement (Fetch Intercept)                      */
    /* ---------------------------------------------------------------------- */
    const groqModel = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
    (globalThis as any).LLAMA_DEFAULT_MODEL = groqModel;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
      if (
        typeof url === "string" &&
        url.includes("api.groq.com/openai/v1/chat/completions")
      ) {
        try {
          const body = JSON.parse(options.body);
          if (body && body.model && body.model !== groqModel) {
            body.model = groqModel;
            options.body = JSON.stringify(body);
            console.log("🔧 Forced Groq model to:", groqModel);
          }
        } catch (err) {
          console.warn("⚠️ Could not patch Groq body:", err);
        }
      }
      return originalFetch(url, options);
    };

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

/* -------------------------------------------------------------------------- */
/* ⚙️ Start All Agents                                                        */
/* -------------------------------------------------------------------------- */
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

  const isDaemonProcess = process.env.DAEMON_PROCESS === "true";
  if (!isDaemonProcess) {
    logger.log("💬 Chat started. Type 'exit' to quit.");
    const chat = startChat(characters);
    chat();
  }
};

/* -------------------------------------------------------------------------- */
/* 🧩 Run Everything                                                          */
/* -------------------------------------------------------------------------- */
startAgents().catch((error) => {
  logger.error("Unhandled error in startAgents:", error);
  process.exit(1);
});
