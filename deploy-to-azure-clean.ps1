# Excel Template Mapper - Clean Azure Deployment Script (PowerShell)
# IDE-independent deployment script for Azure
# Works with Windows PowerShell

param(
    [string]$ResourcePrefix = "excel-mapper",
    [string]$Location = "centralindia",
    [string]$StaticWebAppLocation = "eastasia",
    [string]$DbAdminPassword = "ExcelMapper2025!",
    [string]$GitHubRepo = "kd26-droid/excel-template-mapper-final"
)

# Set error action preference
$ErrorActionPreference = "Stop"

# ============================================================================
# CONFIGURATION
# ============================================================================

# Derived Names (with timestamp to avoid conflicts)
$Timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds().ToString().Substring(4)
$ResourceGroup = "${ResourcePrefix}-rg-${Timestamp}"
$AppServicePlan = "${ResourcePrefix}-plan-${Timestamp}"
$BackendApp = "${ResourcePrefix}-backend-${Timestamp}"
$StaticWebApp = "${ResourcePrefix}-frontend-${Timestamp}"
$DbServer = "${ResourcePrefix}-db-${Timestamp}"
$DbName = "excel_mapper_db"
$StorageAccount = "excelmapper${Timestamp}"  # Must be lowercase, no hyphens
$AcrName = "excelmapperregistry${Timestamp}"

# ============================================================================
# UTILITY FUNCTIONS
# ============================================================================

function Write-Header {
    param([string]$Message)
    Write-Host ""
    Write-Host "══════════════════════════════════════════════════" -ForegroundColor Cyan
    Write-Host "🚀 $Message" -ForegroundColor Green
    Write-Host "══════════════════════════════════════════════════" -ForegroundColor Cyan
    Write-Host ""
}

function Write-Step {
    param([string]$StepNumber, [string]$Message)
    Write-Host ""
    Write-Host "📋 Step ${StepNumber}: $Message" -ForegroundColor Yellow
    Write-Host "---------------------------------------------------" -ForegroundColor Gray
}

function Write-Success {
    param([string]$Message)
    Write-Host "✅ $Message" -ForegroundColor Green
}

function Write-Warning {
    param([string]$Message)
    Write-Host "⚠️  $Message" -ForegroundColor Yellow
}

function Write-Error {
    param([string]$Message)
    Write-Host "❌ $Message" -ForegroundColor Red
}

function Test-Prerequisites {
    Write-Step "0" "Checking Prerequisites"
    
    # Check if Azure CLI is installed
    try {
        $azVersion = az version --output table 2>$null
        if (!$azVersion) {
            throw "Azure CLI not found"
        }
    }
    catch {
        Write-Error "Azure CLI is not installed. Please install it first:"
        Write-Host "https://docs.microsoft.com/en-us/cli/azure/install-azure-cli" -ForegroundColor Blue
        exit 1
    }
    
    # Check if Docker is installed
    try {
        $dockerVersion = docker --version 2>$null
        if (!$dockerVersion) {
            throw "Docker not found"
        }
    }
    catch {
        Write-Error "Docker is not installed. Please install Docker first:"
        Write-Host "https://docs.docker.com/get-docker/" -ForegroundColor Blue
        exit 1
    }
    
    Write-Success "Prerequisites check completed"
}

function New-SecretKey {
    # Generate a secure secret key using .NET random number generator
    $rng = [System.Security.Cryptography.RNGCryptoServiceProvider]::new()
    $bytes = New-Object byte[] 32
    $rng.GetBytes($bytes)
    $secretKey = [Convert]::ToBase64String($bytes) -replace '[+/=]', ''
    $rng.Dispose()
    return $secretKey.Substring(0, [Math]::Min($secretKey.Length, 50))
}

# ============================================================================
# MAIN DEPLOYMENT SCRIPT
# ============================================================================

