#!/usr/bin/env node

// Check if stdio mode BEFORE dotenv loads PORT
// When stdin is piped (not a TTY), we're in stdio mode
const isStdioMode =
  typeof process.stdin.isTTY === "undefined" || process.stdin.isTTY === false;

// If stdio mode, delete PORT to prevent dotenv from enabling HTTP
if (isStdioMode) {
  delete process.env.PORT;
}

import "dotenv/config";

// Redirect all console output to stderr in stdio mode to keep stdout clean for JSON-RPC
if (isStdioMode) {
  const originalError = console.error;
  console.log = (...args: any[]) => originalError("[LOG]", ...args);
  console.error = (...args: any[]) => originalError("[ERROR]", ...args);
  console.warn = (...args: any[]) => originalError("[WARN]", ...args);
}

/**
 * This is a template MCP server that implements a simple notes system.
 * It demonstrates core MCP concepts like resources and tools by allowing:
 * - Listing notes as resources
 * - Reading individual notes
 * - Creating new notes via a tool
 * - Summarizing all notes via a prompt
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import express from "express";
import { JsonProjectStore } from "./stores/projectStore.js";
import { registerProjectTools } from "./tools/projectTools.js";
import { registerUseCaseTools } from "./tools/usecaseTools.js";
import { registerTestingTools } from "./tools/testingTools.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "crypto";
import { OPENROUTER_API_KEY } from "./helpers/env.js";
import { GeminiOpenRouterFunctions } from "./helpers/gemini-openrouter.functions.js";
import { registerFrslTool } from "./tools/genFRSLTool.js";

/**
 * Session-scoped MCP Server wrapper
 * Each session gets its own server instance with isolated project store
 */
class SessionServer {
  private mcpServer: McpServer;
  private projectStore: JsonProjectStore;
  private geminiFunctions: GeminiOpenRouterFunctions;
  public readonly sessionId: string;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
    this.mcpServer = new McpServer({
      name: "mcp-thesis",
      version: "1.0.0",
      icons: [{ src: "icon.png" }],
      title: "MCP Thesis",
      websiteUrl: "https://github.com/yourusername/mcp-thesis",
    });
    console.log("OPENROUTER_API_KEY", OPENROUTER_API_KEY);
    // Create session-scoped project store
    this.projectStore = new JsonProjectStore(sessionId);
    const geminiApiKey = process.env.GEMINI_API_KEY;
    const openrouterApiKey = OPENROUTER_API_KEY;
    if (!geminiApiKey) {
      console.log("GEMINI_API_KEY is not set");
      throw new Error("GEMINI_API_KEY is not set");
    }
    if (!openrouterApiKey) {
      console.log("OPENROUTER_API_KEY is not set");
      throw new Error("OPENROUTER_API_KEY is not set");
    }
    // Create session-scoped GeminiFunctions singleton
    this.geminiFunctions = new GeminiOpenRouterFunctions(
      geminiApiKey,
      openrouterApiKey
    );
    // Register tools with session-specific store and singleton
    registerProjectTools(this.mcpServer, this.projectStore);
    registerUseCaseTools(
      this.mcpServer,
      this.projectStore,
      this.geminiFunctions
    );
    registerTestingTools(
      this.mcpServer,
      this.projectStore,
      this.geminiFunctions
    );
    registerFrslTool(this.mcpServer, this.projectStore);
  }

  async connect(transport: StreamableHTTPServerTransport): Promise<void> {
    await this.mcpServer.connect(transport);
  }
}

// Store active sessions: sessionId -> SessionServer instance
const sessions: {
  [sessionId: string]: {
    server: SessionServer;
    transport: StreamableHTTPServerTransport;
  };
} = {};

// const  Map<
//   string,
//   { server: SessionServer; transport: StreamableHTTPServerTransport }
// >();

const app = express();

app.get("/ping", async (req, res) => {
  res.status(200).send("pong");
});

app.post("/mcp", async (req, res) => {
  // Check for existing session ID
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  if (sessionId && sessions[sessionId]) {
    // Existing session - reuse server and transport
    const session = sessions[sessionId];
    await session.transport.handleRequest(req, res, req.body);
  } else if (isInitializeRequest(req.body)) {
    // New initialization request - create new session
    // Extract Gemini API key from header
    // const geminiApiKey = req.headers["x-gemini-api-key"] as string | undefined;

    // if (!geminiApiKey) {
    //   res.status(400).json({
    //     jsonrpc: "2.0",
    //     error: {
    //       code: -32000,
    //       message: "Missing required header: x-gemini-api-key",
    //     },
    //     id: null,
    //   });
    //   return;
    // }

    // // Get OpenRouter API key from environment
    // if (!OPENROUTER_API_KEY) {
    //   res.status(500).json({
    //     jsonrpc: "2.0",
    //     error: {
    //       code: -32001,
    //       message: "Server configuration error: OPENROUTER_API_KEY not set",
    //     },
    //     id: null,
    //   });
    //   return;
    // }

    // Generate sessionId upfront so we can create the server immediately
    const newSessionId = sessionId || randomUUID();
    console.log("newSessionId", newSessionId);

    // Create session-scoped server instance with API keys
    const server = new SessionServer(newSessionId);

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => newSessionId,
      onsessioninitialized: async (sessionId) => {
        // Store session data (server already created and connected)
        sessions[sessionId] = {
          server,
          transport,
        };
      },
      enableDnsRebindingProtection: false,
      allowedHosts: ["*"],
      allowedOrigins: ["*"],
    });

    // Connect server to transport BEFORE handling requests
    await server.connect(transport);

    // Clean up session when transport closes
    transport.onclose = () => {
      if (transport.sessionId) {
        delete sessions[transport.sessionId];
      }
    };

    // Handle initialization request
    res.setHeader("mcp-session-id", newSessionId);
    await transport.handleRequest(req, res, req.body);
  } else {
    res.status(400).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Bad Request" },
      id: null,
    });
    return;
  }
});

// Handle GET requests for server-to-client notifications via SSE
app.get("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId || !sessions[sessionId]) {
    res.status(400).send("Invalid or missing session ID");
    return;
  }
  await sessions[sessionId].transport.handleRequest(req, res);
});

// Start server in appropriate mode (isStdioMode already defined at top)
if (isStdioMode) {
  // STDIO MODE - for MCP Inspector and Claude Desktop
  const server = new SessionServer("stdio-session");
  const transport = new StdioServerTransport();

  server.connect(transport as any).catch((error) => {
    console.error("Failed to start STDIO server:", error);
    process.exit(1);
  });
} else {
  // HTTP MODE - for web clients
  const port = parseInt(process.env.PORT || "3006");
  app
    .listen(port, () => {
      console.log(
        `${new Date().toISOString()} MCP Server running on http://localhost:${port}/mcp`
      );
    })
    .on("error", (error) => {
      console.error("Server error:", error);
      process.exit(1);
    });
}

app.use(express.json());
