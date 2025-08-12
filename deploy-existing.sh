#!/bin/bash

# Excel Template Mapper - Deploy to Existing Azure Resources
# This script deploys updates to the existing deployment at excel-mapper-backend-96552

set -e  # Exit on any error

# ============================================================================
# CONFIGURATION - Based on your existing deployment
# ============================================================================

RESOURCE_PREFIX="excel-mapper"
LOCATION="centralindia"
TIMESTAMP="96552"  # Your existing deployment timestamp

# Existing Resource Names
RESOURCE_GROUP="${RESOURCE_PREFIX}-rg-${TIMESTAMP}"
APP_SERVICE_PLAN="${RESOURCE_PREFIX}-plan-${TIMESTAMP}"
BACKEND_APP="${RESOURCE_PREFIX}-backend-${TIMESTAMP}"  # excel-mapper-backend-96552
DB_SERVER="${RESOURCE_PREFIX}-db-${TIMESTAMP}"
DB_NAME="excel_mapper_db"
STORAGE_ACCOUNT="excelmapper${TIMESTAMP}"
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
    
    print_success "Prerequisites check completed"
}

# ============================================================================
# MAIN DEPLOYMENT SCRIPT
# ============================================================================

main() {
    print_header "Excel Template Mapper - Deploy to Existing Azure Resources"
    echo "📍 Target: https://${BACKEND_APP}.azurewebsites.net/"
    echo "🏷️  Resource Group: ${RESOURCE_GROUP}"
    echo "🐳 Container Registry: ${ACR_NAME}"
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
    
    # Step 2: Verify existing resources
    print_step "2" "Verifying Existing Resources"
    
    # Check resource group
    if ! az group show --name $RESOURCE_GROUP &>/dev/null; then
        print_error "Resource Group '$RESOURCE_GROUP' not found!"
        echo "Expected: ${RESOURCE_GROUP}"
        echo "Please check your existing deployment or update the script."
        exit 1
    fi
    print_success "Resource Group '$RESOURCE_GROUP' found"
    
    # Check web app
    if ! az webapp show --resource-group $RESOURCE_GROUP --name $BACKEND_APP &>/dev/null; then
        print_error "Web App '$BACKEND_APP' not found!"
        echo "Expected: ${BACKEND_APP}"
        echo "Please check your existing deployment or update the script."
        exit 1
    fi
    print_success "Web App '$BACKEND_APP' found"
    
    # Check container registry
    if ! az acr show --resource-group $RESOURCE_GROUP --name $ACR_NAME &>/dev/null; then
        print_error "Container Registry '$ACR_NAME' not found!"
        echo "Expected: ${ACR_NAME}"
        echo "Please check your existing deployment or update the script."
        exit 1
    fi
    print_success "Container Registry '$ACR_NAME' found"
    
    # Step 3: Build and Push Docker Image with Frontend Updates
    print_step "3" "Building Docker Image with Latest Changes"
    
    echo "Building Docker image with frontend and backend updates..."
    # Build the image with frontend API base URL pointing to your backend app
    docker build \
      --build-arg REACT_APP_API_BASE_URL="https://${BACKEND_APP}.azurewebsites.net/api" \
      -t excel-template-mapper:latest .
    
    print_success "Docker image built successfully"
    
    echo "Tagging image for ACR..."
    docker tag excel-template-mapper:latest "$ACR_NAME.azurecr.io/excel-template-mapper:latest"
    
    echo "Logging into ACR..."
    az acr login --name "$ACR_NAME"
    
    echo "Pushing updated image to ACR..."
    docker push "$ACR_NAME.azurecr.io/excel-template-mapper:latest"
    print_success "Updated Docker image pushed to ACR"
    
    # Step 4: Update Web App Configuration (if needed)
    print_step "4" "Updating Web App Configuration"
    
    # Get ACR credentials (in case they changed)
    ACR_USERNAME=$(az acr credential show --name $ACR_NAME --query username -o tsv)
    ACR_PASSWORD=$(az acr credential show --name $ACR_NAME --query passwords[0].value -o tsv)
    
    # Update container image reference
    az webapp config container set \
        --resource-group $RESOURCE_GROUP \
        --name $BACKEND_APP \
        --container-image-name "$ACR_NAME.azurecr.io/excel-template-mapper:latest" \
        --container-registry-url "https://$ACR_NAME.azurecr.io" \
        --container-registry-user "$ACR_USERNAME" \
        --container-registry-password "$ACR_PASSWORD"
    
    print_success "Web App container configuration updated"
    
    # Step 5: Restart Web App to Deploy Changes
    print_step "5" "Restarting Web App to Deploy Updates"
    az webapp restart --resource-group $RESOURCE_GROUP --name $BACKEND_APP
    
    echo "Waiting for deployment to complete..."
    sleep 30
    
    # Step 6: Test Deployment
    print_step "6" "Testing Deployment"
    
    BACKEND_URL="https://${BACKEND_APP}.azurewebsites.net"
    
    echo "Testing deployment..."
    for i in {1..6}; do
        echo "Attempt $i/6..."
        RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$BACKEND_URL" || echo "000")
        
        if [ "$RESPONSE" = "200" ]; then
            print_success "Deployment successful! Application is running"
            break
        elif [ "$i" = "6" ]; then
            print_warning "Deployment completed but app might still be starting up (HTTP $RESPONSE)"
        else
            echo "Response: $RESPONSE, waiting 10 seconds..."
            sleep 10
        fi
    done
    
    # Step 7: Test Frontend and Backend Endpoints
    print_step "7" "Testing Frontend and Backend"
    
    echo "Testing frontend (should return HTML)..."
    FRONTEND_TEST=$(curl -s "$BACKEND_URL" | head -c 100)
    if echo "$FRONTEND_TEST" | grep -q "html"; then
        print_success "Frontend is serving properly"
    else
        print_warning "Frontend test inconclusive"
    fi
    
    echo "Testing backend API..."
    API_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$BACKEND_URL/api/health/" || echo "000")
    if [ "$API_RESPONSE" = "200" ]; then
        print_success "Backend API is responding properly"
    else
        print_warning "Backend API test returned: $API_RESPONSE"
    fi
    
    # Final Summary
    print_header "DEPLOYMENT UPDATE COMPLETED!"
    
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
    echo "└── Quick redeploy: bash deploy-existing.sh"
    echo ""
    echo "📝 WHAT WAS DEPLOYED:"
    echo "├── ✅ Backend changes (unique numbering system)"
    echo "├── ✅ Frontend changes (enhanced UI and field detection)"
    echo "├── ✅ Documentation and logs"
    echo "└── ✅ Both containers in single Docker image"
    echo ""
    echo "✅ SUCCESS! Your Excel Template Mapper has been updated with all latest changes!"
    echo "🎯 Access your updated application at: $BACKEND_URL"
    echo ""
    echo "🔍 The application now includes:"
    echo "├── Unique numbering for Tag fields (Tag_1, Tag_2, etc.)"
    echo "├── Unique numbering for Specification pairs"
    echo "├── Enhanced frontend field detection and pairing"
    echo "├── Improved data editor with formula recognition"
    echo "└── Updated UI components and user experience"
}

# ============================================================================
# SCRIPT EXECUTION
# ============================================================================

# Check if running in a supported shell
if [ -z "$BASH_VERSION" ]; then
    echo "⚠️  This script is designed for bash. Current shell: $0"
    echo "Please run with: bash deploy-existing.sh"
    exit 1
fi

# Run main function
main "$@"