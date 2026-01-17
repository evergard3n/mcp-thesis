#!/usr/bin/env node

/**
 * Test script to run HITL Comparison for RL1 test case
 * This will run the enhanced HITL framework and then evaluate results
 */

import { readFile } from "fs/promises";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Import necessary modules
const datasetPath = join(
  __dirname,
  "test-data/dataset-2026-01-04T13-31-06-350Z.json"
);
const testCaseId = "RL1";

console.log("🚀 Running HITL Comparison for test case:", testCaseId);
console.log("📁 Dataset path:", datasetPath);
console.log("");

// Read dataset
const dataset = JSON.parse(await readFile(datasetPath, "utf-8"));
const testCase = dataset.testCases.find((tc) => tc.id === testCaseId);

if (!testCase) {
  console.error("❌ Test case not found:", testCaseId);
  process.exit(1);
}

console.log("✅ Test case found:");
console.log("   ID:", testCase.id);
console.log("   Domain:", testCase.domain);
console.log("   Complexity:", testCase.metadata.complexity);
console.log("   Expected flows:", testCase.metadata.expectedFlows);
console.log("");

// Display vague input
console.log("📝 Vague input:");
console.log(testCase.inputs.vague.substring(0, 200) + "...");
console.log("");

// Instructions for MCP Inspector
console.log("=".repeat(80));
console.log("🔧 TO RUN THIS TEST:");
console.log("=".repeat(80));
console.log("");
console.log("1. MCP Inspector should be running at:");
console.log("   http://localhost:6274");
console.log("");
console.log("2. In the Inspector, select tool: runHITLComparison");
console.log("");
console.log("3. Use these parameters:");
console.log("");
console.log(
  JSON.stringify(
    {
      datasetPath: datasetPath,
      testCaseIds: [testCaseId],
    },
    null,
    2
  )
);
console.log("");
console.log("4. Click 'Call Tool' and wait (this may take several minutes)");
console.log("");
console.log("5. After completion, run tool: evaluateResults");
console.log("");
console.log("6. Parameters for evaluateResults:");
console.log("");
console.log(
  JSON.stringify(
    {
      resultPath: join(
        __dirname,
        "test-data/results/hitl-comparison-results.json"
      ),
      groundTruthPath: datasetPath,
    },
    null,
    2
  )
);
console.log("");
console.log("=".repeat(80));
console.log("");

// Alternative: Direct execution instruction
console.log("🎯 ALTERNATIVE - Run via terminal:");
console.log("=".repeat(80));
console.log("");
console.log("The MCP server is stdio-based, so direct tool calling requires");
console.log("a client like Claude Desktop or using the Inspector UI.");
console.log("");
console.log(
  "For automated testing, check: test-data/results/ folder after running"
);
console.log("");
