# 🚀 EXCEL TEMPLATE MAPPER - AZURE DEPLOYMENT INSTRUCTIONS

## 🎯 **READY TO DEPLOY!**

Your complete Azure deployment package is ready. Follow these simple steps to get your application live.

---

## 📋 **PRE-REQUISITES**

1. **Azure Account** - You need an active Azure subscription
2. **Azure CLI** - Install from: https://docs.microsoft.com/en-us/cli/azure/install-azure-cli
3. **GitHub Account** - Already done ✅
4. **5-10 minutes** - That's all it takes!

---

## 🚀 **DEPLOYMENT STEPS**

### **Step 1: Install Azure CLI (if not already installed)**
```bash
# macOS
brew install azure-cli

# Or download from: https://docs.microsoft.com/en-us/cli/azure/install-azure-cli
```

### **Step 2: Run the Deployment Script**
```bash
cd /Users/kartikd/Downloads/mapping_factwise/BOM
./deploy-to-azure.sh
```

**That's it!** The script will:
- ✅ Login to Azure (if needed)
- ✅ Create all resources in Central India
- ✅ Set up PostgreSQL database
- ✅ Configure storage accounts
- ✅ Deploy backend API
- ✅ Deploy frontend application
- ✅ Set up CI/CD pipeline

---

## 🌐 **YOUR APPLICATION URLS**

After deployment (5-10 minutes), your application will be live at:

### **Frontend (Public Access):**
```
https://kartik-excel-mapper-frontend.azurestaticapps.net
```

### **Backend API:**
```
https://kartik-excel-mapper-backend.azurewebsites.net
```

### **Health Check:**
```
https://kartik-excel-mapper-backend.azurewebsites.net/api/health/
```

---

## 📊 **DEPLOYMENT CONFIGURATION**

| **Component** | **Service** | **Configuration** |
|---------------|-------------|-------------------|
| Frontend | Azure Static Web Apps | React 18, Material-UI |
| Backend | Azure App Service | Django, Python 3.11 |
| Database | Azure PostgreSQL | Standard_B2s, 32GB |
| Storage | Azure Blob Storage | Hot tier, 2 containers |
| Region | Central India | Pune datacenter |
| SSL | Automatic | Azure managed certificates |

---

## 🔐 **CREDENTIALS & ACCESS**

### **Database Access:**
- **Server:** `kartik-excel-mapper-db-server.postgres.database.azure.com`
- **Database:** `excel_mapper_db`
- **Username:** `dbadmin`
- **Password:** `ExcelMapper2025!`

### **Resource Group:**
- **Name:** `kartik-excel-mapper-rg`
- **Location:** Central India

---

## 🔄 **AUTOMATIC DEPLOYMENTS**

After initial deployment, any code changes pushed to GitHub will automatically deploy:

1. **Push code to GitHub** → GitHub Actions triggers
2. **Tests run** → Backend and frontend tests
3. **Build & Deploy** → Updates live application
4. **Notification** → Success/failure status

---

## 🧪 **TESTING YOUR DEPLOYMENT**

### **1. Basic Health Check**
```bash
curl https://kartik-excel-mapper-backend.azurewebsites.net/api/health/
```
Should return: `{"status": "healthy"}`

### **2. Frontend Access**
Visit: `https://kartik-excel-mapper-frontend.azurestaticapps.net`
- Should load the Excel Template Mapper interface
- Try uploading a test Excel file

### **3. Full Workflow Test**
1. Upload client Excel file + template
2. Review AI column mappings
3. Edit data in spreadsheet interface
4. Download processed file

---

## 🛠️ **TROUBLESHOOTING**

### **Common Issues:**

#### **Issue: "az command not found"**
**Solution:** Install Azure CLI first
```bash
brew install azure-cli
# or visit: https://docs.microsoft.com/en-us/cli/azure/install-azure-cli
```

#### **Issue: "Authentication required"**
**Solution:** The script will prompt you to login
```bash
az login
```

#### **Issue: "Resource name already exists"**
**Solution:** The script uses unique names, but if needed, edit the script and change `RESOURCE_PREFIX`

#### **Issue: "Deployment taking too long"**
**Solution:** Initial deployment can take 10-15 minutes. Check:
- GitHub Actions tab in your repo
- Azure portal for resource creation status

#### **Issue: "Frontend not connecting to backend"**
**Solution:** Check CORS settings in Azure App Service configuration

---

## 📈 **MONITORING & MAINTENANCE**

### **Application Insights (Optional)**
Add monitoring by enabling Application Insights in Azure portal:
1. Go to your App Service
2. Click "Application Insights"
3. Enable monitoring

### **Scaling (If Needed)**
- **Frontend:** Automatically scales (Static Web Apps)
- **Backend:** Can scale up/out from Azure portal
- **Database:** Can upgrade to higher tiers

### **Backups**
- **Database:** Automatic backups enabled
- **Storage:** Geo-redundant storage configured
- **Code:** Backed up in GitHub

---

## 💰 **COST ESTIMATION**

**Monthly costs (approximate):**
- App Service (S1): ~$15/month
- PostgreSQL (B2s): ~$12/month
- Static Web Apps: Free tier
- Storage Account: ~$2/month
- **Total: ~$29/month**

*Note: Costs may vary based on usage and Azure pricing changes.*

---

## 🔧 **ADVANCED CONFIGURATION**

### **Custom Domain (Optional)**
1. Purchase domain from any provider
2. Add CNAME record pointing to your Static Web App
3. Configure custom domain in Azure portal

### **Email Notifications (Optional)**
Add SMTP settings to backend environment variables for email features.

### **Redis Cache (Optional)**
For high-traffic scenarios, add Redis cache for better performance.

---

## 📞 **SUPPORT**

If you encounter any issues:

1. **Check GitHub Actions** - View deployment logs
2. **Azure Portal** - Check resource status
3. **Application Logs** - View App Service logs
4. **Contact** - Kartik (kartik@factwise.io)

---

## 🎉 **SUCCESS INDICATORS**

✅ **Deployment Successful When:**
- Script completes without errors
- Frontend URL loads the application
- Backend health check returns "healthy"
- You can upload and process Excel files
- Downloaded files contain processed data

---

## 🚀 **NEXT STEPS AFTER DEPLOYMENT**

1. **Test the application thoroughly**
2. **Share the URL with your team**
3. **Add any custom features needed**
4. **Set up monitoring if required**
5. **Consider custom domain if needed**

---

**🎯 Ready to go live? Run the deployment script now!**

```bash
cd /Users/kartikd/Downloads/mapping_factwise/BOM
./deploy-to-azure.sh
```

**Your Excel Template Mapper will be live on Azure in under 10 minutes!** 🚀