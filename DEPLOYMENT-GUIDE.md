# 🚀 Fresh Deployment Scripts

These scripts provide a complete fresh deployment process for your Excel Template Mapper application. They handle everything from cleaning up old Docker resources to pushing the new image to Azure.

## 📋 What the Scripts Do

1. **Complete Docker Cleanup**: Removes all containers, images, and build cache
2. **Fresh Code Build**: Builds Docker image with `--no-cache` to ensure latest code
3. **Interactive Tag Selection**: Asks you for a custom tag name
4. **Azure Deployment**: Pushes to ACR and updates the web app
5. **Verification**: Waits for deployment and verifies it's working

## 🖥️ Usage

### For macOS/Linux:
```bash
./deploy-fresh.sh
```

### For Windows:
```cmd
deploy-fresh.bat
```

## 💡 Example Workflow

1. Make changes to your code
2. Run the deployment script
3. When prompted, enter a tag name like:
   - `kartik-v3`
   - `mapping-fix-final`
   - `production-ready`
   - `bug-fix-12345`

## 🔧 What Gets Cleaned

- **Docker containers** (stopped and removed)
- **Docker images** (old builds removed)
- **Docker build cache** (completely cleared)
- **Frontend build cache** (`frontend/build/`, `node_modules/.cache`, `.eslintcache`)
- **Backend cache** (`.pyc` files, `__pycache__` directories)

## 📦 Deployment Process

1. Builds image as: `excelmapperacr20994.azurecr.io/excel-template-mapper:YOUR-TAG`
2. Pushes to Azure Container Registry
3. Updates web app: `excel-mapper-backend-211640`
4. Restarts the application
5. Verifies deployment is working

## 🌐 Application URLs

After successful deployment:
- **Frontend**: https://excel-mapper-backend-211640.azurewebsites.net
- **API**: https://excel-mapper-backend-211640.azurewebsites.net/api/
- **Health Check**: https://excel-mapper-backend-211640.azurewebsites.net/api/health/

## 🔍 Troubleshooting

### Script Fails at Docker Build
- Check if Docker Desktop is running
- Ensure you have enough disk space
- Check for syntax errors in your code

### Script Fails at Azure Login
- Run `az login` manually first
- Check your Azure subscription access

### Application Not Starting (502 errors)
- Wait 2-3 minutes for container to fully start
- Check logs: `az webapp log tail --name excel-mapper-backend-211640 --resource-group excel-mapper-rg-new`

### Tag Not Visible in Registry
- Wait a few minutes for Azure to process
- Check: `az acr repository show-tags --name excelmapperacr20994 --repository excel-template-mapper`

## 🎯 Benefits

✅ **Always Fresh**: No cached builds, always uses latest code  
✅ **Interactive**: You choose the tag name for easy identification  
✅ **Complete**: Handles entire deployment pipeline  
✅ **Safe**: Cleans up resources to prevent conflicts  
✅ **Verified**: Waits and confirms deployment is working  

## 📝 Notes

- The script uses `--no-cache` to ensure fresh builds
- It targets `linux/amd64` platform for Azure compatibility
- All cleanup is performed before building
- The script will wait up to 2 minutes for the application to start

---

**Ready to deploy your latest changes? Just run the script and enter your desired tag name!** 🚀