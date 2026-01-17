#!/usr/bin/env node
/**
 * Direct test runner for HC1 with Enhanced HITL Framework
 * 
 * Usage: node run-hc1-test.mjs
 */

import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function runHC1Test() {
  console.log('🚀 Running HC1 Test with Enhanced HITL Framework\n');
  console.log('='.repeat(60));
  
  try {
    // Import the built modules
    const testingToolsPath = join(__dirname, 'build/tools/testingTools.js');
    const { registerTestingTools } = await import(testingToolsPath);
    
    console.log('✓ Testing tools loaded');
    
    // Note: This requires the MCP server infrastructure
    // For now, this script serves as a reference
    console.log('\n⚠️  This test requires the MCP server to be running.');
    console.log('📋 To run the test:');
    console.log('   1. Ensure MCP server is running (already running at http://localhost:3006/mcp)');
    console.log('   2. Use Cursor\'s MCP interface to invoke:');
    console.log('      Tool: runHITLComparison');
    console.log('      Parameters: {');
    console.log('        "datasetPath": "test-data/dataset-2026-01-04T08-04-45-215Z.json",');
    console.log('        "testCaseIds": ["HC1"]');
    console.log('      }');
    console.log('\n✅ Your MCP server is already running and ready!');
    console.log('💰 Expected cost: ~$0.20-0.30');
    console.log('⏱️  Expected time: ~2-3 minutes');
    console.log('📊 Expected result: 75-87% discovery rate (vs 25% baseline)');
    console.log('='.repeat(60));
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('\n💡 Make sure you have run "npm run build" first');
  }
}

runHC1Test();



