# Excel Template Mapper - Complete Deployment Guide

## 📋 Overview

This guide provides comprehensive information about deploying the Excel Template Mapper application to Microsoft Azure using Docker containers. The application uses a **single Docker container architecture** that serves both frontend (React) and backend (Django) components through Nginx.

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                 Azure Container Instance                │
│                                                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐ │
│  │    Nginx    │  │   Django    │  │      React      │ │
│  │   (Port 80) │  │  (Port 8000)│  │   (Static Files)│ │
│  │             │  │             │  │                 │ │
│  │   Routes:   │  │   Backend   │  │   Frontend UI   │ │
│  │   /api/ →   │◄─┤     API     │  │                 │ │
│  │   / →       │  │             │  │                 │ │
│  │   Static    │  │             │  │                 │ │
│  └─────────────┘  └─────────────┘  └─────────────────┘ │
└─────────────────────────────────────────────────────────┘
                            │
                            ▼
            ┌─────────────────────────────────┐
            │         Azure Services          │
            │                                 │
            │  • PostgreSQL Database          │
            │  • Blob Storage                 │
            │  • Container Registry (ACR)     │
            └─────────────────────────────────┘
```

## 📁 Local Project Structure

```
/Users/kartikd/Downloads/stawan sir azure final/excel-template-mapper-final/
├── 📄 Dockerfile                          # Multi-stage Docker build
├── 📄 docker-compose.yml                  # Local development
├── 📄 nginx.conf                         # Nginx routing configuration
├── 📄 docker-entrypoint.sh              # Container startup script
├── 🔧 deploy-to-azure-clean.sh           # Complete deployment script
├── 🔧 deploy-existing.sh                 # Deploy to existing resources
├── 🔧 force-deploy.sh                    # Force fresh deployment
├── 📂 backend/                           # Django Backend
│   ├── 📄 requirements.txt              # Python dependencies
│   ├── 📄 manage.py                     # Django management
│   ├── 📄 azure_storage.py              # Azure Blob integration
│   ├── 📂 excel_mapper/                 # Main Django app
│   │   ├── 📄 models.py                 # Database models
│   │   ├── 📄 views.py                  # API endpoints (with unique numbering)
│   │   ├── 📄 urls.py                   # URL routing
│   │   └── 📂 migrations/               # Database migrations
│   ├── 📂 media/                        # Uploaded files
│   ├── 📂 uploaded_files/               # File processing area
│   └── 📂 temp_downloads/               # Temporary downloads
├── 📂 frontend/                          # React Frontend
│   ├── 📄 package.json                  # Node dependencies
│   ├── 📂 src/
│   │   ├── 📄 App.js                    # Main React app
│   │   ├── 📂 components/               # React components
│   │   │   ├── 📄 Header.js             # App header (updated)
│   │   │   ├── 📄 FormulaBuilder.js     # Formula builder
│   │   │   └── 📄 ErrorBoundary.js      # Error handling
│   │   ├── 📂 pages/                    # Page components
│   │   │   ├── 📄 ColumnMapping.js      # Column mapping (with unique numbering)
│   │   │   ├── 📄 ColumnMappingFixed.js # Helper utilities
│   │   │   ├── 📄 Dashboard.js          # Main dashboard
│   │   │   └── 📄 DataEditor.js         # Data editing interface
│   │   └── 📂 services/
│   │       └── 📄 api.js                # API client
│   └── 📂 build/                        # Built React files (generated)
└── 📂 test_files/                       # Sample test files
    ├── 📄 client_bom_data.xlsx
    └── 📄 factwise_template.xlsx
```

## 🔐 Current Azure Resources (Existing Deployment)

### **Resource Group**: `excel-mapper-rg-96552`
**Location**: Central India

### **Resource Details**:

| Resource Type | Name | Purpose | Connection |
|---------------|------|---------|------------|
| **Container Registry** | `excelmapperregistry96552` | Docker image storage | `excelmapperregistry96552.azurecr.io` |
| **App Service Plan** | `excel-mapper-plan-96552` | Compute hosting plan | S1 Standard, Linux |
| **Web App** | `excel-mapper-backend-96552` | Main application | `https://excel-mapper-backend-96552.azurewebsites.net/` |
| **PostgreSQL Server** | `excel-mapper-db-96552` | Database server | `excel-mapper-db-96552.postgres.database.azure.com` |
| **Database** | `excel_mapper_db` | Application database | Connected via DATABASE_URL |
| **Storage Account** | `excelmapper96552` | File storage | `excelmapper96552.blob.core.windows.net` |
| **Storage Containers** | `uploaded-files`, `temp-downloads` | File organization | Used for Excel file processing |

