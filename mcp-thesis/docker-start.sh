#!/bin/bash

# Quick start script for Docker + Cloudflare
echo "🐳 MCP Thesis - Docker Quick Start"
echo ""

# Check if .env exists
if [ ! -f .env ]; then
    echo "📝 Creating .env file from template..."
    cp .env.docker .env
    echo "✅ .env created!"
    echo ""
    echo "⚠️  IMPORTANT: Please edit .env and add your GEMINI_API_KEY"
    echo "   Run: nano .env"
    echo ""
    read -p "Press Enter after you've added your API key..."
fi

# Check if GEMINI_API_KEY is set
if grep -q "your_gemini_api_key_here" .env; then
    echo "❌ Error: GEMINI_API_KEY not set in .env"
    echo "   Please edit .env and add your Gemini API key"
    exit 1
fi

echo "🚀 Starting MCP Server with Cloudflare Quick Tunnel..."
echo ""

# Build and start services
docker-compose -f docker-compose.quick.yml up -d --build

echo ""
echo "⏳ Waiting for services to start..."
sleep 5

# Check if services are running
if docker-compose -f docker-compose.quick.yml ps | grep -q "Up"; then
    echo "✅ Services are running!"
    echo ""
    
    # Get tunnel URL
    echo "🌐 Getting Cloudflare Tunnel URL..."
    sleep 3
    docker-compose -f docker-compose.quick.yml logs cloudflared | grep -oP 'https://\S+\.trycloudflare\.com' | head -1
    
    echo ""
    echo "📊 Service Status:"
    docker-compose -f docker-compose.quick.yml ps
    
    echo ""
    echo "💡 Useful commands:"
    echo "   View logs:       docker-compose -f docker-compose.quick.yml logs -f"
    echo "   Stop services:   docker-compose -f docker-compose.quick.yml down"
    echo "   Restart:         docker-compose -f docker-compose.quick.yml restart"
    echo ""
    echo "🎉 Setup complete! Your MCP server is now accessible via Cloudflare tunnel!"
else
    echo "❌ Error: Services failed to start"
    echo "   Check logs: docker-compose -f docker-compose.quick.yml logs"
    exit 1
fi
