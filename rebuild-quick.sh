#!/bin/bash

# Excel Template Mapper - Quick Rebuild Script
# For when you just need to rebuild after code changes

echo "🔄 Quick rebuild of Excel Template Mapper..."

# Stop containers
echo "⏹️  Stopping containers..."
docker-compose down

# Rebuild only (keep cache for faster builds)
echo "🔨 Rebuilding containers..."
docker-compose build

# Start containers
echo "🚀 Starting containers..."
docker-compose up -d

echo "✅ Quick rebuild complete!"
echo "📱 Access at: http://localhost:3000"