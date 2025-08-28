@echo off
REM Excel Template Mapper - Complete Clean Rebuild Script (Windows)
REM This script performs a complete cleanup and rebuild of the application

echo 🧹 Starting complete clean rebuild of Excel Template Mapper...

REM Step 1: Stop and remove all containers, networks, and volumes
echo 📦 Step 1: Stopping and removing containers, networks, and volumes...
docker-compose down --volumes --remove-orphans
if errorlevel 1 (
    echo ❌ Failed to stop containers
    pause
    exit /b 1
)
echo ✅ Containers stopped and removed

REM Step 2: Remove Docker images
echo 🗑️ Step 2: Removing Docker images...
docker rmi excel-template-mapper-final-frontend excel-template-mapper-final-backend 2>nul
echo ✅ Docker images removed

REM Step 3: Clean Docker system
echo 🧽 Step 3: Cleaning Docker system...
docker system prune -f
echo ✅ Docker system cleaned

REM Step 4: Clean frontend build cache
echo 🗂️ Step 4: Cleaning frontend build cache...
if exist frontend\build rmdir /s /q frontend\build 2>nul
if exist frontend\node_modules\.cache rmdir /s /q frontend\node_modules\.cache 2>nul
if exist frontend\.eslintcache del frontend\.eslintcache 2>nul
echo ✅ Frontend build cache cleared

REM Step 5: Clean backend cache
echo 🐍 Step 5: Cleaning backend cache...
for /r backend %%i in (*.pyc) do del "%%i" 2>nul
for /f "tokens=*" %%i in ('dir /b /s /a:d backend\*__pycache__* 2^>nul') do rmdir /s /q "%%i" 2>nul
echo ✅ Backend cache cleared

REM Step 6: Rebuild all containers from scratch
echo 🔨 Step 6: Building containers from scratch (this may take a few minutes)...
docker-compose build --no-cache
if errorlevel 1 (
    echo ❌ Failed to build containers
    pause
    exit /b 1
)
echo ✅ Containers built successfully

REM Step 7: Start the containers
echo 🚀 Step 7: Starting containers...
docker-compose up -d
if errorlevel 1 (
    echo ❌ Failed to start containers
    pause
    exit /b 1
)
echo ✅ Containers started successfully

REM Step 8: Wait for containers to be healthy
echo ⏳ Step 8: Waiting for containers to become healthy...
timeout /t 15 /nobreak >nul

REM Step 9: Show final status
echo.
echo 🎉 REBUILD COMPLETE!
echo ====================
echo 📱 Frontend (React): http://localhost:3000
echo 🔧 Backend (Django): http://localhost:8000
echo.
echo 📋 Quick Commands:
echo • View logs: docker-compose logs -f
echo • Stop app: docker-compose down
echo • Restart: docker-compose restart
echo • Check status: docker ps
echo.
echo ✨ Application is ready for testing!
echo    Upload a file and test the +/- buttons without JavaScript errors.

pause