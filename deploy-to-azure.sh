#!/bin/bash

# Azure deployment script for Excel Template Mapper
# This script handles seamless redeployment to Azure

set -e

# Configuration variables
RESOURCE_GROUP="excel-mapper-rg-1754659608"
ACR_NAME="excelmapperregistry59636"
WEB_APP="excel-mapper-app-59857"
STORAGE_ACCOUNT="excelmapperstorage59658"

echo "🚀 Starting Azure deployment for Excel Template Mapper..."

# Step 1: Build and tag Docker image
echo "📦 Building Docker image..."
docker build -t excel-template-mapper:latest .

# Step 2: Tag for Azure Container Registry
echo "🏷️  Tagging image for ACR..."
docker tag excel-template-mapper:latest "$ACR_NAME.azurecr.io/excel-template-mapper:latest"

# Step 3: Push to Azure Container Registry
echo "⬆️  Pushing to Azure Container Registry..."
az acr login --name "$ACR_NAME"
docker push "$ACR_NAME.azurecr.io/excel-template-mapper:latest"

# Step 4: Restart Web App to pull new image
echo "🔄 Restarting Azure Web App..."
az webapp restart --resource-group "$RESOURCE_GROUP" --name "$WEB_APP"

# Step 5: Wait for deployment and test
echo "⏱️  Waiting for deployment to complete..."
sleep 30

echo "🧪 Testing deployment..."
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "https://$WEB_APP.azurewebsites.net" || echo "000")

if [ "$RESPONSE" = "200" ]; then
    echo "✅ Deployment successful! Application is running."
    echo "🌐 Application URL: https://$WEB_APP.azurewebsites.net"
    echo "📊 API Health Check: https://$WEB_APP.azurewebsites.net/api/health/"
else
    echo "⚠️  Deployment completed but app is still starting up (HTTP $RESPONSE)"
    echo "🔗 Application URL: https://$WEB_APP.azurewebsites.net"
    echo "📋 Check logs: az webapp log tail --resource-group $RESOURCE_GROUP --name $WEB_APP"
fi

echo "
🎯 DEPLOYMENT COMPLETED!

📄 Application Details:
- Frontend: https://$WEB_APP.azurewebsites.net
- API Base: https://$WEB_APP.azurewebsites.net/api/
- Resource Group: $RESOURCE_GROUP
- Container Registry: $ACR_NAME.azurecr.io
- Storage Account: $STORAGE_ACCOUNT

🔧 Management Commands:
- Check logs: az webapp log tail --resource-group $RESOURCE_GROUP --name $WEB_APP
- Restart app: az webapp restart --resource-group $RESOURCE_GROUP --name $WEB_APP
- Scale up: az appservice plan update --resource-group $RESOURCE_GROUP --name excel-mapper-plan-59836 --sku S1

🔄 To redeploy after changes:
./deploy-to-azure.sh
"
