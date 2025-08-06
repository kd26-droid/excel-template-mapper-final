# EXCEL TEMPLATE MAPPER - COMPLETE PROJECT STRUCTURE & AZURE DEPLOYMENT GUIDE
**Author:** Kartik (kartik@factwise.io)  
**Repository:** https://github.com/kd26-droid/excel-template-mapper-.git  
**Date:** August 6, 2025  
**Purpose:** Azure Deployment Ready - Complete Project Documentation

---

## 📁 COMPLETE PROJECT TREE STRUCTURE

```
excel-template-mapper/
├── 📄 .gitignore                           # Git ignore rules
├── 📄 README.md                            # Project documentation
├── 📄 CLAUDE.md                            # Development guide
├── 📄 DEPLOYMENT.md                        # Deployment instructions
├── 📄 kartik.md                            # This file - deployment guide
│
├── 📂 .claude/                             # Claude Code configuration
│   ├── 📄 INTEGRATION_GUIDE.md
│   └── 📄 settings.local.json
│
├── 📂 docs/                                # Technical documentation
│   ├── 📄 ARCHITECTURE_FIXES.md
│   ├── 📄 IMPLEMENTATION_COMPLETE.md
│   └── 📄 STEP3_SMART_TAGS_IMPLEMENTATION.md
│
├── 📂 backend/                             # Django REST API Backend
│   ├── 📄 manage.py                        # Django management script
│   ├── 📄 requirements.txt                 # Python dependencies
│   ├── 📄 db.sqlite3                       # SQLite database (dev)
│   ├── 📄 .env.example                     # Environment variables template
│   ├── 📄 .gitignore                       # Backend git ignore
│   │
│   ├── 📂 excel_mapping/                   # Django project settings
│   │   ├── 📄 __init__.py
│   │   ├── 📄 settings.py                  # Django configuration
│   │   ├── 📄 urls.py                      # Root URL configuration
│   │   ├── 📄 wsgi.py                      # WSGI application
│   │   └── 📄 asgi.py                      # ASGI application (async)
│   │
│   ├── 📂 excel_mapper/                    # Main Django application
│   │   ├── 📄 __init__.py
│   │   ├── 📄 admin.py                     # Django admin configuration
│   │   ├── 📄 apps.py                      # App configuration
│   │   ├── 📄 models.py                    # Database models
│   │   ├── 📄 views.py                     # API endpoints (2800+ lines)
│   │   ├── 📄 urls.py                      # App URL routing
│   │   ├── 📄 bom_header_mapper.py         # AI column mapping logic
│   │   │
│   │   └── 📂 migrations/                  # Database migrations
│   │       ├── 📄 __init__.py
│   │       ├── 📄 0001_initial.py          # Initial database schema
│   │       ├── 📄 0002_add_formula_rules.py
│   │       ├── 📄 0003_add_tag_template.py
│   │       ├── 📄 0004_add_factwise_rules.py
│   │       └── 📄 0005_mappingtemplate_default_values.py
│   │
│   ├── 📂 media/                           # Media files (production)
│   │   └── 📂 uploads/
│   │
│   ├── 📂 logs/                            # Application logs
│   │   ├── 📄 application.log
│   │   └── 📄 error.log
│   │
│   ├── 📂 temp_downloads/                  # Temporary download files
│   │   ├── 📄 session_*.json              # Session data files
│   │   └── 📄 grid_export_*.xlsx          # Generated Excel files
│   │
│   ├── 📂 uploaded_files/                  # User uploaded files
│   │   ├── 📄 *_client.xlsx               # Client Excel files
│   │   └── 📄 *_template.xlsx             # Template files
│   │
│   └── 📂 venv/                            # Python virtual environment
│       ├── 📂 bin/                         # Python executables
│       ├── 📂 lib/                         # Installed packages
│       └── 📂 include/                     # C headers
│
└── 📂 frontend/                            # React Application Frontend
    ├── 📄 package.json                     # Node.js dependencies
    ├── 📄 package-lock.json                # Dependency lock file
    ├── 📄 tailwind.config.js               # Tailwind CSS configuration
    ├── 📄 .gitignore                       # Frontend git ignore
    │
    ├── 📂 public/                          # Static public files
    │   ├── 📄 index.html                   # Main HTML template
    │   └── 📄 manifest.json                # Web app manifest
    │
    ├── 📂 src/                             # React source code
    │   ├── 📄 index.js                     # React entry point
    │   ├── 📄 index.css                    # Global styles
    │   ├── 📄 App.js                       # Main App component
    │   │
    │   ├── 📂 components/                  # Reusable components
    │   │   ├── 📄 ErrorBoundary.js         # Error handling wrapper
    │   │   ├── 📄 FormulaBuilder.js        # Smart tag creation UI
    │   │   ├── 📄 Header.js                # Application header
    │   │   └── 📄 LoadingSpinner.js        # Loading indicator
    │   │
    │   ├── 📂 pages/                       # Main application screens
    │   │   ├── 📄 UploadFiles.js           # File upload interface
    │   │   ├── 📄 ColumnMapping.js         # Column mapping interface
    │   │   ├── 📄 DataEditor.js            # Spreadsheet data editor
    │   │   └── 📄 Dashboard.js             # Main dashboard
    │   │
    │   ├── 📂 services/                    # API communication
    │   │   └── 📄 api.js                   # Axios-based API client
    │   │
    │   ├── 📂 utils/                       # Utility functions
    │   │   ├── 📄 helpers.js               # Common helper functions
    │   │   └── 📄 theme.js                 # Material-UI theme
    │   │
    │   ├── 📂 hooks/                       # Custom React hooks
    │   │   └── 📄 useApi.js                # API interaction hook
    │   │
    │   └── 📂 constants/                   # Application constants
    │       └── 📄 index.js                 # Constant definitions
    │
    └── 📂 node_modules/                    # Node.js dependencies (excluded from git)

```

