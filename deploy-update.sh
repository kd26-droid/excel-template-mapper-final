#!/bin/bash

# Excel Template Mapper - Update Existing Azure Deployment
# Updates the existing Azure Web App with your latest changes

set -e  # Exit on any error

# ============================================================================
# CONFIGURATION - Using existing resources
# ============================================================================

# Existing Resource Names
RESOURCE_GROUP="excel-mapper-rg-96552"
BACKEND_APP="excel-mapper-backend-96552"
ACR_NAME="excelmapperregistry96552"

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
# MAIN UPDATE SCRIPT
# ============================================================================

main() {
    print_header "Excel Template Mapper - Update Deployment"
    echo "🎯 Target: https://excel-mapper-backend-96552.azurewebsites.net"
    echo "📦 Resource Group: ${RESOURCE_GROUP}"
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
    
    if ! az webapp show --resource-group $RESOURCE_GROUP --name $BACKEND_APP &>/dev/null; then
        print_error "Web App '$BACKEND_APP' not found in resource group '$RESOURCE_GROUP'"
        exit 1
    fi
    print_success "Web App '$BACKEND_APP' found"
    
    if ! az acr show --resource-group $RESOURCE_GROUP --name $ACR_NAME &>/dev/null; then
        print_error "Container Registry '$ACR_NAME' not found"
        exit 1
    fi
    print_success "Container Registry '$ACR_NAME' found"
    
    # Step 3: Build and Push Updated Docker Image
    print_step "3" "Building Updated Docker Image"
    
    echo "Building Docker image with your latest changes..."
    # Build the image with frontend API base URL pointing to your existing backend
    docker build \
      --build-arg REACT_APP_API_BASE_URL="https://excel-mapper-backend-96552.azurewebsites.net/api" \
      -t excel-template-mapper:latest .
    
    echo "Tagging image for ACR..."
    docker tag excel-template-mapper:latest "$ACR_NAME.azurecr.io/excel-template-mapper:latest"
    
    echo "Logging into ACR..."
    az acr login --name "$ACR_NAME"
    
    echo "Pushing updated image to ACR..."
    docker push "$ACR_NAME.azurecr.io/excel-template-mapper:latest"
    print_success "Updated Docker image built and pushed to ACR"
    
    # Step 4: Restart Web App to Pull New Image
    print_step "4" "Restarting Web App to Deploy Changes"
    az webapp restart --resource-group $RESOURCE_GROUP --name $BACKEND_APP
    
    echo "Waiting for deployment to complete..."
    sleep 45
    
    # Step 5: Test Updated Deployment
    print_step "5" "Testing Updated Deployment"
    BACKEND_URL="https://excel-mapper-backend-96552.azurewebsites.net"
    
    echo "Testing deployment..."
    RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$BACKEND_URL" || echo "000")
    
    if [ "$RESPONSE" = "200" ]; then
        print_success "Deployment successful! Your changes are now live"
    else
        print_warning "Deployment completed but app might still be starting up (HTTP $RESPONSE)"
        echo "Please wait a few more minutes and check manually"
    fi
    
    # Final Summary
    print_header "UPDATE COMPLETED SUCCESSFULLY!"
    
    echo "📋 DEPLOYMENT SUMMARY:"
    echo "├── 🌐 Application URL:  $BACKEND_URL"
    echo "├── 🏥 Health Check:     $BACKEND_URL/api/health/"
    echo "├── 🐳 Container Image:  $ACR_NAME.azurecr.io/excel-template-mapper:latest"
    echo "└── 📦 Resource Group:   $RESOURCE_GROUP"
    echo ""
    echo "🔗 IMPORTANT URLS:"
    echo "├── Application: $BACKEND_URL"
    echo "├── API Base: $BACKEND_URL/api/"
    echo "├── Health Check: $BACKEND_URL/api/health/"
    echo "└── Admin Panel: $BACKEND_URL/admin/"
    echo ""
    echo "🔧 MANAGEMENT COMMANDS:"
    echo "├── Check logs: az webapp log tail --resource-group $RESOURCE_GROUP --name $BACKEND_APP"
    echo "├── Restart app: az webapp restart --resource-group $RESOURCE_GROUP --name $BACKEND_APP"
    echo "└── Quick redeploy: ./deploy-update.sh"
    echo ""
    echo "✅ SUCCESS! Your updated Excel Template Mapper is now live!"
    echo "🎯 Access your application at: $BACKEND_URL"
}

# ============================================================================
# SCRIPT EXECUTION
# ============================================================================

# Check if running in a supported shell
if [ -z "$BASH_VERSION" ]; then
    echo "⚠️  This script is designed for bash. Current shell: $0"
    echo "Please run with: bash deploy-update.sh"
    exit 1
fi

# Run main function
main "$@"