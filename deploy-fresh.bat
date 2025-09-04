@echo off
REM Excel Template Mapper - Fresh Deployment Script (Windows)
REM This script completely rebuilds and deploys your application with fresh code

setlocal enabledelayedexpansion
set "RED=[91m"
set "GREEN=[92m"
set "YELLOW=[93m"
set "BLUE=[94m"
set "PURPLE=[95m"
set "NC=[0m"

REM Configuration
set REGISTRY_NAME=excelmapperacr20994
set REGISTRY_URL=%REGISTRY_NAME%.azurecr.io
set IMAGE_NAME=excel-template-mapper
set WEBAPP_NAME=excel-mapper-backend-211640
set RESOURCE_GROUP=excel-mapper-rg-new

echo %PURPLE%🚀 Excel Template Mapper - Fresh Deployment Script%NC%
echo %PURPLE%=================================================%NC%
echo.

REM Step 1: Get tag name from user
echo %BLUE%📝 Step 1: Tag Selection%NC%
echo %YELLOW%Please enter a tag name for your deployment:%NC%
echo %YELLOW%Examples: kartik-v2, mapping-fix-final, production-ready%NC%
set /p TAG_NAME="Tag name: "

if "%TAG_NAME%"=="" (
    echo %RED%❌ Tag name cannot be empty!%NC%
    pause
    exit /b 1
)

echo %GREEN%✅ Using tag: %TAG_NAME%%NC%
echo.

REM Step 2: Check if Docker is running
echo %BLUE%📝 Step 2: Docker Status Check%NC%
docker info >nul 2>&1
if errorlevel 1 (
    echo %RED%❌ Docker is not running. Please start Docker Desktop.%NC%
    pause
    exit /b 1
)
echo %GREEN%✅ Docker is running%NC%
echo.

REM Step 3: Clean up existing containers and images
echo %BLUE%🧹 Step 3: Cleaning up existing Docker resources%NC%

echo %YELLOW%Stopping and removing containers...%NC%
docker-compose down --volumes --remove-orphans 2>nul

echo %YELLOW%Removing old images...%NC%
docker rmi excel-template-mapper-final-frontend excel-template-mapper-final-backend 2>nul
docker rmi %REGISTRY_URL%/%IMAGE_NAME%:%TAG_NAME% 2>nul

echo %YELLOW%Cleaning Docker system...%NC%
docker system prune -f

echo %YELLOW%Removing build cache...%NC%
docker builder prune -f

echo %GREEN%✅ Docker cleanup complete%NC%
echo.

REM Step 4: Clean build artifacts
echo %BLUE%🗂️  Step 4: Cleaning build artifacts%NC%

echo %YELLOW%Cleaning frontend build cache...%NC%
if exist frontend\build rmdir /s /q frontend\build 2>nul
if exist frontend\node_modules\.cache rmdir /s /q frontend\node_modules\.cache 2>nul
if exist frontend\.eslintcache del frontend\.eslintcache 2>nul

echo %YELLOW%Cleaning backend cache...%NC%
for /r backend %%i in (*.pyc) do del "%%i" 2>nul
for /f "tokens=*" %%i in ('dir /b /s /a:d backend\*__pycache__* 2^>nul') do rmdir /s /q "%%i" 2>nul

echo %GREEN%✅ Build artifacts cleaned%NC%
echo.

REM Step 5: Build new Docker image
echo %BLUE%🔨 Step 5: Building fresh Docker image%NC%
echo %YELLOW%Building: %REGISTRY_URL%/%IMAGE_NAME%:%TAG_NAME%%NC%
echo %YELLOW%This may take several minutes...%NC%

docker build --platform linux/amd64 --no-cache -t %REGISTRY_URL%/%IMAGE_NAME%:%TAG_NAME% -f Dockerfile .
if errorlevel 1 (
    echo %RED%❌ Docker build failed!%NC%
    pause
    exit /b 1
)
echo %GREEN%✅ Docker image built successfully%NC%
echo.

REM Step 6: Login to Azure Container Registry
echo %BLUE%🔐 Step 6: Azure Container Registry Login%NC%
az acr login --name %REGISTRY_NAME%
if errorlevel 1 (
    echo %RED%❌ Failed to login to ACR. Please check your Azure credentials.%NC%
    pause
    exit /b 1
)
echo %GREEN%✅ Successfully logged in to ACR%NC%
echo.

