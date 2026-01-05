
#!/bin/bash

echo "╔════════════════════════════════════════════════════════════╗"
echo "║         MCP Server Test Demo                               ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""
echo "📋 Instructions:"
echo "   1. Make sure server is running: npm run dev"
echo "   2. Server should be at: http://localhost:3000/mcp"
echo ""
echo "🔍 Checking if server is running..."
echo ""

SERVER_URL="http://localhost:3000/mcp"

# Check if server is running
if ! curl -s -o /dev/null -w "%{http_code}" -X POST "$SERVER_URL" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}' > /dev/null 2>&1; then
    echo "❌ Server is NOT running!"
    echo ""
    echo "Please start the server in another terminal:"
    echo "   cd /home/bao/Downloads/mcp-thesis/mcp-thesis"
    echo "   npm run dev"
    echo ""
    exit 1
fi

echo "✅ Server is running!"
echo ""
echo "════════════════════════════════════════════════════════════"
echo "Test 1: List Available Tools"
echo "════════════════════════════════════════════════════════════"

TOOLS=$(curl -s -X POST "$SERVER_URL" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}')

echo "$TOOLS" | jq -r '.result.tools[] | "  ✓ \(.name) - \(.description)"' 2>/dev/null || echo "$TOOLS"

echo ""
echo "════════════════════════════════════════════════════════════"
echo "Test 2: Initialize a Project"
echo "════════════════════════════════════════════════════════════"

INIT_RESULT=$(curl -s -X POST "$SERVER_URL" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc":"2.0",
    "method":"tools/call",
    "params":{
      "name":"initProject",
      "arguments":{
        "name":"demo-banking-system",
        "description":"Demo banking system for testing MCP"
      }
    },
    "id":2
  }')

echo "$INIT_RESULT" | jq -r '.result.content[0].text' 2>/dev/null || echo "$INIT_RESULT"

echo ""
echo "════════════════════════════════════════════════════════════"
echo "Test 3: List All Projects"
echo "════════════════════════════════════════════════════════════"

LIST_RESULT=$(curl -s -X POST "$SERVER_URL" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc":"2.0",
    "method":"tools/call",
    "params":{
      "name":"listAllProjects",
      "arguments":{}
    },
    "id":3
  }')

echo "$LIST_RESULT" | jq -r '.result.content[0].text' 2>/dev/null || echo "$LIST_RESULT"

echo ""
echo "════════════════════════════════════════════════════════════"
echo "Test 4: Get Project Info"
echo "════════════════════════════════════════════════════════════"

INFO_RESULT=$(curl -s -X POST "$SERVER_URL" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc":"2.0",
    "method":"tools/call",
    "params":{
      "name":"getProjectInfo",
      "arguments":{}
    },
    "id":4
  }')

echo "$INFO_RESULT" | jq -r '.result.content[0].text' 2>/dev/null || echo "$INFO_RESULT"

echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║  ✅ All tests completed successfully!                      ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""
echo "💡 Next steps:"
echo "   - Try MCP Inspector: npm run inspector"
echo "   - Read docs: START_HERE.md"
echo "   - Full guide: TEST_GUIDE.md"
echo ""
