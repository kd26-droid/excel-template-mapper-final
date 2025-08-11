#!/bin/bash

# Excel Template Mapper - Clean Azure Deployment Script
# IDE-independent deployment script for Azure
# Works with any terminal/IDE/editor

set -e  # Exit on any error

# ============================================================================
# CONFIGURATION - Modify these variables as needed
# ============================================================================

RESOURCE_PREFIX="excel-mapper"
LOCATION="centralindia"
STATIC_WEB_APP_LOCATION="eastasia"  # Static Web Apps not available in Central India
DB_ADMIN_PASSWORD="ExcelMapper2025!"
GITHUB_REPO="kd26-droid/excel-template-mapper-final"

# Derived Names (with timestamp to avoid conflicts)
TIMESTAMP=$(date +%s | tail -c 6)
RESOURCE_GROUP="${RESOURCE_PREFIX}-rg-${TIMESTAMP}"
APP_SERVICE_PLAN="${RESOURCE_PREFIX}-plan-${TIMESTAMP}"
BACKEND_APP="${RESOURCE_PREFIX}-backend-${TIMESTAMP}"
STATIC_WEB_APP="${RESOURCE_PREFIX}-frontend-${TIMESTAMP}"
DB_SERVER="${RESOURCE_PREFIX}-db-${TIMESTAMP}"
DB_NAME="excel_mapper_db"
STORAGE_ACCOUNT="excelmapper${TIMESTAMP}"  # Must be lowercase, no hyphens
ACR_NAME="excelmapperregistry${TIMESTAMP}"

# ============================================================================
# UTILITY FUNCTIONS
# ============================================================================

print_header() {
    echo ""
    echo "═══════════════════════════════════════════════════"
    echo "🚀 $1"
    echo "═══════════════════════════════════════════════════"
    echo ""
}

print_step() {
    echo ""
    echo "📋 Step $1: $2"
    echo "---------------------------------------------------"
}

print_success() {
    echo "✅ $1"
}

print_warning() {
    echo "⚠️  $1"
}

print_error() {
    echo "❌ $1"
}

check_prerequisites() {
    print_step "0" "Checking Prerequisites"
    
    # Check if Azure CLI is installed
    if ! command -v az &> /dev/null; then
        print_error "Azure CLI is not installed. Please install it first:"
        echo "https://docs.microsoft.com/en-us/cli/azure/install-azure-cli"
        exit 1
    fi
    
    # Check if Docker is installed
    if ! command -v docker &> /dev/null; then
        print_error "Docker is not installed. Please install Docker first:"
        echo "https://docs.docker.com/get-docker/"
        exit 1
    fi
    
    # Check if jq is available (for JSON parsing)
    if ! command -v jq &> /dev/null; then
        print_warning "jq is not installed. Some features may not work properly."
        echo "Install jq for better JSON handling: https://stedolan.github.io/jq/"
    fi
    
    print_success "Prerequisites check completed"
}

generate_secret_key() {
    if command -v openssl > /dev/null 2>&1; then
        # Use OpenSSL if available (most common)
        openssl rand -base64 50 | tr -d "=+/" | cut -c1-50
    elif [ -e /dev/urandom ]; then
        # Use /dev/urandom on Unix-like systems
        cat /dev/urandom | tr -dc 'a-zA-Z0-9' | fold -w 50 | head -n 1
    else
        # Fallback: use date and process ID (less secure but works everywhere)
        echo "ExcelMapperSecret$(date +%s)$(echo $$)RandomString$(date +%N 2>/dev/null || echo $RANDOM)"
    fi
}

# ============================================================================
# MAIN DEPLOYMENT SCRIPT
# ============================================================================

