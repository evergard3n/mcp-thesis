#!/usr/bin/env node

const SESSION_ID = `test-session-${Date.now()}`;

async function testServer() {
  console.log('🔍 Testing MCP Server at http://localhost:3006/mcp\n');
  
  try {
    // 1. Initialize
    console.log('📤 Step 1: Initialize connection...');
    const initResponse = await fetch('http://localhost:3006/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'mcp-session-id': SESSION_ID,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'test-client', version: '1.0.0' },
        },
      }),
    });

    if (!initResponse.ok) {
      throw new Error(`HTTP ${initResponse.status}: ${await initResponse.text()}`);
    }

    const initData = await initResponse.json();
    console.log('✅ Initialize OK\n');

    // 2. List tools
    console.log('📤 Step 2: List available tools...');
    const toolsResponse = await fetch('http://localhost:3006/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'mcp-session-id': SESSION_ID,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {},
      }),
    });

    if (!toolsResponse.ok) {
      throw new Error(`HTTP ${toolsResponse.status}: ${await toolsResponse.text()}`);
    }

    const toolsData = await toolsResponse.json();
    console.log('✅ Tools list received\n');
    
    if (toolsData.result && toolsData.result.tools) {
      console.log(`📋 Found ${toolsData.result.tools.length} tools:\n`);
      toolsData.result.tools.forEach((tool, idx) => {
        console.log(`${idx + 1}. ${tool.name}`);
        console.log(`   ${tool.description}`);
        console.log('');
      });
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

testServer();
