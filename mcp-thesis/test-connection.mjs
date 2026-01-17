#!/usr/bin/env node

/**
 * Direct MCP tool test script - bypasses Inspector
 * Tests the runHITLComparison tool directly via stdio
 */

import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log("🚀 Testing MCP Server Connection...\n");

// Spawn the server process
const serverPath = join(__dirname, "build/index.js");
const server = spawn("node", [serverPath], {
  stdio: ["pipe", "pipe", "pipe"],
  env: { ...process.env },
});

let buffer = "";

server.stdout.on("data", (data) => {
  buffer += data.toString();
  // Try to parse JSON-RPC responses
  const lines = buffer.split("\n");
  buffer = lines.pop() || "";

  lines.forEach((line) => {
    if (line.trim()) {
      try {
        const response = JSON.parse(line);
        console.log("✅ Received response:", JSON.stringify(response, null, 2));
      } catch (e) {
        console.log("📝 Non-JSON output:", line);
      }
    }
  });
});

server.stderr.on("data", (data) => {
  console.log("📋 [Server Log]:", data.toString().trim());
});

server.on("error", (err) => {
  console.error("❌ Server error:", err);
  process.exit(1);
});

// Send initialize request
setTimeout(() => {
  console.log("\n📤 Sending initialize request...\n");
  const initRequest = {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: {
        name: "test-client",
        version: "1.0.0",
      },
    },
  };

  server.stdin.write(JSON.stringify(initRequest) + "\n");
}, 1000);

// Send tools/list request after initialization
setTimeout(() => {
  console.log("\n📤 Sending tools/list request...\n");
  const toolsListRequest = {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list",
    params: {},
  };

  server.stdin.write(JSON.stringify(toolsListRequest) + "\n");
}, 2000);

// Cleanup after 5 seconds
setTimeout(() => {
  console.log("\n✅ Test complete. Shutting down...");
  server.kill();
  process.exit(0);
}, 5000);
