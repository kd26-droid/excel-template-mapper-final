#!/bin/bash

# Excel Template Mapper - Fresh Deployment Script
# This script completely rebuilds and deploys your application with fresh code

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
NC='\033[0m' # No Color

# Configuration
REGISTRY_NAME="excelmapperacr20994"
REGISTRY_URL="${REGISTRY_NAME}.azurecr.io"
IMAGE_NAME="excel-template-mapper"
WEBAPP_NAME="excel-mapper-backend-211640"
RESOURCE_GROUP="excel-mapper-rg-new"

echo -e "${PURPLE}🚀 Excel Template Mapper - Fresh Deployment Script${NC}"
echo -e "${PURPLE}=================================================${NC}"
echo ""

# Step 1: Get tag name from user
echo -e "${BLUE}📝 Step 1: Tag Selection${NC}"
echo -e "${YELLOW}Please enter a tag name for your deployment:${NC}"
echo -e "${YELLOW}Examples: kartik-v2, mapping-fix-final, production-ready${NC}"
read -p "Tag name: " TAG_NAME

if [ -z "$TAG_NAME" ]; then
    echo -e "${RED}❌ Tag name cannot be empty!${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Using tag: ${TAG_NAME}${NC}"
echo ""

# Step 2: Check if Docker is running
echo -e "${BLUE}📝 Step 2: Docker Status Check${NC}"
if ! docker info >/dev/null 2>&1; then
    echo -e "${RED}❌ Docker is not running. Please start Docker Desktop.${NC}"
    exit 1
fi
echo -e "${GREEN}✅ Docker is running${NC}"
echo ""

# Step 3: Clean up existing containers and images
echo -e "${BLUE}🧹 Step 3: Cleaning up existing Docker resources${NC}"

echo -e "${YELLOW}Stopping and removing containers...${NC}"
docker-compose down --volumes --remove-orphans 2>/dev/null || true

echo -e "${YELLOW}Removing old images...${NC}"
docker rmi excel-template-mapper-final-frontend excel-template-mapper-final-backend 2>/dev/null || true
docker rmi ${REGISTRY_URL}/${IMAGE_NAME}:${TAG_NAME} 2>/dev/null || true

echo -e "${YELLOW}Cleaning Docker system (removing unused images, containers, networks)...${NC}"
docker system prune -f

echo -e "${YELLOW}Removing build cache...${NC}"
docker builder prune -f

echo -e "${GREEN}✅ Docker cleanup complete${NC}"
echo ""

# Step 4: Clean build artifacts
echo -e "${BLUE}🗂️  Step 4: Cleaning build artifacts${NC}"

echo -e "${YELLOW}Cleaning frontend build cache...${NC}"
rm -rf frontend/build 2>/dev/null || true
rm -rf frontend/node_modules/.cache 2>/dev/null || true
rm -rf frontend/.eslintcache 2>/dev/null || true

echo -e "${YELLOW}Cleaning backend cache...${NC}"
find backend -name "*.pyc" -delete 2>/dev/null || true
find backend -name "__pycache__" -type d -exec rm -rf {} + 2>/dev/null || true

echo -e "${GREEN}✅ Build artifacts cleaned${NC}"
echo ""

# Step 5: Build new Docker image
echo -e "${BLUE}🔨 Step 5: Building fresh Docker image${NC}"
echo -e "${YELLOW}Building: ${REGISTRY_URL}/${IMAGE_NAME}:${TAG_NAME}${NC}"
echo -e "${YELLOW}This may take several minutes...${NC}"

if docker build --platform linux/amd64 --no-cache -t ${REGISTRY_URL}/${IMAGE_NAME}:${TAG_NAME} -f Dockerfile .; then
    echo -e "${GREEN}✅ Docker image built successfully${NC}"
else
    echo -e "${RED}❌ Docker build failed!${NC}"
    exit 1
fi
echo ""

# Step 6: Login to Azure Container Registry
echo -e "${BLUE}🔐 Step 6: Azure Container Registry Login${NC}"
if az acr login --name ${REGISTRY_NAME}; then
    echo -e "${GREEN}✅ Successfully logged in to ACR${NC}"
else
    echo -e "${RED}❌ Failed to login to ACR. Please check your Azure credentials.${NC}"
    exit 1
fi
echo ""

# Step 7: Push to Azure Container Registry
echo -e "${BLUE}📦 Step 7: Pushing to Azure Container Registry${NC}"
echo -e "${YELLOW}Pushing: ${REGISTRY_URL}/${IMAGE_NAME}:${TAG_NAME}${NC}"

if docker push ${REGISTRY_URL}/${IMAGE_NAME}:${TAG_NAME}; then
    echo -e "${GREEN}✅ Image pushed successfully to ACR${NC}"
