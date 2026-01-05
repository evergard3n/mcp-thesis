#!/usr/bin/env node
import "dotenv/config";

declare const process: any;

/**
 * Test script for MCP server
 * Run: npx tsx test-mcp.ts
 */

const MCP_SERVER_URL =
  process.env.MCP_SERVER_URL || "http://localhost:3000/mcp";

interface MCPRequest {
  jsonrpc: "2.0";
  method: string;
  params?: any;
  id: number;
}

interface MCPResponse {
  jsonrpc: "2.0";
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
  id: number;
}

async function sendMCPRequest(request: MCPRequest): Promise<MCPResponse> {
  const response = await fetch(MCP_SERVER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  return response.json();
}

async function testListTools() {
  console.log("\n=== Testing: List Tools ===");
  const response = await sendMCPRequest({
    jsonrpc: "2.0",
    method: "tools/list",
    id: 1,
  });

  if (response.error) {
    console.error("❌ Error:", response.error);
    return;
  }

  console.log("✅ Available tools:");
  response.result.tools.forEach((tool: any) => {
    console.log(`  - ${tool.name}: ${tool.description}`);
  });
}

async function testInitProject() {
  console.log("\n=== Testing: Initialize Project ===");
  const response = await sendMCPRequest({
    jsonrpc: "2.0",
    method: "tools/call",
    params: {
      name: "initProject",
      arguments: {
        name: "test-project",
        description: "A test project for MCP",
      },
    },
    id: 2,
  });

  if (response.error) {
    console.error("❌ Error:", response.error);
    return;
  }

  console.log("✅ Project initialized:");
  console.log(response.result.content[0].text);
}

async function testExtractUseCase() {
  console.log("\n=== Testing: Extract Use Case ===");
  const useCaseDescription = `
User Login Use Case:
The user opens the application and enters their username and password.
The system validates the credentials against the database.
If valid, the system creates a session and redirects to the dashboard.
If invalid, the system shows an error message and allows retry.
After 3 failed attempts, the account is temporarily locked.
  `;

  const response = await sendMCPRequest({
    jsonrpc: "2.0",
    method: "tools/call",
    params: {
      name: "extractUseCase",
      arguments: {
        input: useCaseDescription,
      },
    },
    id: 3,
  });

  if (response.error) {
    console.error("❌ Error:", response.error);
    return;
  }

  console.log("✅ Use case extracted:");
  console.log(response.result.content[0].text.substring(0, 500) + "...");
}

async function testGetProjectInfo() {
  console.log("\n=== Testing: Get Project Info ===");
  const response = await sendMCPRequest({
    jsonrpc: "2.0",
    method: "tools/call",
    params: {
      name: "getProjectInfo",
      arguments: {},
    },
    id: 4,
  });

  if (response.error) {
    console.error("❌ Error:", response.error);
    return;
  }

  console.log("✅ Project info:");
  console.log(response.result.content[0].text);
}

async function runAllTests() {
  console.log("🚀 Starting MCP Server Tests...");
  console.log(`Server URL: ${MCP_SERVER_URL}`);

  try {
    // Test 1: List all available tools
    await testListTools();

    // Test 2: Initialize a project
    await testInitProject();

    // Test 3: Get project info
    await testGetProjectInfo();

    // Test 4: Extract use case (requires Gemini API)
    // Uncomment if you want to test with Gemini
    // await testExtractUseCase();

    console.log("\n✅ All tests completed!");
  } catch (error) {
    console.error("\n❌ Test failed:", error);
    process.exit(1);
  }
}

// Run tests
runAllTests();
