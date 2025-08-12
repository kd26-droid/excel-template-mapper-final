#!/bin/bash

# Force deployment script - Build and deploy fresh container immediately

set -e

echo "🔄 Force deploying fresh container to Azure..."

# Configuration
RESOURCE_GROUP="excel-mapper-rg-96552"
APP_NAME="excel-mapper-backend-96552"
ACR_NAME="excelmapperregistry96552"
TIMESTAMP=$(date +%s)
IMAGE_TAG="force-deploy-${TIMESTAMP}"

echo "📦 Building fresh container with tag: ${IMAGE_TAG}"

# Build fresh container with no cache
docker build --no-cache --pull \
    --build-arg REACT_APP_API_BASE_URL="https://${APP_NAME}.azurewebsites.net/api" \
    -t excel-template-mapper:${IMAGE_TAG} .

echo "🏷️ Tagging for ACR..."
docker tag excel-template-mapper:${IMAGE_TAG} ${ACR_NAME}.azurecr.io/excel-template-mapper:${IMAGE_TAG}

echo "📤 Pushing to ACR..."
az acr login --name ${ACR_NAME}
docker push ${ACR_NAME}.azurecr.io/excel-template-mapper:${IMAGE_TAG}

echo "🔄 Updating Azure Web App..."
az webapp config container set \
    --resource-group ${RESOURCE_GROUP} \
    --name ${APP_NAME} \
    --container-image-name "${ACR_NAME}.azurecr.io/excel-template-mapper:${IMAGE_TAG}" \
    --container-registry-url "https://${ACR_NAME}.azurecr.io"

echo "♻️ Restarting Azure Web App..."
az webapp restart --resource-group ${RESOURCE_GROUP} --name ${APP_NAME}

echo "⏳ Waiting for deployment to complete..."
sleep 120

echo "🧪 Testing deployment..."
HEALTH_RESPONSE=$(curl -s "https://${APP_NAME}.azurewebsites.net/api/health/" || echo "ERROR")

if echo "$HEALTH_RESPONSE" | grep -q "healthy"; then
    echo "✅ SUCCESS! Application is running"
    echo "🌐 URL: https://${APP_NAME}.azurewebsites.net/"
    
    # Test frontend
    echo "🧪 Testing frontend JavaScript bundle..."
    JS_FILE=$(curl -s "https://${APP_NAME}.azurewebsites.net/" | grep -o "main\.[a-z0-9]*\.js" | head -1)
    if [ -n "$JS_FILE" ]; then
        echo "📄 Frontend JS: ${JS_FILE}"
        FRONTEND_TITLE=$(curl -s "https://${APP_NAME}.azurewebsites.net/static/js/${JS_FILE}" | grep -o "Excel Template Mapper[^\"]*" | head -1)
        echo "🎯 Frontend Title: ${FRONTEND_TITLE}"
    fi
    
    echo "🎉 Deployment completed successfully!"
else
    echo "❌ Health check failed: $HEALTH_RESPONSE"
    echo "🔍 Check logs: az webapp log tail --resource-group ${RESOURCE_GROUP} --name ${APP_NAME}"
    exit 1
fi