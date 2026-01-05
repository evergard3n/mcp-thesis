#!/bin/bash

# Simple shell script to test MCP server endpoints
# Run: chmod +x test-simple.sh && ./test-simple.sh

SERVER_URL="http://localhost:3000/mcp"

echo "🚀 Testing MCP Server at $SERVER_URL"
echo ""

# Test 1: List tools
echo "=== Test 1: List Tools ==="
curl -s -X POST "$SERVER_URL" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/list",
    "id": 1
  }' | jq '.'

echo ""
echo ""

# Test 2: Initialize project
echo "=== Test 2: Initialize Project ==="
curl -s -X POST "$SERVER_URL" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "initProject",
      "arguments": {
        "name": "test-project-001",
        "description": "Test project for MCP server"
      }
    },
    "id": 2
  }' | jq '.'

echo ""
echo ""

# Test 3: List all projects
echo "=== Test 3: List All Projects ==="
curl -s -X POST "$SERVER_URL" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "listAllProjects",
      "arguments": {}
    },
    "id": 3
  }' | jq '.'

echo ""
echo ""

# Test 4: Get project info
echo "=== Test 4: Get Project Info ==="
curl -s -X POST "$SERVER_URL" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "getProjectInfo",
      "arguments": {}
    },
    "id": 4
  }' | jq '.'

echo ""
echo "✅ Tests completed!"