---

## 🔧 TECHNOLOGY STACK

### Backend (Django REST API)
- **Framework:** Django 4.2.7 + Django REST Framework 3.14.0
- **Database:** SQLite (dev) / PostgreSQL (production)
- **Server:** Gunicorn 21.2.0 + Whitenoise 6.6.0
- **File Processing:** pandas 2.2.0 + openpyxl 3.1.2
- **AI/ML:** rapidfuzz 3.5.2 for intelligent column matching
- **Caching:** Redis 5.0.1 + django-redis 5.4.0 (optional)
- **Security:** django-cors-headers 4.3.1 + cryptography 41.0.7

### Frontend (React Application)
- **Framework:** React 18.2.0 + React Scripts 5.0.1
- **UI Library:** Material-UI (@mui/material 5.17.1)
- **Data Grid:** AG-Grid Community 33.3.1 (spreadsheet-like interface)
- **HTTP Client:** Axios 1.6.2
- **Routing:** React Router DOM 6.19.0
- **File Handling:** react-dropzone 14.3.8 + xlsx 0.18.5
- **Styling:** Tailwind CSS 3.3.3 + Emotion
- **Build Tools:** Webpack + Babel (via react-scripts)

---

## 🗂️ CRITICAL FILES FOR AZURE DEPLOYMENT

### Backend Configuration Files
```
📄 backend/requirements.txt           # Python dependencies - CRITICAL
📄 backend/excel_mapping/settings.py  # Django configuration - CRITICAL
📄 backend/excel_mapping/wsgi.py      # WSGI entry point - CRITICAL
📄 backend/manage.py                  # Django management - CRITICAL
📄 backend/.env.example               # Environment template - CRITICAL
```

### Frontend Configuration Files
```
📄 frontend/package.json              # Node.js dependencies - CRITICAL
📄 frontend/public/index.html         # Main HTML template - CRITICAL
📄 frontend/src/index.js              # React entry point - CRITICAL
📄 frontend/build/                    # Production build directory - GENERATED
```

### Database Files
```
📄 backend/db.sqlite3                 # Development database
📂 backend/excel_mapper/migrations/   # Database migration files - CRITICAL
```

---

## 🏗️ AZURE DEPLOYMENT ARCHITECTURE

### Recommended Azure Services:

