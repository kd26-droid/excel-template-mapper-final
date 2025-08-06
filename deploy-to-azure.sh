#!/bin/bash

# Excel Template Mapper - Azure Deployment Script
# Author: Kartik (kartik@factwise.io)
# Region: Central India (Pune)
# Date: August 6, 2025

set -e  # Exit on any error

# Configuration Variables
RESOURCE_PREFIX="kartik-excel-mapper"
LOCATION="centralindia"
DB_ADMIN_PASSWORD="ExcelMapper2025!"
GITHUB_REPO="kd26-droid/excel-template-mapper-"

# Derived Names
RESOURCE_GROUP="${RESOURCE_PREFIX}-rg"
APP_SERVICE_PLAN="${RESOURCE_PREFIX}-plan"
BACKEND_APP="${RESOURCE_PREFIX}-backend"
STATIC_WEB_APP="${RESOURCE_PREFIX}-frontend"
DB_SERVER="${RESOURCE_PREFIX}-db-server"
DB_NAME="excel_mapper_db"
STORAGE_ACCOUNT="kartikexcelmapperstorage"  # Must be lowercase, no hyphens

echo "🚀 Starting Azure deployment for Excel Template Mapper..."
echo "📍 Region: Central India (Pune)"
echo "🏷️  Resource Prefix: ${RESOURCE_PREFIX}"
echo "═══════════════════════════════════════════════════"

# Step 1: Login and Set Subscription
echo "🔐 Step 1: Azure Login & Subscription"
az account show > /dev/null 2>&1 || {
    echo "Please login to Azure first:"
    az login
}

SUBSCRIPTION_ID=$(az account show --query id -o tsv)
echo "✅ Using subscription: $SUBSCRIPTION_ID"
echo ""

# Step 2: Create Resource Group
echo "📦 Step 2: Creating Resource Group"
az group create \
    --name $RESOURCE_GROUP \
    --location $LOCATION \
    --tags "Environment=Production" "Project=ExcelMapper" "Owner=Kartik"
echo "✅ Resource Group created: $RESOURCE_GROUP"
echo ""

# Step 3: Create PostgreSQL Database
echo "🗄️  Step 3: Creating PostgreSQL Database"
az postgres flexible-server create \
    --resource-group $RESOURCE_GROUP \
    --name $DB_SERVER \
    --location $LOCATION \
    --admin-user dbadmin \
    --admin-password "$DB_ADMIN_PASSWORD" \
    --sku-name Standard_B2s \
    --tier Burstable \
    --compute-units 2 \
    --storage-size 32 \
    --version 13 \
    --yes

# Create database
az postgres flexible-server db create \
    --resource-group $RESOURCE_GROUP \
    --server-name $DB_SERVER \
    --database-name $DB_NAME

# Configure firewall to allow Azure services
az postgres flexible-server firewall-rule create \
    --resource-group $RESOURCE_GROUP \
    --name $DB_SERVER \
    --rule-name "AllowAzureServices" \
    --start-ip-address 0.0.0.0 \
    --end-ip-address 0.0.0.0

echo "✅ PostgreSQL Database created: $DB_SERVER"
echo ""

# Step 4: Create Storage Account
echo "💾 Step 4: Creating Storage Account"
az storage account create \
    --resource-group $RESOURCE_GROUP \
    --name $STORAGE_ACCOUNT \
    --location $LOCATION \
    --sku Standard_LRS \
    --kind StorageV2 \
    --access-tier Hot

# Create containers
STORAGE_KEY=$(az storage account keys list --resource-group $RESOURCE_GROUP --account-name $STORAGE_ACCOUNT --query "[0].value" -o tsv)

az storage container create \
    --account-name $STORAGE_ACCOUNT \
    --account-key "$STORAGE_KEY" \
    --name "uploaded-files" \
    --public-access off

az storage container create \
    --account-name $STORAGE_ACCOUNT \
    --account-key "$STORAGE_KEY" \
    --name "temp-downloads" \
    --public-access off

echo "✅ Storage Account created: $STORAGE_ACCOUNT"
echo ""

# Step 5: Create App Service Plan
echo "⚙️  Step 5: Creating App Service Plan"
az appservice plan create \
    --resource-group $RESOURCE_GROUP \
    --name $APP_SERVICE_PLAN \
    --location $LOCATION \
    --sku S1 \
    --is-linux \
    --number-of-workers 1

echo "✅ App Service Plan created: $APP_SERVICE_PLAN"
echo ""

# Step 6: Create Backend App Service
echo "🖥️  Step 6: Creating Backend App Service"
az webapp create \
    --resource-group $RESOURCE_GROUP \
    --plan $APP_SERVICE_PLAN \
    --name $BACKEND_APP \
    --runtime "PYTHON:3.11" \
    --startup-file "startup.sh"

# Get backend URL
BACKEND_URL="https://${BACKEND_APP}.azurewebsites.net"
echo "✅ Backend App Service created: $BACKEND_URL"
echo ""

# Step 7: Configure Backend Environment Variables
echo "🔧 Step 7: Configuring Backend Environment Variables"

# Generate secure secret key
SECRET_KEY=$(python3 -c "import secrets; print(secrets.token_urlsafe(50))")