## 🔑 Configuration & Credentials

### **From deploy-to-azure-clean.sh**:

```bash
# Configuration Variables
RESOURCE_PREFIX="excel-mapper"
LOCATION="centralindia" 
DB_ADMIN_PASSWORD="ExcelMapper2025!"
GITHUB_REPO="kd26-droid/excel-template-mapper-final"
TIMESTAMP="96552"  # Your deployment timestamp

# Derived Resource Names
RESOURCE_GROUP="excel-mapper-rg-96552"
BACKEND_APP="excel-mapper-backend-96552"
DB_SERVER="excel-mapper-db-96552"
STORAGE_ACCOUNT="excelmapper96552"
ACR_NAME="excelmapperregistry96552"
```

### **Environment Variables (Configured in Azure Web App)**:

```bash
SECRET_KEY="[Auto-generated Django secret]"
DEBUG="False"
ALLOWED_HOSTS="excel-mapper-backend-96552.azurewebsites.net,localhost,127.0.0.1"
DATABASE_URL="postgresql://dbadmin:ExcelMapper2025!@excel-mapper-db-96552.postgres.database.azure.com:5432/excel_mapper_db?sslmode=require"
AZURE_STORAGE_ACCOUNT_NAME="excelmapper96552"
AZURE_STORAGE_ACCOUNT_KEY="[Auto-retrieved from Azure]"
AZURE_STORAGE_CONTAINER_NAME="uploaded-files"
MAX_FILE_SIZE_MB="25"
LOG_LEVEL="INFO"
WEBSITES_PORT="80"
WEBSITES_SSH_PORT="2222"
DOCKER_REGISTRY_SERVER_URL="https://excelmapperregistry96552.azurecr.io"
```

## 🐳 Docker Container Details

### **Multi-Stage Build Process**:

1. **Backend Build Stage** (`python:3.11-slim`):
   - Installs Python dependencies from `requirements.txt`
   - Copies Django backend code
   - Sets up media directories and permissions

2. **Frontend Build Stage** (`node:18-alpine`):
   - Installs Node.js dependencies
   - Builds React application with environment variables
   - Creates optimized production build

3. **Final Stage** (`python:3.11-slim`):
   - Installs Nginx and system dependencies
   - Copies backend code and Python packages
   - Copies frontend build files
   - Sets up Nginx configuration
   - Configures startup script

### **Container Startup Process** (`docker-entrypoint.sh`):

```bash
1. 📦 Install/upgrade Python dependencies
2. 📁 Create required directories (media, uploads, logs)
3. 🎨 Collect Django static files
4. 🗄️  Run database migrations
5. 🌐 Start Gunicorn server (port 8000)
6. 🔐 Start SSH server (port 2222) 
7. 🖥️  Start Nginx server (port 80)
```

### **Nginx Routing** (`nginx.conf`):

```nginx
/ → Frontend React files (/app/frontend/build)
/api/ → Django backend (localhost:8000)
/admin/ → Django admin (localhost:8000/admin/)
/static/js/, /static/css/ → Frontend assets
/static/ → Django static files (fallback)
/media/ → Django media files
```

## 🚀 Deployment Procedures

### **Method 1: Complete New Deployment**

```bash
cd "/Users/kartikd/Downloads/stawan sir azure final/excel-template-mapper-final"
bash deploy-to-azure-clean.sh
```

**This creates ALL new resources with timestamp**

### **Method 2: Deploy to Existing Resources**

```bash
cd "/Users/kartikd/Downloads/stawan sir azure final/excel-template-mapper-final"
bash deploy-existing.sh
```

**This updates the existing excel-mapper-backend-96552 deployment**

### **Method 3: Force Fresh Deployment**

```bash
cd "/Users/kartikd/Downloads/stawan sir azure final/excel-template-mapper-final"
bash force-deploy.sh
```

**This builds fresh container with timestamp and forces deployment**

### **Method 4: Manual Docker Build & Deploy**

```bash
# Build with correct API URL
docker build --no-cache \
  --build-arg REACT_APP_API_BASE_URL="https://excel-mapper-backend-96552.azurewebsites.net/api" \
  -t excel-template-mapper:latest .

# Tag for ACR
docker tag excel-template-mapper:latest \
  excelmapperregistry96552.azurecr.io/excel-template-mapper:latest

# Login to ACR
az acr login --name excelmapperregistry96552

# Push to ACR
docker push excelmapperregistry96552.azurecr.io/excel-template-mapper:latest

# Update Azure Web App
az webapp config container set \
  --resource-group excel-mapper-rg-96552 \
  --name excel-mapper-backend-96552 \
  --container-image-name "excelmapperregistry96552.azurecr.io/excel-template-mapper:latest"

# Restart App
az webapp restart --resource-group excel-mapper-rg-96552 --name excel-mapper-backend-96552
```