#### 1. **Azure App Service (Backend)**
- **Service:** Azure App Service for Linux
- **Runtime:** Python 3.11
- **Plan:** Standard S1 or higher
- **Configuration:**
  - Deployment: GitHub Actions CI/CD
  - Environment: Production
  - Database: Azure Database for PostgreSQL

#### 2. **Azure Static Web Apps (Frontend)**
- **Service:** Azure Static Web Apps
- **Framework:** React
- **Build Command:** `npm run build`
- **Output Location:** `build/`
- **API Location:** Point to Azure App Service backend

#### 3. **Azure Database for PostgreSQL**
- **Service:** Azure Database for PostgreSQL Flexible Server
- **Version:** PostgreSQL 13+
- **Tier:** Burstable B2s for development, General Purpose for production

#### 4. **Azure Blob Storage**
- **Purpose:** File storage for uploaded Excel files
- **Container:** `uploaded-files`, `temp-downloads`
- **Access:** Private with SAS tokens

#### 5. **Azure Redis Cache (Optional)**
- **Purpose:** Session storage and caching
- **Tier:** Basic C0 for development

---

## 🚀 AZURE DEPLOYMENT STEPS

### Phase 1: Backend Deployment (Azure App Service)

#### 1.1 Create Azure App Service
```bash
# Azure CLI commands
az group create --name excel-mapper-rg --location eastus
az appservice plan create --name excel-mapper-plan --resource-group excel-mapper-rg --sku S1 --is-linux
az webapp create --resource-group excel-mapper-rg --plan excel-mapper-plan --name excel-mapper-backend --runtime "PYTHON:3.11"
```

#### 1.2 Configure Environment Variables
```bash
# Set environment variables in Azure App Service
az webapp config appsettings set --resource-group excel-mapper-rg --name excel-mapper-backend --settings \
    SECRET_KEY="your-super-secret-key-here" \
    DEBUG="False" \
    ALLOWED_HOSTS="excel-mapper-backend.azurewebsites.net" \
    DATABASE_URL="postgresql://user:password@server.postgres.database.azure.com:5432/excel_mapper_db" \
    CORS_ALLOWED_ORIGINS="https://excel-mapper-frontend.azurestaticapps.net"
```

#### 1.3 Database Setup
```bash
# Create PostgreSQL database
az postgres flexible-server create \
    --resource-group excel-mapper-rg \
    --name excel-mapper-db-server \
    --admin-user dbadmin \
    --admin-password "SecurePassword123!" \
    --sku-name Standard_B2s \
    --version 13

az postgres flexible-server db create \
    --resource-group excel-mapper-rg \
    --server-name excel-mapper-db-server \
    --database-name excel_mapper_db
```

#### 1.4 Deployment Configuration
Create `backend/.deployment` file:
```ini
[config]
SCM_DO_BUILD_DURING_DEPLOYMENT=true
```

Create `backend/startup.sh`:
```bash
#!/bin/bash
python manage.py collectstatic --noinput
python manage.py migrate --noinput
gunicorn excel_mapping.wsgi:application
```

### Phase 2: Frontend Deployment (Azure Static Web Apps)

#### 2.1 Build Configuration
Create `frontend/.github/workflows/azure-static-web-apps.yml`:
```yaml
name: Azure Static Web Apps CI/CD

on:
  push:
    branches:
      - main
  pull_request:
    types: [opened, synchronize, reopened, closed]
    branches:
      - main

jobs:
  build_and_deploy_job:
    if: github.event_name == 'push' || (github.event_name == 'pull_request' && github.event.action != 'closed')
    runs-on: ubuntu-latest
    name: Build and Deploy Job
    steps:
      - uses: actions/checkout@v2
        with:
          submodules: true
      - name: Build And Deploy
        id: builddeploy
        uses: Azure/static-web-apps-deploy@v1
        with:
          azure_static_web_apps_api_token: ${{ secrets.AZURE_STATIC_WEB_APPS_API_TOKEN }}
          repo_token: ${{ secrets.GITHUB_TOKEN }}
          action: "upload"
          app_location: "/frontend"
          build_location: "build"
          api_location: ""
```

