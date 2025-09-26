#!/bin/bash

# Script to start the Excel Template Mapper Docker application

echo "🚀 Starting Excel Template Mapper Docker Application..."

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
  echo "❌ Docker is not running. Please start Docker Desktop or Docker daemon first."
  echo "   On macOS, you can start Docker Desktop from the Applications folder."
  echo "   On Linux, you can start the Docker daemon with 'sudo systemctl start docker'."
  exit 1
fi

# Check if the image exists
if ! docker image inspect excel-template-mapper:latest > /dev/null 2>&1; then
  echo "🔄 Building Docker image..."
  docker build -t excel-template-mapper:latest .
  if [ $? -ne 0 ]; then
    echo "❌ Failed to build Docker image. Please check the error messages above."
    exit 1
  fi
fi

# Start the application with docker-compose
echo "🔄 Starting containers with docker-compose..."
docker-compose up -d

if [ $? -ne 0 ]; then
  echo "❌ Failed to start containers. Please check the error messages above."
  exit 1
fi

# Check if the container is running
if docker ps | grep -q excel-template-mapper; then
  echo "✅ Excel Template Mapper is now running!"
  echo "📱 Access the application at: http://localhost:8080"
  echo ""
  echo "To view logs: docker logs excel-template-mapper"
  echo "To stop the application: docker-compose down"
else
  echo "❌ Container is not running. Please check the logs with: docker logs excel-template-mapper"
  exit 1
fi