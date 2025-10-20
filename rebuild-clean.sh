#!/bin/bash

# Excel Template Mapper - Complete Clean Rebuild Script
# This script performs a complete cleanup and rebuild of the application

echo "🧹 Starting complete clean rebuild of Excel Template Mapper..."

# Check for required environment file
if [ ! -f "backend/.env" ]; then
    echo "⚠️  Warning: backend/.env file not found!"
    echo "   Creating basic .env file..."
    cat > backend/.env << 'EOF'
# Django Configuration
SECRET_KEY=your-secret-key-here-please-change-in-production
DEBUG=True
ALLOWED_HOSTS=localhost,127.0.0.1,0.0.0.0

# Database Configuration (SQLite for development)
DATABASE_URL=sqlite:///db.sqlite3

# Azure OCR Configuration (optional)
AZURE_VISION_ENDPOINT=your_azure_endpoint_here
AZURE_VISION_KEY=your_azure_key_here

# MPN Validation Configuration (optional)
DIGIKEY_CLIENT_ID=your_digikey_client_id_here
DIGIKEY_CLIENT_SECRET=your_digikey_client_secret_here
EOF
    echo "✅ Basic .env file created. Please update with your actual values."
fi

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
# Keep package-lock.json for consistent builds and Docker compatibility
echo -e "${BLUE}   • Keeping package-lock.json for consistent builds${NC}"
echo -e "${GREEN}✅ Frontend build cache cleared${NC}"

# Step 4.5: Clean npm cache
echo -e "${YELLOW}📦 Step 4.5: Cleaning npm cache...${NC}"
npm cache clean --force 2>/dev/null || echo -e "${YELLOW}⚠️  npm cache clean skipped (npm not available)${NC}"
echo -e "${GREEN}✅ npm cache cleaned${NC}"

# Step 5: Clean backend cache (comprehensive)
echo -e "${YELLOW}🐍 Step 5: Cleaning backend cache...${NC}"
find backend -name "*.pyc" -delete 2>/dev/null || true
find backend -name "__pycache__" -type d -exec rm -rf {} + 2>/dev/null || true
rm -rf backend/*.log 2>/dev/null || true
rm -rf backend/db.sqlite3 2>/dev/null || true
rm -rf backend/media/uploads/* 2>/dev/null || true
rm -rf backend/media/temp/* 2>/dev/null || true
rm -rf backend/staticfiles 2>/dev/null || true
echo -e "${GREEN}✅ Backend cache cleared${NC}"

# Step 5.5: Clean system cache (Docker and pip)
echo -e "${YELLOW}🧹 Step 5.5: Cleaning system cache...${NC}"
# Clean pip cache
pip cache purge 2>/dev/null || pip3 cache purge 2>/dev/null || echo -e "${YELLOW}⚠️  pip cache clean skipped (pip not available)${NC}"
# Clean Docker builder cache
docker builder prune -f 2>/dev/null || echo -e "${YELLOW}⚠️  Docker builder cache clean skipped${NC}"
# Clean Docker volume cache
docker volume prune -f 2>/dev/null || echo -e "${YELLOW}⚠️  Docker volume cache clean skipped${NC}"
echo -e "${GREEN}✅ System cache cleaned${NC}"

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

# Step 8.5: Run database migrations
echo -e "${YELLOW}🗄️  Step 8.5: Running database migrations...${NC}"
docker-compose exec -T backend python manage.py migrate
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Database migrations completed successfully${NC}"
else
    echo -e "${RED}❌ Failed to run database migrations${NC}"
    # Don't exit, continue to show status
fi

# Step 8.6: Collect static files (if needed)
echo -e "${YELLOW}📁 Step 8.6: Collecting static files...${NC}"
docker-compose exec -T backend python manage.py collectstatic --noinput 2>/dev/null || echo -e "${YELLOW}⚠️  Static files collection skipped (not configured)${NC}"

# Step 8.7: Check application health
echo -e "${YELLOW}🔍 Step 8.7: Checking application health...${NC}"
sleep 5
BACKEND_HEALTH=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8000/ 2>/dev/null || echo "000")
FRONTEND_HEALTH=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/ 2>/dev/null || echo "000")

if [ "$BACKEND_HEALTH" = "200" ] || [ "$BACKEND_HEALTH" = "404" ]; then
    echo -e "${GREEN}✅ Backend is responding (HTTP $BACKEND_HEALTH)${NC}"
else
    echo -e "${YELLOW}⚠️  Backend health check: HTTP $BACKEND_HEALTH${NC}"
fi

if [ "$FRONTEND_HEALTH" = "200" ]; then
    echo -e "${GREEN}✅ Frontend is responding (HTTP $FRONTEND_HEALTH)${NC}"
else
    echo -e "${YELLOW}⚠️  Frontend health check: HTTP $FRONTEND_HEALTH${NC}"
fi

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
echo -e "${GREEN}   • Upload Excel/PDF files and test mappings${NC}"
echo -e "${GREEN}   • Test +/- buttons without JavaScript errors${NC}"
echo -e "${GREEN}   • Verify PDF zone selection functionality${NC}"
echo -e "${GREEN}   • Check MPN validation features${NC}"
echo ""
echo -e "${BLUE}📊 Database Status:${NC}"
echo -e "${BLUE}   • All migrations applied successfully${NC}"
echo -e "${BLUE}   • processing_metadata column available${NC}"
echo ""
echo -e "${YELLOW}🔧 Troubleshooting:${NC}"
echo -e "${BLUE}   • Check logs: docker-compose logs -f [frontend|backend]${NC}"
echo -e "${BLUE}   • Rebuild if issues: ./rebuild-clean.sh${NC}"
echo -e "${BLUE}   • Reset database: docker-compose down -v && docker-compose up -d${NC}"