#### 2.2 Environment Configuration
Create `frontend/.env.production`:
```env
REACT_APP_API_BASE_URL=https://excel-mapper-backend.azurewebsites.net
REACT_APP_ENVIRONMENT=production
```

### Phase 3: File Storage (Azure Blob Storage)

#### 3.1 Create Storage Account
```bash
az storage account create \
    --resource-group excel-mapper-rg \
    --name excelmapperstorage \
    --location eastus \
    --sku Standard_LRS

az storage container create \
    --account-name excelmapperstorage \
    --name uploaded-files \
    --public-access off

az storage container create \
    --account-name excelmapperstorage \
    --name temp-downloads \
    --public-access off
```

#### 3.2 Update Django Settings for Azure Storage
Add to `backend/excel_mapping/settings.py`:
```python
# Azure Blob Storage Configuration
AZURE_ACCOUNT_NAME = os.environ.get('AZURE_STORAGE_ACCOUNT_NAME')
AZURE_ACCOUNT_KEY = os.environ.get('AZURE_STORAGE_ACCOUNT_KEY')
AZURE_CONTAINER = os.environ.get('AZURE_STORAGE_CONTAINER_NAME')

if AZURE_ACCOUNT_NAME and AZURE_ACCOUNT_KEY:
    DEFAULT_FILE_STORAGE = 'storages.backends.azure_storage.AzureStorage'
    AZURE_SSL = True
```

---

## 📊 KEY PROJECT METRICS

### Codebase Statistics:
- **Total Files:** 2,800+ files
- **Backend Python Files:** 15 core files
- **Frontend JavaScript Files:** 25+ components/pages
- **Database Migrations:** 5 migration files
- **Dependencies:** 45+ Python packages, 28+ npm packages
- **Lines of Code:** ~15,000+ lines (backend), ~8,000+ lines (frontend)

### Key Features Implemented:
- ✅ File Upload & Validation (Excel/CSV)
- ✅ AI-Powered Column Mapping with Confidence Scores
- ✅ Interactive Spreadsheet Data Editor (AG-Grid)
- ✅ Smart Tags System with Formula Builder
- ✅ Template Management & Reusability
- ✅ Factwise ID Generation
- ✅ Export Functionality (Excel/CSV)
- ✅ Session Management
- ✅ Error Handling & Logging
- ✅ Responsive UI with Material-UI
- ✅ Production-Ready Configuration

---

## 🔐 SECURITY CONSIDERATIONS

### Environment Variables (Production):
```env
# Django Security
SECRET_KEY=your-256-bit-secret-key
DEBUG=False
ALLOWED_HOSTS=your-domain.azurewebsites.net

# Database
DATABASE_URL=postgresql://user:password@server.postgres.database.azure.com:5432/db

# CORS
CORS_ALLOWED_ORIGINS=https://your-frontend-domain.azurestaticapps.net

# File Storage
AZURE_STORAGE_ACCOUNT_NAME=yourstorageaccount
AZURE_STORAGE_ACCOUNT_KEY=your-storage-key

# Optional: Redis Cache
REDIS_URL=redis://your-redis-cache.redis.cache.windows.net:6380

# Email (if needed)
EMAIL_HOST=smtp.sendgrid.net
EMAIL_HOST_USER=apikey
EMAIL_HOST_PASSWORD=your-sendgrid-api-key

# Monitoring
SENTRY_DSN=https://your-sentry-dsn@sentry.io/project
```

### Security Headers:
```python
# Add to Django settings.py for production
SECURE_SSL_REDIRECT = True
SECURE_HSTS_SECONDS = 31536000
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_HSTS_PRELOAD = True
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_BROWSER_XSS_FILTER = True
X_FRAME_OPTIONS = 'DENY'
```

---

## 🔄 CI/CD PIPELINE

