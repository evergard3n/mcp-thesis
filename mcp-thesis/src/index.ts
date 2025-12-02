#!/usr/bin/env node

import "dotenv/config";

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
import express from "express";
import { JsonProjectStore } from "./stores/projectStore.js";
import { registerProjectTools } from "./tools/projectTools.js";
import { registerUseCaseTools } from "./tools/usecaseTools.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "crypto";

/**
 * Session-scoped MCP Server wrapper
 * Each session gets its own server instance with isolated project store
 */
class SessionServer {
  private mcpServer: McpServer;
  private projectStore: JsonProjectStore;
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
    // Create session-scoped project store
    this.projectStore = new JsonProjectStore(sessionId);
    // Register tools with session-specific store
    registerProjectTools(this.mcpServer, this.projectStore);
    registerUseCaseTools(this.mcpServer, this.projectStore);
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

const app = express();
app.use(express.json());

app.post("/mcp", async (req, res) => {
  // Check for existing session ID
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  if (sessionId && sessions[sessionId]) {
    // Existing session - reuse server and transport
    const session = sessions[sessionId];
    await session.transport.handleRequest(req, res, req.body);
  } else if (!sessionId && isInitializeRequest(req.body)) {
    // New initialization request - create new session
    // Generate sessionId upfront so we can create the server immediately
    const newSessionId = randomUUID();

    // Create session-scoped server instance
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
      // enableDnsRebindingProtection: true,
      // allowedHosts: ["*"],
      // allowedOrigins: ["*"],
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

const port = parseInt(process.env.PORT || "3006");
app
  .listen(port, () => {
    console.log(`Demo MCP Server running on http://localhost:${port}/mcp`);
  })
  .on("error", (error) => {
    console.error("Server error:", error);
    process.exit(1);
  });

// export default {
//   fetch(request: Request, env: Env, ctx: ExecutionContext) {
//     const url = new URL(request.url);

//     if (url.pathname === "/sse" || url.pathname === "/sse/message") {
//       return server.serveSSE("/sse").fetch(request, env, ctx);
//     }

//     if (url.pathname === "/mcp") {
//       return MyMCP.serve("/mcp").fetch(request, env, ctx);
//     }

//     return new Response("Not found", { status: 404 });
//   },
// };