REM Step 7: Push to Azure Container Registry
echo %BLUE%📦 Step 7: Pushing to Azure Container Registry%NC%
echo %YELLOW%Pushing: %REGISTRY_URL%/%IMAGE_NAME%:%TAG_NAME%%NC%

docker push %REGISTRY_URL%/%IMAGE_NAME%:%TAG_NAME%
if errorlevel 1 (
    echo %RED%❌ Failed to push image to ACR%NC%
    pause
    exit /b 1
)
echo %GREEN%✅ Image pushed successfully to ACR%NC%
echo.

REM Step 8: Update Azure Web App
echo %BLUE%🔄 Step 8: Updating Azure Web App%NC%
echo %YELLOW%Updating %WEBAPP_NAME% to use new image...%NC%

az webapp config set --name %WEBAPP_NAME% --resource-group %RESOURCE_GROUP% --linux-fx-version "DOCKER|%REGISTRY_URL%/%IMAGE_NAME%:%TAG_NAME%" >nul
if errorlevel 1 (
    echo %RED%❌ Failed to update web app configuration%NC%
    pause
    exit /b 1
)
echo %GREEN%✅ Web app configuration updated%NC%

echo %YELLOW%Restarting web app to deploy new image...%NC%
az webapp restart --name %WEBAPP_NAME% --resource-group %RESOURCE_GROUP% >nul
if errorlevel 1 (
    echo %RED%❌ Failed to restart web app%NC%
    pause
    exit /b 1
)
echo %GREEN%✅ Web app restarted%NC%
echo.

REM Step 9: Wait for deployment and verify
echo %BLUE%⏳ Step 9: Verifying deployment%NC%
echo %YELLOW%Waiting for application to start up (this may take 1-2 minutes)...%NC%

set RETRY_COUNT=0
set MAX_RETRIES=12

:wait_loop
if %RETRY_COUNT% geq %MAX_RETRIES% goto :wait_timeout

timeout /t 10 /nobreak >nul
set /a RETRY_COUNT+=1

curl -s -o nul -w "%%{http_code}" https://%WEBAPP_NAME%.azurewebsites.net/api/health/ > temp_status.txt 2>nul
set /p HTTP_CODE=<temp_status.txt
del temp_status.txt 2>nul

if "%HTTP_CODE%"=="200" (
    echo %GREEN%✅ Application is running successfully!%NC%
    goto :wait_success
) else (
    echo %YELLOW%Waiting... (attempt %RETRY_COUNT%/%MAX_RETRIES%, status: %HTTP_CODE%)%NC%
    goto :wait_loop
)

:wait_timeout
echo %RED%⚠️  Application may still be starting up. Please check manually.%NC%

:wait_success
echo.

REM Step 10: Display results
echo %BLUE%📋 Step 10: Deployment Summary%NC%
echo %GREEN%🎉 DEPLOYMENT COMPLETE!%NC%
echo %GREEN%=====================%NC%
echo.
echo %BLUE%📦 Image Details:%NC%
echo   Registry: %REGISTRY_URL%
echo   Repository: %IMAGE_NAME%
echo   Tag: %TAG_NAME%
echo   Full Image: %REGISTRY_URL%/%IMAGE_NAME%:%TAG_NAME%
echo.
echo %BLUE%🌐 Application URLs:%NC%
echo   Frontend: https://%WEBAPP_NAME%.azurewebsites.net
echo   Backend API: https://%WEBAPP_NAME%.azurewebsites.net/api/
echo   Health Check: https://%WEBAPP_NAME%.azurewebsites.net/api/health/
echo.
echo %BLUE%🔧 Useful Commands:%NC%
echo   Check logs: az webapp log tail --name %WEBAPP_NAME% --resource-group %RESOURCE_GROUP%
echo   Check status: az webapp show --name %WEBAPP_NAME% --resource-group %RESOURCE_GROUP%
echo   View in portal: https://portal.azure.com
echo.

REM Step 11: Verify tag in registry
echo %BLUE%🔍 Step 11: Verifying tag in registry%NC%
az acr repository show-tags --name %REGISTRY_NAME% --repository %IMAGE_NAME% --output table | findstr /C:"%TAG_NAME%" >nul
if errorlevel 1 (
    echo %YELLOW%⚠️  Tag may still be processing in registry%NC%
) else (
    echo %GREEN%✅ Tag '%TAG_NAME%' confirmed in registry%NC%
)
echo.

echo %PURPLE%✨ Your fresh deployment with tag '%TAG_NAME%' is ready for testing!%NC%
echo %PURPLE%   Test your sessionStorage mapping persistence fixes now.%NC%
echo.

pause