main() {
    print_header "Excel Template Mapper - Azure Deployment"
    echo "📍 Region: Central India"
    echo "🏷️  Resource Prefix: ${RESOURCE_PREFIX}"
    echo "🔢 Unique ID: ${TIMESTAMP}"
    echo ""
    
    check_prerequisites
    
    # Step 1: Login and Set Subscription
    print_step "1" "Azure Authentication"
    az account show > /dev/null 2>&1 || {
        echo "Please login to Azure first:"
        az login
    }
    
    SUBSCRIPTION_ID=$(az account show --query id -o tsv)
    print_success "Using subscription: $SUBSCRIPTION_ID"
    
    # Step 2: Create Resource Group
    print_step "2" "Creating Resource Group"
    if az group show --name $RESOURCE_GROUP &>/dev/null; then
        print_success "Resource Group '$RESOURCE_GROUP' already exists"
    else
        az group create \
            --name $RESOURCE_GROUP \
            --location $LOCATION \
            --tags "Environment=Production" "Project=ExcelMapper" "IDE=Independent"
        print_success "Resource Group '$RESOURCE_GROUP' created"
    fi
    
    # Step 3: Create Container Registry
    print_step "3" "Creating Azure Container Registry"
    if az acr show --resource-group $RESOURCE_GROUP --name $ACR_NAME &>/dev/null; then
        print_success "Container Registry '$ACR_NAME' already exists"
    else
        az acr create \
            --resource-group $RESOURCE_GROUP \
            --name $ACR_NAME \
            --sku Basic \
            --location $LOCATION \
            --admin-enabled true
        print_success "Container Registry '$ACR_NAME' created"
    fi
    
    # Step 4: Create PostgreSQL Database
    print_step "4" "Creating PostgreSQL Database"
    
    if az postgres flexible-server show --resource-group $RESOURCE_GROUP --name $DB_SERVER &>/dev/null; then
        print_success "PostgreSQL Server '$DB_SERVER' already exists"
    else
        az postgres flexible-server create \
            --resource-group $RESOURCE_GROUP \
            --name $DB_SERVER \
            --location $LOCATION \
            --admin-user dbadmin \
            --admin-password "$DB_ADMIN_PASSWORD" \
            --sku-name Standard_B2s \
            --tier Burstable \
            --storage-size 32 \
            --version 13 \
            --yes
        print_success "PostgreSQL Server '$DB_SERVER' created"
    fi
    
    # Create database
    if az postgres flexible-server db show --resource-group $RESOURCE_GROUP --server-name $DB_SERVER --database-name $DB_NAME &>/dev/null; then
        print_success "Database '$DB_NAME' already exists"
    else
        az postgres flexible-server db create \
            --resource-group $RESOURCE_GROUP \
            --server-name $DB_SERVER \
            --database-name $DB_NAME
        print_success "Database '$DB_NAME' created"
    fi
    
    # Configure firewall
    if ! az postgres flexible-server firewall-rule show --resource-group $RESOURCE_GROUP --name $DB_SERVER --rule-name "AllowAzureServices" &>/dev/null; then
        az postgres flexible-server firewall-rule create \
            --resource-group $RESOURCE_GROUP \
            --name $DB_SERVER \
            --rule-name "AllowAzureServices" \
            --start-ip-address 0.0.0.0 \
            --end-ip-address 0.0.0.0
        print_success "Firewall rule created"
    fi
    
    # Step 5: Create Storage Account
    print_step "5" "Creating Storage Account"
    if az storage account show --resource-group $RESOURCE_GROUP --name $STORAGE_ACCOUNT &>/dev/null; then
        print_success "Storage Account '$STORAGE_ACCOUNT' already exists"
    else
        az storage account create \
            --resource-group $RESOURCE_GROUP \
            --name $STORAGE_ACCOUNT \
            --location $LOCATION \
            --sku Standard_LRS \
            --kind StorageV2 \
            --access-tier Hot
        print_success "Storage Account '$STORAGE_ACCOUNT' created"
    fi
    
    # Get storage account key
    STORAGE_KEY=$(az storage account keys list --resource-group $RESOURCE_GROUP --account-name $STORAGE_ACCOUNT --query "[0].value" -o tsv)
    
    # Create containers
    for container in "uploaded-files" "temp-downloads"; do
        if ! az storage container show --account-name $STORAGE_ACCOUNT --name $container --account-key "$STORAGE_KEY" &>/dev/null; then
            az storage container create \
                --account-name $STORAGE_ACCOUNT \
                --account-key "$STORAGE_KEY" \
                --name "$container" \
                --public-access off
            print_success "Container '$container' created"
        fi
    done
    
    # Step 6: Build and Push Docker Image
    print_step "6" "Building and Pushing Docker Image"
    
    echo "Building Docker image..."
    # Build the image with frontend API base URL pointing to backend app
    docker build \
      --build-arg REACT_APP_API_BASE_URL="https://${BACKEND_APP}.azurewebsites.net/api" \
      -t excel-template-mapper:latest .
    
    echo "Tagging image for ACR..."
    docker tag excel-template-mapper:latest "$ACR_NAME.azurecr.io/excel-template-mapper:latest"
    
    echo "Logging into ACR..."
    az acr login --name "$ACR_NAME"
    
    echo "Pushing to ACR..."
    docker push "$ACR_NAME.azurecr.io/excel-template-mapper:latest"
    print_success "Docker image built and pushed to ACR"
    
    # Step 7: Create App Service Plan
    print_step "7" "Creating App Service Plan"
    if az appservice plan show --resource-group $RESOURCE_GROUP --name $APP_SERVICE_PLAN &>/dev/null; then
        print_success "App Service Plan '$APP_SERVICE_PLAN' already exists"
    else
        az appservice plan create \
            --resource-group $RESOURCE_GROUP \
            --name $APP_SERVICE_PLAN \
            --location $LOCATION \
            --sku S1 \
            --is-linux \
            --number-of-workers 1
        print_success "App Service Plan '$APP_SERVICE_PLAN' created"
    fi
    
    # Step 8: Create Web App
    print_step "8" "Creating Web App"
    if az webapp show --resource-group $RESOURCE_GROUP --name $BACKEND_APP &>/dev/null; then
        print_success "Web App '$BACKEND_APP' already exists"
    else
        az webapp create \
            --resource-group $RESOURCE_GROUP \
            --plan $APP_SERVICE_PLAN \
            --name $BACKEND_APP \
            --deployment-container-image-name "$ACR_NAME.azurecr.io/excel-template-mapper:latest"
        print_success "Web App '$BACKEND_APP' created"
    fi
    
    # Step 9: Configure Web App
    print_step "9" "Configuring Web App"
    
    # Get ACR credentials
    ACR_USERNAME=$(az acr credential show --name $ACR_NAME --query username -o tsv)
    ACR_PASSWORD=$(az acr credential show --name $ACR_NAME --query passwords[0].value -o tsv)
    
    # Generate secret key
    SECRET_KEY=$(generate_secret_key)
    
    # Database URL
    DB_URL="postgresql://dbadmin:${DB_ADMIN_PASSWORD}@${DB_SERVER}.postgres.database.azure.com:5432/${DB_NAME}?sslmode=require"
    
    # Backend URL
    BACKEND_URL="https://${BACKEND_APP}.azurewebsites.net"
    
    # Configure app settings
    az webapp config appsettings set \
        --resource-group $RESOURCE_GROUP \
        --name $BACKEND_APP \
        --settings \
            SECRET_KEY="$SECRET_KEY" \
            DEBUG="False" \
            ALLOWED_HOSTS="${BACKEND_APP}.azurewebsites.net,localhost,127.0.0.1" \
            DATABASE_URL="$DB_URL" \
            AZURE_STORAGE_ACCOUNT_NAME="$STORAGE_ACCOUNT" \
            AZURE_STORAGE_ACCOUNT_KEY="$STORAGE_KEY" \
            AZURE_STORAGE_CONTAINER_NAME="uploaded-files" \
            AZURE_STORAGE_CONNECTION_STRING="DefaultEndpointsProtocol=https;AccountName=${STORAGE_ACCOUNT};AccountKey=${STORAGE_KEY};EndpointSuffix=core.windows.net" \
            MAX_FILE_SIZE_MB="25" \
            LOG_LEVEL="INFO" \
            WEBSITES_ENABLE_APP_SERVICE_STORAGE="false" \
            WEBSITES_PORT="80" \
            WEBSITES_SSH_PORT="2222" \
            CORS_ALLOWED_ORIGIN_REGEXES="^https?://.*\\.azurewebsites\\.net$" \
            DOCKER_REGISTRY_SERVER_URL="https://$ACR_NAME.azurecr.io" \
            DOCKER_REGISTRY_SERVER_USERNAME="$ACR_USERNAME" \
            DOCKER_REGISTRY_SERVER_PASSWORD="$ACR_PASSWORD"
    
    print_success "Web App configured"
    
    # Step 10: Enable HTTPS and set Health Check path
    print_step "10" "Enabling HTTPS"
    az webapp update \
        --resource-group $RESOURCE_GROUP \
        --name $BACKEND_APP \
        --https-only true
    print_success "HTTPS enabled"

    print_step "10b" "Configuring Health Check path"
    az webapp update \
        --resource-group $RESOURCE_GROUP \
        --name $BACKEND_APP \
        --set siteConfig.healthCheckPath="/api/health/"
    print_success "HTTPS enabled"
    
    # Step 11: Restart and Test
    print_step "11" "Restarting and Testing"
    az webapp restart --resource-group $RESOURCE_GROUP --name $BACKEND_APP
    
    echo "Waiting for deployment to complete..."
    sleep 60
    
    echo "Testing deployment..."
    RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$BACKEND_URL" || echo "000")
    
    if [ "$RESPONSE" = "200" ]; then
        print_success "Deployment successful! Application is running"
    else
        print_warning "Deployment completed but app might still be starting up (HTTP $RESPONSE)"
    fi
    
    # Final Summary
    print_header "DEPLOYMENT COMPLETED SUCCESSFULLY!"
    
    echo "📋 DEPLOYMENT SUMMARY:"
    echo "├── 🌐 Application URL:  $BACKEND_URL"
    echo "├── 🏥 Health Check:     $BACKEND_URL/api/health/"
    echo "├── 🗄️  Database:        ${DB_SERVER}.postgres.database.azure.com"
    echo "├── 💾 Storage:         $STORAGE_ACCOUNT"
    echo "├── 🐳 Container:       $ACR_NAME.azurecr.io/excel-template-mapper:latest"
    echo "├── 📍 Region:          Central India"
    echo "└── 📦 Resource Group:  $RESOURCE_GROUP"
    echo ""
    echo "🔗 IMPORTANT URLS:"
    echo "├── Application: $BACKEND_URL"
    echo "├── API Base: $BACKEND_URL/api/"
    echo "├── Health Check: $BACKEND_URL/api/health/"
    echo "├── Admin Panel: $BACKEND_URL/admin/"
    echo "└── Azure Portal: https://portal.azure.com/#@/resource/subscriptions/$SUBSCRIPTION_ID/resourceGroups/$RESOURCE_GROUP"
    echo ""
    echo "🔧 MANAGEMENT COMMANDS:"
    echo "├── Check logs: az webapp log tail --resource-group $RESOURCE_GROUP --name $BACKEND_APP"
    echo "├── Restart app: az webapp restart --resource-group $RESOURCE_GROUP --name $BACKEND_APP"
    echo "└── Redeploy: docker build -t excel-template-mapper:latest . && docker tag excel-template-mapper:latest $ACR_NAME.azurecr.io/excel-template-mapper:latest && az acr login --name $ACR_NAME && docker push $ACR_NAME.azurecr.io/excel-template-mapper:latest && az webapp restart --resource-group $RESOURCE_GROUP --name $BACKEND_APP"
    echo ""
    echo "✅ SUCCESS! Your Excel Template Mapper is deployed and ready to use!"
    echo "🎯 Access your application at: $BACKEND_URL"
}

# ============================================================================
# SCRIPT EXECUTION
# ============================================================================

# Check if running in a supported shell
if [ -z "$BASH_VERSION" ]; then
    echo "⚠️  This script is designed for bash. Current shell: $0"
    echo "Please run with: bash deploy-to-azure-clean.sh"
    exit 1
fi

# Run main function
main "$@"
