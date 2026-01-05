#!/bin/bash

# Test Docker deployment
echo "🧪 Testing MCP Server Docker Deployment"
echo ""

# Check if services are running
if ! docker-compose -f docker-compose.quick.yml ps | grep -q "Up"; then
    echo "❌ Services not running!"
    echo "   Start with: ./docker-start.sh"
    exit 1
fi

echo "✅ Services are running"
echo ""

# Test local connection
echo "📡 Test 1: Local connection (http://localhost:3000/mcp)"
RESPONSE=$(curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}')

if echo "$RESPONSE" | jq -e '.result.tools' > /dev/null 2>&1; then
    TOOL_COUNT=$(echo "$RESPONSE" | jq '.result.tools | length')
    echo "✅ Local connection successful! Found $TOOL_COUNT tools"
else
    echo "❌ Local connection failed"
    echo "Response: $RESPONSE"
    exit 1
fi

echo ""

# Get tunnel URL
echo "🌐 Test 2: Cloudflare Tunnel"
TUNNEL_URL=$(docker-compose -f docker-compose.quick.yml logs cloudflared 2>/dev/null | grep -oP 'https://\S+\.trycloudflare\.com' | head -1)

if [ -z "$TUNNEL_URL" ]; then
    echo "⚠️  Tunnel URL not found in logs"
    echo "   Wait a few seconds and try: docker-compose -f docker-compose.quick.yml logs cloudflared"
else
    echo "Tunnel URL: $TUNNEL_URL"
    echo "Testing connection..."
    
    TUNNEL_RESPONSE=$(curl -s -X POST "$TUNNEL_URL" \
      -H "Content-Type: application/json" \
      -H "Accept: application/json, text/event-stream" \
      -d '{"jsonrpc":"2.0","method":"tools/list","id":1}')
    
    if echo "$TUNNEL_RESPONSE" | jq -e '.result.tools' > /dev/null 2>&1; then
        echo "✅ Tunnel connection successful!"
    else
        echo "⚠️  Tunnel connection issue"
        echo "Response: $TUNNEL_RESPONSE"
    fi
fi

echo ""
echo "📊 Container Status:"
docker-compose -f docker-compose.quick.yml ps

echo ""
echo "💾 Health Check:"
docker inspect mcp-thesis-server | jq '.[0].State.Health.Status' 2>/dev/null || echo "Health check not available"

echo ""
echo "✅ All tests completed!"
echo ""
echo "🔗 Access your server at:"
echo "   Local:  http://localhost:3000/mcp"
if [ -n "$TUNNEL_URL" ]; then
    echo "   Public: $TUNNEL_URL"
fi