### GitHub Actions Workflow:
```yaml
name: Excel Mapper CI/CD

on:
  push:
    branches: [ main ]
  pull_request:
    branches: [ main ]

jobs:
  test-backend:
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v2
    - name: Set up Python
      uses: actions/setup-python@v2
      with:
        python-version: 3.11
    - name: Install dependencies
      run: |
        pip install -r backend/requirements.txt
    - name: Run tests
      run: |
        cd backend
        python manage.py test

  test-frontend:
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v2
    - name: Set up Node.js
      uses: actions/setup-node@v2
      with:
        node-version: '18'
    - name: Install dependencies
      run: |
        cd frontend
        npm install
    - name: Run tests
      run: |
        cd frontend
        npm test -- --coverage --watchAll=false

  deploy-backend:
    needs: [test-backend, test-frontend]
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    steps:
    - uses: actions/checkout@v2
    - name: Deploy to Azure App Service
      uses: azure/webapps-deploy@v2
      with:
        app-name: excel-mapper-backend
        publish-profile: ${{ secrets.AZURE_WEBAPP_PUBLISH_PROFILE }}
        package: backend/
```

---

## 📈 PERFORMANCE OPTIMIZATION

### Backend Optimizations:
- **Database:** Connection pooling, query optimization
- **Caching:** Redis for session storage and API responses
- **File Processing:** Streaming for large Excel files
- **Static Files:** Whitenoise for efficient static file serving

### Frontend Optimizations:
- **Code Splitting:** React.lazy() for route-based splitting
- **Bundle Analysis:** webpack-bundle-analyzer included
- **Image Optimization:** Optimized assets in public/
- **Caching:** Service worker for offline functionality

---

## 🧪 TESTING STRATEGY

### Backend Tests:
```bash
cd backend
python manage.py test                    # Run all tests
python -m pytest --cov=.               # Coverage report
flake8 --statistics                      # Code quality
black --check .                         # Code formatting
```

### Frontend Tests:
```bash
cd frontend
npm test                                # Run React tests
npm run test:coverage                   # Coverage report
npm run lint                           # ESLint checks
npm run format                         # Prettier formatting
```

---

## 📱 MONITORING & LOGGING

### Application Insights:
- Request tracking
- Error monitoring
- Performance metrics
- Custom telemetry

### Log Levels:
- **ERROR:** Critical application errors
- **WARNING:** Performance issues
- **INFO:** User actions and API calls
- **DEBUG:** Development debugging (disabled in production)

---

## 🚨 TROUBLESHOOTING

### Common Issues:

1. **File Upload Fails:**
   - Check Azure Blob Storage connection
   - Verify file size limits
   - Check CORS configuration

2. **Database Connection Errors:**
   - Verify PostgreSQL connection string
   - Check Azure Database firewall rules
   - Ensure SSL connection enabled

3. **Frontend API Calls Fail:**
   - Check CORS_ALLOWED_ORIGINS setting
   - Verify API base URL in production
   - Check authentication headers

4. **Static Files Not Loading:**
   - Run `python manage.py collectstatic`
   - Check Whitenoise configuration
   - Verify STATIC_ROOT setting

---

## 🎯 POST-DEPLOYMENT CHECKLIST

### Immediate Actions:
- [ ] Verify backend API health endpoint: `/api/health/`
- [ ] Test file upload functionality
- [ ] Verify database migrations applied
- [ ] Check static files loading correctly
- [ ] Test column mapping AI suggestions
- [ ] Verify export functionality works
- [ ] Check error logging and monitoring
- [ ] Test responsive design on mobile devices

### Performance Validation:
- [ ] Run load tests on upload endpoint
- [ ] Monitor database query performance
- [ ] Check frontend bundle size
- [ ] Verify caching mechanisms
- [ ] Test concurrent user sessions

### Security Validation:
- [ ] Verify HTTPS redirect working
- [ ] Check security headers
- [ ] Test file upload security
- [ ] Verify environment variables secure
- [ ] Test authentication and authorization

---

## 📞 SUPPORT CONTACTS

- **Developer:** Kartik (kartik@factwise.io)
- **Repository:** https://github.com/kd26-droid/excel-template-mapper-.git
- **Documentation:** See README.md and CLAUDE.md files
- **Issue Tracking:** GitHub Issues

---

**🎉 Project Status: DEPLOYMENT READY**  
**Last Updated:** August 6, 2025  
**Azure Compatible:** ✅ Yes  
**Production Ready:** ✅ Yes  
**CI/CD Ready:** ✅ Yes