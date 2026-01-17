#!/usr/bin/env node
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log("🔍 Running evaluateResults for RL1\n");

const serverPath = join(__dirname, "build/index.js");
const resultsPath = join(__dirname, "test-data/results/raw/enhanced-hitl-2026-01-06T08-47-26-916Z.json");
const datasetPath = join(__dirname, "test-data/dataset-2026-01-04T13-31-06-350Z.json");

const server = spawn("node", [serverPath], {
  stdio: ["pipe", "pipe", "pipe"],
  env: { ...process.env },
});

let buffer = "";

server.stdout.on("data", (data) => {
  buffer += data.toString();
  const lines = buffer.split("\n");
  buffer = lines.pop() || "";

  lines.forEach((line) => {
    if (line.trim()) {
      try {
        const response = JSON.parse(line);
        
        if (response.id === 1) {
          console.log("✅ Initialized\n");
          server.stdin.write(JSON.stringify({
            jsonrpc: "2.0", id: 2, method: "tools/call",
            params: { name: "initProject", arguments: { name: "Evaluate-RL1", description: "Evaluation" }}
          }) + "\n");
        } else if (response.id === 2) {
          console.log("✅ Project created\n📤 Calling evaluateResults...\n");
          server.stdin.write(JSON.stringify({
            jsonrpc: "2.0", id: 3, method: "tools/call",
            params: {
              name: "evaluateResults",
              arguments: { resultsPath, datasetPath }
            }
          }) + "\n");
        } else if (response.id === 3) {
          console.log("\n🎉 Evaluation Complete!\n📊 Results:\n");
          if (response.result && response.result.content) {
            response.result.content.forEach((item) => {
              if (item.type === "text") console.log(item.text);
            });
          } else if (response.error) {
            console.log("Error:", response.error.message);
          }
          server.kill();
          process.exit(0);
        }
      } catch (e) {}
    }
  });
});

server.stderr.on("data", (data) => {
  const msg = data.toString().trim();
  if (msg && !msg.includes("Firestore") && !msg.includes("GrpcConnection") && !msg.includes("[LOG]")) {
    console.log("📋", msg);
  }
});

setTimeout(() => {
  console.log("📤 Initializing...\n");
  server.stdin.write(JSON.stringify({
    jsonrpc: "2.0", id: 1, method: "initialize",
    params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "eval", version: "1.0" }}
  }) + "\n");
}, 500);

setTimeout(() => { console.log("\n⏱️ Timeout"); server.kill(); process.exit(1); }, 300000);
