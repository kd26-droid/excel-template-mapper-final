# Excel Template Mapper - Docker & Azure Deployment Guide

This guide provides instructions for containerizing the Excel Template Mapper application and deploying it to Azure.

## Containerization

The application has been containerized using Docker with a multi-stage build process that includes both the frontend and backend in a single container. This approach simplifies deployment and ensures consistency between environments.

### Docker Setup

The following files have been created/modified for containerization:

1. `Dockerfile` - Multi-stage build for both frontend and backend
2. `nginx.conf` - Nginx configuration to serve frontend and proxy backend requests
3. `docker-entrypoint.sh` - Script to start both services
4. `docker-compose.yml` - For local development and testing

### Building and Running Locally

```bash
# Build the Docker image
docker build -t excel-template-mapper:latest .

# Run with docker-compose
docker-compose up -d
```

The application will be available at http://localhost:8080

## Azure Deployment

To deploy the containerized application to Azure, follow these steps:

### Prerequisites

1. Azure CLI installed and configured
2. Azure Container Registry (ACR) access
3. Azure App Service plan

### Deployment Steps

1. **Log in to Azure**

```bash
az login
```

2. **Create a resource group (if not already created)**

```bash
az group create --name excel-mapper-rg --location eastus
```

3. **Create an Azure Container Registry (if not already created)**

```bash
az acr create --resource-group excel-mapper-rg --name excelmapperregistry --sku Basic
```

4. **Log in to the container registry**

```bash
az acr login --name excelmapperregistry
```

5. **Tag and push the Docker image to ACR**

```bash
docker tag excel-template-mapper:latest excelmapperregistry.azurecr.io/excel-template-mapper:latest
docker push excelmapperregistry.azurecr.io/excel-template-mapper:latest
```

6. **Create an App Service plan**

```bash
az appservice plan create --resource-group excel-mapper-rg --name excel-mapper-plan --is-linux --sku B1
```

7. **Create a Web App for Containers**

```bash
az webapp create --resource-group excel-mapper-rg --plan excel-mapper-plan --name excel-mapper-app --deployment-container-image-name excelmapperregistry.azurecr.io/excel-template-mapper:latest
```

8. **Configure the Web App to use the ACR image**

```bash
az webapp config container set --name excel-mapper-app --resource-group excel-mapper-rg --docker-custom-image-name excelmapperregistry.azurecr.io/excel-template-mapper:latest --docker-registry-server-url https://excelmapperregistry.azurecr.io
```

9. **Set environment variables**

```bash
az webapp config appsettings set --resource-group excel-mapper-rg --name excel-mapper-app --settings \
SECRET_KEY="your-secret-key" \
DEBUG=False \
ALLOWED_HOSTS="excel-mapper-app.azurewebsites.net" \
DATABASE_URL="your-database-connection-string" \
CORS_ALLOWED_ORIGINS="https://excel-mapper-app.azurewebsites.net"
```

10. **Restart the Web App**

```bash
az webapp restart --name excel-mapper-app --resource-group excel-mapper-rg
```

The application will be available at https://excel-mapper-app.azurewebsites.net

## Blob Storage Setup

The application uses Azure Blob Storage for file handling. Set up as follows:

1. **Create a Storage Account**

```bash
az storage account create --resource-group excel-mapper-rg --name excelmapperstorage --location eastus --sku Standard_LRS
```

2. **Create a Blob Container**

```bash
az storage container create --account-name excelmapperstorage --name excel-files --auth-mode login
```

3. **Get Connection String**

```bash
az storage account show-connection-string --resource-group excel-mapper-rg --name excelmapperstorage
```

4. **Update Environment Variables**

Add to the Web App settings:

```bash
az webapp config appsettings set --resource-group excel-mapper-rg --name excel-mapper-app --settings \
AZURE_STORAGE_CONNECTION_STRING="your-connection-string" \
AZURE_STORAGE_CONTAINER_NAME="excel-files"
```

## API Configuration

The backend APIs are served through Nginx proxy. After deployment:

- API base URL: https://excel-mapper-app.azurewebsites.net/api/
- Admin: https://excel-mapper-app.azurewebsites.net/admin/
- Ensure CORS is configured correctly in environment variables.

## Database Migrations

Migrations are handled in the `docker-entrypoint.sh` script, which runs `python manage.py migrate` on container start. For initial setup or changes:

1. Connect to the Web App container:

```bash
az webapp ssh --resource-group excel-mapper-rg --name excel-mapper-app
```

2. Run migrations manually if needed:

```bash
python manage.py migrate
```

For production deployment, you should use Azure Database for PostgreSQL:

1. **Create an Azure Database for PostgreSQL**

```bash
az postgres server create --resource-group excel-mapper-rg --name excel-mapper-db --location eastus --admin-user dbadmin --admin-password "YourStrongPassword!" --sku-name GP_Gen5_2
```

2. **Configure firewall rules**

```bash
az postgres server firewall-rule create --resource-group excel-mapper-rg --server excel-mapper-db --name AllowAzureServices --start-ip-address 0.0.0.0 --end-ip-address 0.0.0.0
```

3. **Create a database**

```bash
az postgres db create --resource-group excel-mapper-rg --server-name excel-mapper-db --name excel_mapper_db
```

4. **Update the Web App's DATABASE_URL setting**

```bash
az webapp config appsettings set --resource-group excel-mapper-rg --name excel-mapper-app --settings \
DATABASE_URL="postgresql://dbadmin:YourStrongPassword!@excel-mapper-db.postgres.database.azure.com:5432/excel_mapper_db?sslmode=require"
```

## Continuous Deployment

To set up continuous deployment from GitHub:

1. **Configure GitHub Actions**

The repository already contains a GitHub Actions workflow file at `.github/workflows/deploy.yml`. Update this file with your Azure credentials and container registry information.

2. **Add GitHub Secrets**

In your GitHub repository, add the following secrets:

- `AZURE_CREDENTIALS`: JSON output from `az ad sp create-for-rbac`
- `REGISTRY_USERNAME`: ACR username
- `REGISTRY_PASSWORD`: ACR password

## Monitoring and Maintenance

1. **View logs**

```bash
az webapp log tail --name excel-mapper-app --resource-group excel-mapper-rg
```

2. **Scale the application**

```bash
az appservice plan update --resource-group excel-mapper-rg --name excel-mapper-plan --sku S1
```

3. **Set up Application Insights**

```bash
az monitor app-insights component create --app excel-mapper-insights --location eastus --resource-group excel-mapper-rg --application-type web
```

## Troubleshooting

- **Container doesn't start**: Check logs with `az webapp log tail`
- **Database connection issues**: Verify firewall rules and connection string
- **Frontend not loading**: Check CORS settings and Nginx configuration
- **Blob Storage issues**: Verify connection string and container name in app settings.
- **API errors**: Check Nginx logs and CORS settings.
- **Migration failures**: Review container logs for database connection issues.