#!/bin/bash

# Test script that waits for server to be ready
# Usage: ./test-with-wait.sh

SERVER_URL="http://localhost:3000/mcp"
MAX_RETRIES=10
RETRY_DELAY=1

echo "🚀 Testing MCP Server"
echo "Waiting for server at $SERVER_URL..."

# Wait for server to be ready
for i in $(seq 1 $MAX_RETRIES); do
    if curl -s -o /dev/null -w "%{http_code}" "$SERVER_URL" > /dev/null 2>&1; then
        echo "✅ Server is ready!"
        break
    fi
    if [ $i -eq $MAX_RETRIES ]; then
        echo "❌ Server not responding after $MAX_RETRIES attempts"
        echo ""
        echo "Please start the server in another terminal:"
        echo "  cd /home/bao/Downloads/mcp-thesis/mcp-thesis"
        echo "  npm run dev"
        exit 1
    fi
    echo "Waiting... ($i/$MAX_RETRIES)"
    sleep $RETRY_DELAY
done

echo ""
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
        "name": "test-project-wait",
        "description": "Test project with wait script"
      }
    },
    "id": 2
  }' | jq '.'

echo ""
echo "✅ Tests completed!"
