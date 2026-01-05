#!/bin/bash

# Build script for Docker
cd "$(dirname "$0")"

echo "🐳 Building Docker images..."
echo "Current directory: $(pwd)"
echo ""

docker compose -f docker-compose.quick.yml build --no-cache

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Build successful!"
    echo ""
    echo "To start: docker compose -f docker-compose.quick.yml up -d"
else
    echo ""
    echo "❌ Build failed! Check errors above."
    exit 1
fi