# Database URL
DB_URL="postgresql://dbadmin:${DB_ADMIN_PASSWORD}@${DB_SERVER}.postgres.database.azure.com:5432/${DB_NAME}?sslmode=require"

az webapp config appsettings set \
    --resource-group $RESOURCE_GROUP \
    --name $BACKEND_APP \
    --settings \
        SECRET_KEY="$SECRET_KEY" \
        DEBUG="False" \
        ALLOWED_HOSTS="${BACKEND_APP}.azurewebsites.net" \
        DATABASE_URL="$DB_URL" \
        CORS_ALLOWED_ORIGINS="https://${STATIC_WEB_APP}.azurestaticapps.net" \
        AZURE_STORAGE_ACCOUNT_NAME="$STORAGE_ACCOUNT" \
        AZURE_STORAGE_ACCOUNT_KEY="$STORAGE_KEY" \
        AZURE_STORAGE_CONTAINER_NAME="uploaded-files" \
        MAX_FILE_SIZE_MB="25" \
        SESSION_TIMEOUT_MINUTES="60" \
        LOG_LEVEL="INFO" \
        PYTHONPATH="/home/site/wwwroot" \
        WEBSITES_ENABLE_APP_SERVICE_STORAGE="false"

echo "✅ Backend environment variables configured"
echo ""

# Step 8: Create Static Web App for Frontend
echo "🌐 Step 8: Creating Static Web App for Frontend"
az staticwebapp create \
    --resource-group $RESOURCE_GROUP \
    --name $STATIC_WEB_APP \
    --location $LOCATION \
    --source https://github.com/$GITHUB_REPO \
    --branch main \
    --app-location "/frontend" \
    --build-location "build" \
    --login-with-github

FRONTEND_URL="https://${STATIC_WEB_APP}.azurestaticapps.net"
echo "✅ Static Web App created: $FRONTEND_URL"
echo ""

# Step 9: Update CORS with actual frontend URL
echo "🔄 Step 9: Updating CORS Configuration"
az webapp config appsettings set \
    --resource-group $RESOURCE_GROUP \
    --name $BACKEND_APP \
    --settings \
        CORS_ALLOWED_ORIGINS="$FRONTEND_URL,http://localhost:3000"

echo "✅ CORS updated with frontend URL"
echo ""

# Step 10: Deploy Backend Code
echo "📤 Step 10: Deploying Backend Code"

# Create deployment configuration
cat > /tmp/web.config << EOF
<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <system.webServer>
    <handlers>
      <add name="PythonHandler" path="*" verb="*" modules="httpPlatformHandler" resourceType="Unspecified"/>
    </handlers>
    <httpPlatform processPath="/opt/python/3.11/bin/python"
                  arguments="/home/site/wwwroot/manage.py runserver 0.0.0.0:%HTTP_PLATFORM_PORT%"
                  stdoutLogEnabled="true"
                  stdoutLogFile="/home/LogFiles/python.log"
                  startupTimeLimit="60"
                  requestTimeout="00:04:00">
    </httpPlatform>
  </system.webServer>
</configuration>
EOF

# Enable GitHub Actions deployment
az webapp deployment github-actions add \
    --resource-group $RESOURCE_GROUP \
    --name $BACKEND_APP \
    --repo https://github.com/$GITHUB_REPO \
    --branch main \
    --runtime python \
    --runtime-version 3.11

echo "✅ Backend deployment configured"
echo ""

# Final Step: Display Deployment Information
echo "🎉 DEPLOYMENT COMPLETED SUCCESSFULLY!"
echo "═══════════════════════════════════════════════════"
echo ""
echo "📋 DEPLOYMENT SUMMARY:"
echo "├── 🌐 Frontend URL:  $FRONTEND_URL"
echo "├── 🖥️  Backend URL:   $BACKEND_URL"
echo "├── 🗄️  Database:      ${DB_SERVER}.postgres.database.azure.com"
echo "├── 💾 Storage:       $STORAGE_ACCOUNT"
echo "├── 📍 Region:        Central India (Pune)"
echo "└── 📦 Resource Group: $RESOURCE_GROUP"
echo ""
echo "🔧 NEXT STEPS:"
echo "1. Visit GitHub repo and check Actions tab for deployment progress"
echo "2. Wait 5-10 minutes for initial deployment to complete"
echo "3. Test the application at: $FRONTEND_URL"
echo "4. Backend API health check: $BACKEND_URL/api/health/"
echo ""
echo "🔐 DATABASE CONNECTION INFO:"
echo "├── Server: ${DB_SERVER}.postgres.database.azure.com"
echo "├── Database: $DB_NAME"
echo "├── Username: dbadmin"
echo "└── Password: $DB_ADMIN_PASSWORD"
echo ""
echo "💡 IMPORTANT NOTES:"
echo "- GitHub Actions will handle automatic deployments on code push"
echo "- SSL certificates are automatically managed by Azure"
echo "- All services are in the same resource group for easy management"
echo "- Database backups are automatically configured"
echo ""
echo "✅ Your Excel Template Mapper is now live and accessible worldwide!"
echo "🎯 Anyone can visit $FRONTEND_URL and start using the application!"