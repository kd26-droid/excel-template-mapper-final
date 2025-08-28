#!/bin/bash

# Excel Template Mapper - Complete Clean Rebuild Script
# This script performs a complete cleanup and rebuild of the application

echo "🧹 Starting complete clean rebuild of Excel Template Mapper..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Step 1: Stop and remove all containers, networks, and volumes
echo -e "${YELLOW}📦 Step 1: Stopping and removing containers, networks, and volumes...${NC}"
docker-compose down --volumes --remove-orphans
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Containers stopped and removed${NC}"
else
    echo -e "${RED}❌ Failed to stop containers${NC}"
    exit 1
fi

# Step 2: Remove Docker images
echo -e "${YELLOW}🗑️  Step 2: Removing Docker images...${NC}"
docker rmi excel-template-mapper-final-frontend excel-template-mapper-final-backend 2>/dev/null || true
echo -e "${GREEN}✅ Docker images removed${NC}"

# Step 3: Clean Docker system (remove unused images, containers, networks)
echo -e "${YELLOW}🧽 Step 3: Cleaning Docker system...${NC}"
docker system prune -f
echo -e "${GREEN}✅ Docker system cleaned${NC}"

# Step 4: Clean frontend build cache and dependencies
echo -e "${YELLOW}🗂️  Step 4: Cleaning frontend build cache...${NC}"
rm -rf frontend/build
rm -rf frontend/node_modules/.cache
rm -rf frontend/.eslintcache
echo -e "${GREEN}✅ Frontend build cache cleared${NC}"

# Step 5: Clean backend cache (if any)
echo -e "${YELLOW}🐍 Step 5: Cleaning backend cache...${NC}"
find backend -name "*.pyc" -delete 2>/dev/null || true
find backend -name "__pycache__" -type d -exec rm -rf {} + 2>/dev/null || true
echo -e "${GREEN}✅ Backend cache cleared${NC}"

# Step 6: Rebuild all containers from scratch
echo -e "${YELLOW}🔨 Step 6: Building containers from scratch (this may take a few minutes)...${NC}"
docker-compose build --no-cache
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Containers built successfully${NC}"
else
    echo -e "${RED}❌ Failed to build containers${NC}"
    exit 1
fi

# Step 7: Start the containers
echo -e "${YELLOW}🚀 Step 7: Starting containers...${NC}"
docker-compose up -d
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Containers started successfully${NC}"
else
    echo -e "${RED}❌ Failed to start containers${NC}"
    exit 1
fi

# Step 8: Wait for containers to be healthy
echo -e "${YELLOW}⏳ Step 8: Waiting for containers to become healthy...${NC}"
sleep 15

# Step 9: Check container status
echo -e "${YELLOW}🔍 Step 9: Checking container status...${NC}"
FRONTEND_STATUS=$(docker ps --filter "name=excel-template-mapper-final-frontend-1" --format "{{.Status}}")
BACKEND_STATUS=$(docker ps --filter "name=excel-template-mapper-final-backend-1" --format "{{.Status}}")

echo -e "${BLUE}Frontend Status: ${FRONTEND_STATUS}${NC}"
echo -e "${BLUE}Backend Status: ${BACKEND_STATUS}${NC}"

# Step 10: Show final status and access information
echo ""
echo -e "${GREEN}🎉 REBUILD COMPLETE!${NC}"
echo -e "${GREEN}====================${NC}"
echo -e "${BLUE}📱 Frontend (React): http://localhost:3000${NC}"
echo -e "${BLUE}🔧 Backend (Django): http://localhost:8000${NC}"
echo ""
echo -e "${YELLOW}📋 Quick Commands:${NC}"
echo -e "${BLUE}• View logs: docker-compose logs -f${NC}"
echo -e "${BLUE}• Stop app: docker-compose down${NC}"
echo -e "${BLUE}• Restart: docker-compose restart${NC}"
echo -e "${BLUE}• Check status: docker ps${NC}"
echo ""
echo -e "${GREEN}✨ Application is ready for testing!${NC}"
echo -e "${GREEN}   Upload a file and test the +/- buttons without JavaScript errors.${NC}"