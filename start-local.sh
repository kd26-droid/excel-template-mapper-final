#!/bin/bash
# Start Excel Template Mapper locally with Docker

echo "🚀 Starting Excel Template Mapper locally with Docker..."
echo ""

# Check if Docker is running
if ! docker info >/dev/null 2>&1; then
    echo "❌ Docker is not running. Please start Docker first."
    exit 1
fi

# Stop any existing containers
echo "🧹 Stopping existing containers..."
docker-compose down

# Build and start services
echo "🏗️  Building and starting services..."
docker-compose up --build -d

echo ""
echo "✅ Services are starting up..."
echo ""
echo "📊 Frontend: http://localhost:3000"
echo "🔧 Backend API: http://localhost:8000/api/"
echo ""
echo "⏳ Please wait about 30-60 seconds for services to be fully ready"
echo ""
echo "📋 To view logs:"
echo "   docker-compose logs -f"
echo ""
echo "🛑 To stop services:"
echo "   docker-compose down"
echo ""

# Wait a bit and check health
sleep 10
echo "🔍 Checking service health..."

# Check backend health
if curl -s http://localhost:8000/api/health/ >/dev/null 2>&1; then
    echo "✅ Backend is healthy"
else
    echo "⚠️  Backend is still starting up..."
fi

# Check frontend
if curl -s http://localhost:3000 >/dev/null 2>&1; then
    echo "✅ Frontend is running"
else
    echo "⚠️  Frontend is still starting up..."
fi

echo ""
echo "🎉 Setup complete! Open http://localhost:3000 in your browser"