## 🔧 Management Commands

### **Check Application Status**:
```bash
# Check if app is running
curl https://excel-mapper-backend-96552.azurewebsites.net/api/health/

# View live logs
az webapp log tail --resource-group excel-mapper-rg-96552 --name excel-mapper-backend-96552

# Restart application
az webapp restart --resource-group excel-mapper-rg-96552 --name excel-mapper-backend-96552
```

### **Container Management**:
```bash
# List ACR images
az acr repository list --name excelmapperregistry96552

# View image tags
az acr repository show-tags --name excelmapperregistry96552 --repository excel-template-mapper

# Get ACR credentials
az acr credential show --name excelmapperregistry96552
```

### **Database Management**:
```bash
# Connect to database
PGPASSWORD=ExcelMapper2025! psql -h excel-mapper-db-96552.postgres.database.azure.com -U dbadmin -d excel_mapper_db

# Run migrations manually (if needed)
az webapp ssh --resource-group excel-mapper-rg-96552 --name excel-mapper-backend-96552
# Inside container: python manage.py migrate
```

## 🐛 Troubleshooting

### **Common Issues**:

1. **"Application Error" Page**:
   - Check Azure Portal → Configuration → General settings → Health check (disable or set to `/api/health/`)
   - Check logs in Azure Portal → Log stream

2. **Container Won't Start**:
   - Verify ACR credentials in Azure Portal → Deployment Center
   - Check environment variables in Configuration
   - Look for startup errors in Log stream

3. **Frontend Changes Not Visible**:
   - Clear browser cache (Ctrl+Shift+R)
   - Verify correct image is deployed: check JavaScript file names in browser dev tools
   - Ensure Docker build used correct `REACT_APP_API_BASE_URL`

4. **Database Connection Issues**:
   - Verify `DATABASE_URL` environment variable
   - Check PostgreSQL firewall rules
   - Test database connectivity from Azure CLI

### **Health Check Endpoints**:

- **Application**: `https://excel-mapper-backend-96552.azurewebsites.net/`
- **API Health**: `https://excel-mapper-backend-96552.azurewebsites.net/api/health/`
- **Admin Panel**: `https://excel-mapper-backend-96552.azurewebsites.net/admin/`
- **API Base**: `https://excel-mapper-backend-96552.azurewebsites.net/api/`

## 📊 Recent Updates

### **Latest Changes (2025-08-11)**:

1. **Unique Numbering System**:
   - Backend: Updated `views.py` with unique field naming (`Tag_1`, `Tag_2`, `Specification_Name_1`)
   - Frontend: Enhanced `ColumnMapping.js` and `DataEditor.js` for unique field detection
   - Added backward compatibility for old naming conventions

2. **UI Improvements**:
   - Updated header title from "Excel Template Mapper - Azure Production" to "Excel Template Mapper"
   - Enhanced field detection and pairing logic
   - Improved visual indicators for grouped fields

3. **Container Architecture**:
   - Single container serving both frontend and backend
   - Nginx routing for optimal performance
   - Multi-stage Docker build for efficient image size

## 🔗 Important URLs & Access

- **Live Application**: https://excel-mapper-backend-96552.azurewebsites.net/
- **Azure Portal**: https://portal.azure.com/#@/resource/subscriptions/dd0bcf53-1b33-48da-85a3-8424770c89fc/resourceGroups/excel-mapper-rg-96552
- **Container Registry**: https://portal.azure.com/#@/resource/subscriptions/dd0bcf53-1b33-48da-85a3-8424770c89fc/resourceGroups/excel-mapper-rg-96552/providers/Microsoft.ContainerRegistry/registries/excelmapperregistry96552
- **GitHub Repository**: https://github.com/kd26-droid/excel-template-mapper-final

## ⚡ Quick Deploy Commands

```bash
# Navigate to project
cd "/Users/kartikd/Downloads/stawan sir azure final/excel-template-mapper-final"

# Quick update existing deployment
bash deploy-existing.sh

# Or force fresh build and deploy
bash force-deploy.sh
```

---

**✅ This deployment guide covers the complete architecture, configuration, and management of the Excel Template Mapper application on Microsoft Azure using Docker containers.**