function Start-Deployment {
    Write-Header "Excel Template Mapper - Azure Deployment"
    Write-Host "📍 Region: Central India" -ForegroundColor Cyan
    Write-Host "🏷️  Resource Prefix: ${ResourcePrefix}" -ForegroundColor Cyan
    Write-Host "🔢 Unique ID: ${Timestamp}" -ForegroundColor Cyan
    Write-Host ""
    
    Test-Prerequisites
    
    # Step 1: Login and Set Subscription
    Write-Step "1" "Azure Authentication"
    try {
        $account = az account show --output json 2>$null | ConvertFrom-Json
        if (!$account) {
            throw "Not logged in"
        }
    }
    catch {
        Write-Host "Please login to Azure first..." -ForegroundColor Yellow
        az login
    }
    
    $subscriptionId = az account show --query id --output tsv
    Write-Success "Using subscription: $subscriptionId"
    
    # Step 2: Create Resource Group
    Write-Step "2" "Creating Resource Group"
    $existingRg = az group show --name $ResourceGroup 2>$null
    if ($existingRg) {
        Write-Success "Resource Group '$ResourceGroup' already exists"
    }
    else {
        az group create --name $ResourceGroup --location $Location --tags "Environment=Production" "Project=ExcelMapper" "IDE=Independent" | Out-Null
        Write-Success "Resource Group '$ResourceGroup' created"
    }
    
    # Step 3: Create Container Registry
    Write-Step "3" "Creating Azure Container Registry"
    $existingAcr = az acr show --resource-group $ResourceGroup --name $AcrName 2>$null
    if ($existingAcr) {
        Write-Success "Container Registry '$AcrName' already exists"
    }
    else {
        az acr create --resource-group $ResourceGroup --name $AcrName --sku Basic --location $Location --admin-enabled true | Out-Null
        Write-Success "Container Registry '$AcrName' created"
    }
    
    # Step 4: Create PostgreSQL Database
    Write-Step "4" "Creating PostgreSQL Database"
    
    $existingDb = az postgres flexible-server show --resource-group $ResourceGroup --name $DbServer 2>$null
    if ($existingDb) {
        Write-Success "PostgreSQL Server '$DbServer' already exists"
    }
    else {
        az postgres flexible-server create --resource-group $ResourceGroup --name $DbServer --location $Location --admin-user dbadmin --admin-password $DbAdminPassword --sku-name Standard_B2s --tier Burstable --storage-size 32 --version 13 --yes | Out-Null
        Write-Success "PostgreSQL Server '$DbServer' created"
    }
    
    # Create database
    $existingDatabase = az postgres flexible-server db show --resource-group $ResourceGroup --server-name $DbServer --database-name $DbName 2>$null
    if ($existingDatabase) {
        Write-Success "Database '$DbName' already exists"
    }
    else {
        az postgres flexible-server db create --resource-group $ResourceGroup --server-name $DbServer --database-name $DbName | Out-Null
        Write-Success "Database '$DbName' created"
    }
    
    # Configure firewall
    $existingRule = az postgres flexible-server firewall-rule show --resource-group $ResourceGroup --name $DbServer --rule-name "AllowAzureServices" 2>$null
    if (!$existingRule) {
        az postgres flexible-server firewall-rule create --resource-group $ResourceGroup --name $DbServer --rule-name "AllowAzureServices" --start-ip-address 0.0.0.0 --end-ip-address 0.0.0.0 | Out-Null
        Write-Success "Firewall rule created"
    }
    
    # Step 5: Create Storage Account
    Write-Step "5" "Creating Storage Account"
    $existingStorage = az storage account show --resource-group $ResourceGroup --name $StorageAccount 2>$null
    if ($existingStorage) {
        Write-Success "Storage Account '$StorageAccount' already exists"
    }
    else {
        az storage account create --resource-group $ResourceGroup --name $StorageAccount --location $Location --sku Standard_LRS --kind StorageV2 --access-tier Hot | Out-Null
        Write-Success "Storage Account '$StorageAccount' created"
    }
    
    # Get storage account key
    $StorageKey = az storage account keys list --resource-group $ResourceGroup --account-name $StorageAccount --query "[0].value" --output tsv
    
    # Create containers
    foreach ($container in @("uploaded-files", "temp-downloads")) {
        $existingContainer = az storage container show --account-name $StorageAccount --name $container --account-key $StorageKey 2>$null
        if (!$existingContainer) {
            az storage container create --account-name $StorageAccount --account-key $StorageKey --name $container --public-access off | Out-Null
            Write-Success "Container '$container' created"
        }
    }
    
    # Step 6: Build and Push Docker Image
    Write-Step "6" "Building and Pushing Docker Image"
    
    Write-Host "Building Docker image..." -ForegroundColor Cyan
    docker build -t excel-template-mapper:latest .
    
    Write-Host "Tagging image for ACR..." -ForegroundColor Cyan
    docker tag excel-template-mapper:latest "$AcrName.azurecr.io/excel-template-mapper:latest"
    
    Write-Host "Logging into ACR..." -ForegroundColor Cyan
    az acr login --name $AcrName | Out-Null
    
    Write-Host "Pushing to ACR..." -ForegroundColor Cyan
    docker push "$AcrName.azurecr.io/excel-template-mapper:latest"
    Write-Success "Docker image built and pushed to ACR"
    
    # Step 7: Create App Service Plan
    Write-Step "7" "Creating App Service Plan"
    $existingPlan = az appservice plan show --resource-group $ResourceGroup --name $AppServicePlan 2>$null
    if ($existingPlan) {
        Write-Success "App Service Plan '$AppServicePlan' already exists"
    }
    else {
        az appservice plan create --resource-group $ResourceGroup --name $AppServicePlan --location $Location --sku S1 --is-linux --number-of-workers 1 | Out-Null
        Write-Success "App Service Plan '$AppServicePlan' created"
    }
    
    # Step 8: Create Web App
    Write-Step "8" "Creating Web App"
    $existingApp = az webapp show --resource-group $ResourceGroup --name $BackendApp 2>$null
    if ($existingApp) {
        Write-Success "Web App '$BackendApp' already exists"
    }
    else {
        az webapp create --resource-group $ResourceGroup --plan $AppServicePlan --name $BackendApp --deployment-container-image-name "$AcrName.azurecr.io/excel-template-mapper:latest" | Out-Null
        Write-Success "Web App '$BackendApp' created"
    }
    
    # Step 9: Configure Web App
    Write-Step "9" "Configuring Web App"
    
    # Get ACR credentials
    $AcrUsername = az acr credential show --name $AcrName --query username --output tsv
    $AcrPassword = az acr credential show --name $AcrName --query passwords[0].value --output tsv
    
    # Generate secret key
    $SecretKey = New-SecretKey
    
    # Database URL
    $DbUrl = "postgresql://dbadmin:${DbAdminPassword}@${DbServer}.postgres.database.azure.com:5432/${DbName}?sslmode=require"
    
    # Backend URL
    $BackendUrl = "https://${BackendApp}.azurewebsites.net"
    
    # Configure app settings
    az webapp config appsettings set --resource-group $ResourceGroup --name $BackendApp --settings "SECRET_KEY=$SecretKey" "DEBUG=False" "ALLOWED_HOSTS=${BackendApp}.azurewebsites.net,localhost,127.0.0.1" "DATABASE_URL=$DbUrl" "AZURE_STORAGE_ACCOUNT_NAME=$StorageAccount" "AZURE_STORAGE_ACCOUNT_KEY=$StorageKey" "AZURE_STORAGE_CONTAINER_NAME=uploaded-files" "MAX_FILE_SIZE_MB=25" "LOG_LEVEL=INFO" "WEBSITES_ENABLE_APP_SERVICE_STORAGE=false" "WEBSITES_PORT=8000" "DOCKER_REGISTRY_SERVER_URL=https://$AcrName.azurecr.io" "DOCKER_REGISTRY_SERVER_USERNAME=$AcrUsername" "DOCKER_REGISTRY_SERVER_PASSWORD=$AcrPassword" | Out-Null
    
    Write-Success "Web App configured"
    
    # Step 10: Enable HTTPS
    Write-Step "10" "Enabling HTTPS"
    az webapp update --resource-group $ResourceGroup --name $BackendApp --https-only true | Out-Null
    Write-Success "HTTPS enabled"
    
    # Step 11: Restart and Test
    Write-Step "11" "Restarting and Testing"
    az webapp restart --resource-group $ResourceGroup --name $BackendApp | Out-Null
    
    Write-Host "Waiting for deployment to complete..." -ForegroundColor Cyan
    Start-Sleep -Seconds 60
    
    Write-Host "Testing deployment..." -ForegroundColor Cyan
    try {
        $response = Invoke-WebRequest -Uri $BackendUrl -UseBasicParsing -TimeoutSec 30
        $statusCode = $response.StatusCode
    }
    catch {
        $statusCode = "000"
    }
    
    if ($statusCode -eq 200) {
        Write-Success "Deployment successful! Application is running"
    }
    else {
        Write-Warning "Deployment completed but app might still be starting up (HTTP $statusCode)"
    }
    
    # Final Summary
    Write-Header "DEPLOYMENT COMPLETED SUCCESSFULLY!"
    
    Write-Host "DEPLOYMENT SUMMARY:" -ForegroundColor Green
    Write-Host "- Application URL:  $BackendUrl" -ForegroundColor White
    Write-Host "- Health Check:     $BackendUrl/api/health/" -ForegroundColor White
    Write-Host "- Database:         ${DbServer}.postgres.database.azure.com" -ForegroundColor White
    Write-Host "- Storage:          $StorageAccount" -ForegroundColor White
    Write-Host "- Container:        $AcrName.azurecr.io/excel-template-mapper:latest" -ForegroundColor White
    Write-Host "- Region:           Central India" -ForegroundColor White
    Write-Host "- Resource Group:   $ResourceGroup" -ForegroundColor White
    Write-Host ""
    Write-Host "IMPORTANT URLS:" -ForegroundColor Green
    Write-Host "- Application: $BackendUrl" -ForegroundColor White
    Write-Host "- API Base: $BackendUrl/api/" -ForegroundColor White
    Write-Host "- Health Check: $BackendUrl/api/health/" -ForegroundColor White
    Write-Host "- Admin Panel: $BackendUrl/admin/" -ForegroundColor White
    Write-Host "- Azure Portal: https://portal.azure.com/#@/resource/subscriptions/$subscriptionId/resourceGroups/$ResourceGroup" -ForegroundColor White
    Write-Host ""
    Write-Host "✅ SUCCESS! Your Excel Template Mapper is deployed and ready to use!" -ForegroundColor Green
    Write-Host "🎯 Access your application at: $BackendUrl" -ForegroundColor Yellow
}

# ============================================================================
# SCRIPT EXECUTION
# ============================================================================

try {
    Start-Deployment
}
catch {
    Write-Error "Deployment failed: $($_.Exception.Message)"
    Write-Host "Stack trace:" -ForegroundColor Red
    Write-Host $_.ScriptStackTrace -ForegroundColor Red
    exit 1
}