else
    echo -e "${RED}❌ Failed to push image to ACR${NC}"
    exit 1
fi
echo ""

# Step 8: Update Azure Web App
echo -e "${BLUE}🔄 Step 8: Updating Azure Web App${NC}"
echo -e "${YELLOW}Updating ${WEBAPP_NAME} to use new image...${NC}"

# Update the Linux FX Version
if az webapp config set --name ${WEBAPP_NAME} --resource-group ${RESOURCE_GROUP} --linux-fx-version "DOCKER|${REGISTRY_URL}/${IMAGE_NAME}:${TAG_NAME}" >/dev/null; then
    echo -e "${GREEN}✅ Web app configuration updated${NC}"
else
    echo -e "${RED}❌ Failed to update web app configuration${NC}"
    exit 1
fi

# Restart the web app
echo -e "${YELLOW}Restarting web app to deploy new image...${NC}"
if az webapp restart --name ${WEBAPP_NAME} --resource-group ${RESOURCE_GROUP} >/dev/null; then
    echo -e "${GREEN}✅ Web app restarted${NC}"
else
    echo -e "${RED}❌ Failed to restart web app${NC}"
    exit 1
fi
echo ""

# Step 9: Wait for deployment and verify
echo -e "${BLUE}⏳ Step 9: Verifying deployment${NC}"
echo -e "${YELLOW}Waiting for application to start up (this may take 1-2 minutes)...${NC}"

# Wait for the application to be ready
RETRY_COUNT=0
MAX_RETRIES=12  # 12 * 10 seconds = 2 minutes

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    sleep 10
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" https://${WEBAPP_NAME}.azurewebsites.net/api/health/ || echo "000")
    
    if [ "$HTTP_CODE" = "200" ]; then
        echo -e "${GREEN}✅ Application is running successfully!${NC}"
        break
    else
        RETRY_COUNT=$((RETRY_COUNT + 1))
        echo -e "${YELLOW}Waiting... (attempt $RETRY_COUNT/$MAX_RETRIES, status: $HTTP_CODE)${NC}"
    fi
done

if [ $RETRY_COUNT -eq $MAX_RETRIES ]; then
    echo -e "${RED}⚠️  Application may still be starting up. Please check manually.${NC}"
fi
echo ""

# Step 10: Display results
echo -e "${BLUE}📋 Step 10: Deployment Summary${NC}"
echo -e "${GREEN}🎉 DEPLOYMENT COMPLETE!${NC}"
echo -e "${GREEN}=====================${NC}"
echo ""
echo -e "${BLUE}📦 Image Details:${NC}"
echo -e "  Registry: ${REGISTRY_URL}"
echo -e "  Repository: ${IMAGE_NAME}"
echo -e "  Tag: ${TAG_NAME}"
echo -e "  Full Image: ${REGISTRY_URL}/${IMAGE_NAME}:${TAG_NAME}"
echo ""
echo -e "${BLUE}🌐 Application URLs:${NC}"
echo -e "  Frontend: https://${WEBAPP_NAME}.azurewebsites.net"
echo -e "  Backend API: https://${WEBAPP_NAME}.azurewebsites.net/api/"
echo -e "  Health Check: https://${WEBAPP_NAME}.azurewebsites.net/api/health/"
echo ""
echo -e "${BLUE}🔧 Useful Commands:${NC}"
echo -e "  Check logs: az webapp log tail --name ${WEBAPP_NAME} --resource-group ${RESOURCE_GROUP}"
echo -e "  Check status: az webapp show --name ${WEBAPP_NAME} --resource-group ${RESOURCE_GROUP}"
echo -e "  View in portal: https://portal.azure.com"
echo ""

# Step 11: Verify tag in registry
echo -e "${BLUE}🔍 Step 11: Verifying tag in registry${NC}"
if az acr repository show-tags --name ${REGISTRY_NAME} --repository ${IMAGE_NAME} --output table | grep -q "^${TAG_NAME}$"; then
    echo -e "${GREEN}✅ Tag '${TAG_NAME}' confirmed in registry${NC}"
else
    echo -e "${YELLOW}⚠️  Tag may still be processing in registry${NC}"
fi
echo ""

echo -e "${PURPLE}✨ Your fresh deployment with tag '${TAG_NAME}' is ready for testing!${NC}"
echo -e "${PURPLE}   Test your sessionStorage mapping persistence fixes now.${NC}"
echo ""

# Optional: Open the application in browser (uncomment if desired)
# echo -e "${YELLOW}Opening application in browser...${NC}"
# open "https://${WEBAPP_NAME}.azurewebsites.net" 2>/dev/null || true