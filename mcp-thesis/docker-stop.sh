#!/bin/bash

# Stop Docker services
echo "🛑 Stopping MCP Server Docker services..."
echo ""

# Stop quick tunnel version
if docker-compose -f docker-compose.quick.yml ps | grep -q "Up"; then
    echo "Stopping quick tunnel services..."
    docker-compose -f docker-compose.quick.yml down
fi

# Stop production version
if docker-compose ps | grep -q "Up"; then
    echo "Stopping production services..."
    docker-compose down
fi

echo ""
echo "✅ All services stopped!"
echo ""
echo "💡 To start again:"
echo "   Quick tunnel:  ./docker-start.sh"
echo "   Production:    docker-compose up -d"
