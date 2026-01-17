#!/usr/bin/env node

/**
 * Run RL1 test directly via MCP server stdio
 */

import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { readFileSync } from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log("🚀 Running RL1 HITL Comparison Test\n");

const serverPath = join(__dirname, "build/index.js");
const datasetPath = join(
  __dirname,
  "test-data/dataset-2026-01-04T13-31-06-350Z.json"
);

const server = spawn("node", [serverPath], {
  stdio: ["pipe", "pipe", "pipe"],
  env: { ...process.env },
});

let buffer = "";
let requestId = 1;
let initialized = false;

server.stdout.on("data", (data) => {
  buffer += data.toString();
  const lines = buffer.split("\n");
  buffer = lines.pop() || "";

  lines.forEach((line) => {
    if (line.trim()) {
      try {
        const response = JSON.parse(line);
        console.log(
          "📥 Response:",
          response.id,
          response.result ? "OK" : response.error
        );

        if (response.id === 1 && !initialized) {
          initialized = true;
          console.log("\n✅ Server initialized. Creating project...\n");

          // First create a project
          const initProjectRequest = {
            jsonrpc: "2.0",
            id: 2,
            method: "tools/call",
            params: {
              name: "initProject",
              arguments: {
                name: "RL1-Test-Project",
                description: "Test project for RL1 HITL comparison",
              },
            },
          };

          console.log("📤 Creating project...\n");
          server.stdin.write(JSON.stringify(initProjectRequest) + "\n");
        } else if (response.id === 2) {
          console.log("\n✅ Project created. Starting RL1 test...\n");

          // Now send runHITLComparison request
          const testRequest = {
            jsonrpc: "2.0",
            id: 3,
            method: "tools/call",
            params: {
              name: "runHITLComparison",
              arguments: {
                datasetPath: datasetPath,
                testCaseIds: ["RL1"],
              },
            },
          };

          console.log("📤 Calling runHITLComparison...\n");
          server.stdin.write(JSON.stringify(testRequest) + "\n");
        } else if (response.id === 3) {
          console.log("\n🎉 RL1 Test Complete!");
          console.log("\n📊 Results:");
          if (response.result && response.result.content) {
            response.result.content.forEach((item) => {
              if (item.type === "text") {
                console.log(item.text);
              }
            });
          }

          console.log(
            "\n✅ Check file: test-data/results/hitl-comparison-results.json"
          );
          server.kill();
          process.exit(0);
        }
      } catch (e) {
        // Not JSON
      }
    }
  });
});

server.stderr.on("data", (data) => {
  const msg = data.toString().trim();
  if (msg && !msg.includes("Firestore") && !msg.includes("GrpcConnection")) {
    console.log("📋 [Log]:", msg);
  }
});

server.on("error", (err) => {
  console.error("❌ Server error:", err);
  process.exit(1);
});

// Initialize
setTimeout(() => {
  console.log("📤 Initializing server...\n");
  const initRequest = {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: {
        name: "rl1-test-client",
        version: "1.0.0",
      },
    },
  };

  server.stdin.write(JSON.stringify(initRequest) + "\n");
}, 500);

// Safety timeout - RL1 test can take 5-10 minutes
setTimeout(() => {
  console.log("\n⏱️  Test timeout (10 minutes). Check partial results.");
  server.kill();
  process.exit(1);
}, 600000); // 10 minutes
