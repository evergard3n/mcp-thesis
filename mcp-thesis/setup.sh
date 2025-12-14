#!/bin/bash

# Interactive setup script for Docker deployment
echo "╔════════════════════════════════════════════════════════════╗"
echo "║   🐳 MCP Thesis - Docker Setup Wizard                     ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# Step 1: Check .env file
echo "📝 Step 1/3: Checking .env configuration..."
if [ ! -f .env ]; then
    echo "   ❌ .env file not found!"
    echo "   Creating from template..."
    cp .env.docker .env
    echo "   ✅ .env created!"
    echo ""
    echo "   ⚠️  IMPORTANT: Please add your GEMINI_API_KEY to .env"
    echo "   Run: nano .env"
    echo ""
    exit 1
fi

# Check if GEMINI_API_KEY is set
if grep -q "your_gemini_api_key_here" .env 2>/dev/null || ! grep -q "GEMINI_API_KEY=" .env; then
    echo "   ⚠️  GEMINI_API_KEY not configured in .env"
    echo ""
    read -p "   Do you want to edit .env now? (y/n): " choice
    if [ "$choice" = "y" ]; then
        nano .env
    else
        echo "   Please edit .env manually: nano .env"
        exit 1
    fi
fi

echo "   ✅ Configuration OK!"
echo ""

# Step 2: Build and start
echo "🚀 Step 2/3: Building and starting Docker containers..."
echo "   This may take a few minutes on first run..."
echo ""

docker-compose -f docker-compose.quick.yml up -d --build

if [ $? -ne 0 ]; then
    echo "   ❌ Failed to start containers"
    echo "   Check logs: docker-compose -f docker-compose.quick.yml logs"
    exit 1
fi

echo "   ✅ Containers started!"
echo ""

# Step 3: Wait and get URL
echo "🌐 Step 3/3: Getting Cloudflare Tunnel URL..."
echo "   Waiting for tunnel to initialize..."

# Wait up to 30 seconds for tunnel URL
for i in {1..30}; do
    TUNNEL_URL=$(docker-compose -f docker-compose.quick.yml logs cloudflared 2>/dev/null | grep -oP 'https://\S+\.trycloudflare\.com' | head -1)
    if [ -n "$TUNNEL_URL" ]; then
        break
    fi
    sleep 1
    echo -n "."
done

echo ""
echo ""

if [ -z "$TUNNEL_URL" ]; then
    echo "   ⚠️  Tunnel URL not ready yet"
    echo "   Run this to get URL: docker-compose -f docker-compose.quick.yml logs cloudflared | grep trycloudflare"
else
    echo "   ✅ Tunnel URL ready!"
    echo ""
    echo "╔════════════════════════════════════════════════════════════╗"
    echo "║   🎉 SUCCESS! Your MCP server is now online!              ║"
    echo "╚════════════════════════════════════════════════════════════╝"
    echo ""
    echo "📍 Access URLs:"
    echo "   Local:  http://localhost:3000/mcp"
    echo "   Public: $TUNNEL_URL"
    echo ""
fi

echo "📊 Container Status:"
docker-compose -f docker-compose.quick.yml ps

echo ""
echo "💡 Useful Commands:"
echo "   View logs:       docker-compose -f docker-compose.quick.yml logs -f"
echo "   Stop services:   docker-compose -f docker-compose.quick.yml down"
echo "   Restart:         docker-compose -f docker-compose.quick.yml restart"
echo "   Get URL again:   docker-compose -f docker-compose.quick.yml logs cloudflared | grep trycloudflare"
echo ""
echo "🔗 Claude Desktop Integration:"
echo "   1. Copy the Public URL above"
echo "   2. Edit: ~/Library/Application Support/Claude/claude_desktop_config.json"
echo "   3. Add:"
echo '   {
     "mcpServers": {
       "mcp-thesis": {
         "url": "YOUR_PUBLIC_URL_HERE"
       }
     }
   }'
echo ""
echo "✨ Done! Happy coding! 🚀"
