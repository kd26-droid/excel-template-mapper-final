# How to Run This Application

This document provides a step-by-step guide to run the Excel Template Mapper application locally for development and how to deploy it to Azure for production.

## 1. Prerequisites

Before you begin, ensure you have the following software installed on your system:

- **Python** (version 3.8+): For running the Django backend.
- **Node.js** (version 16+): For running the React frontend.
- **npm** (or yarn): Package manager for Node.js.
- **Docker**: For running the application in a containerized environment.
- **Azure CLI**: For deploying the application to Azure.

## 2. Local Development Setup

For local development, you will run the backend and frontend servers separately.

### Running the Backend (Django)`

1.  **Navigate to the backend directory:**
    ```bash
    cd backend
    ```

2.  **Create and activate a Python virtual environment:**
    - On macOS/Linux:
      ```bash
      python3 -m venv venv
      source venv/bin/activate
      ```
    - On Windows:
      ```bash
      python -m venv venv
      .\venv\Scripts\activate
      ```

3.  **Install the required Python packages:**
    ```bash
    pip install -r requirements.txt
    ```

4.  **Run the database migrations:**
    ```bash
    python manage.py migrate
    ```

5.  **Start the Django development server:**
    ```bash
    python manage.py runserver
    ```
    The backend API will now be running at `http://localhost:8000`.

### Running the Frontend (React)

1.  **Open a new terminal window** and navigate to the frontend directory:
    ```bash
    cd frontend
    ```

2.  **Install the required Node.js packages:**
    ```bash
    npm install
    ```

3.  **Start the React development server:**
    ```bash
    npm start
    ```
    The frontend application will now be running at `http://localhost:3000`. It is configured to proxy API requests to the backend server.

## 3. Running with Docker (Local)

The application has been containerized with both frontend and backend in a single container. This is the recommended way to run the application for production-like environments.

1.  **Build the Docker image:**
    From the root directory of the project, run:
    ```bash
    docker build -t excel-template-mapper:latest .
    ```

2.  **Run with docker-compose:**
    ```bash
    docker-compose up -d
    ```
    The complete application (both frontend and backend) will be accessible at `http://localhost:8080`.

    > **Note for Windows Users:** If you encounter a "file not found" or "no such file or directory" error when running the container, it might be due to line endings in shell scripts. The `Dockerfile` has been updated to automatically correct this, so ensure you have the latest version of the `Dockerfile` before rebuilding the image.

3.  **Check container status:**
    ```bash
    docker ps
    ```

4.  **View logs:**
    ```bash
    docker logs excel-template-mapper
    ```

5.  **Stop the container:**
    ```bash
    docker-compose down
    ```

## 4. Deployment to Azure

The project can be deployed to Azure using the containerized approach. This provides a consistent environment between development and production.

### Option 1: Manual Deployment

1.  **Log in to Azure:**
    ```bash
    az login
    ```

2.  **Set the correct subscription:**
    ```bash
    az account set --subscription "<Your-Subscription-ID>"
    ```

3.  **Create a resource group:**
    ```bash
    az group create --name excel-mapper-rg --location eastus
    ```

4.  **Create an Azure Container Registry:**
    ```bash
    az acr create --resource-group excel-mapper-rg --name excelmapperregistry --sku Basic
    ```

5.  **Log in to the container registry:**
    ```bash
    az acr login --name excelmapperregistry
    ```

6.  **Tag and push the Docker image:**
    ```bash
    docker tag excel-template-mapper:latest excelmapperregistry.azurecr.io/excel-template-mapper:latest
    docker push excelmapperregistry.azurecr.io/excel-template-mapper:latest
    ```

7.  **Create an App Service plan:**
    ```bash
    az appservice plan create --resource-group excel-mapper-rg --name excel-mapper-plan --is-linux --sku B1
    ```

8.  **Create a Web App for Containers:**
    ```bash
    az webapp create --resource-group excel-mapper-rg --plan excel-mapper-plan --name excel-mapper-app --deployment-container-image-name excelmapperregistry.azurecr.io/excel-template-mapper:latest
    ```

9.  **Configure the Web App:**
    ```bash
    az webapp config container set --name excel-mapper-app --resource-group excel-mapper-rg --docker-custom-image-name excelmapperregistry.azurecr.io/excel-template-mapper:latest --docker-registry-server-url https://excelmapperregistry.azurecr.io
    ```

10. **Set environment variables:**
    ```bash
    az webapp config appsettings set --resource-group excel-mapper-rg --name excel-mapper-app --settings \
    SECRET_KEY="your-secret-key" \
    DEBUG=False \
    ALLOWED_HOSTS="excel-mapper-app.azurewebsites.net" \
    DATABASE_URL="your-database-connection-string" \
    CORS_ALLOWED_ORIGINS="https://excel-mapper-app.azurewebsites.net"
    ```

### Option 2: GitHub Actions Deployment

The repository includes GitHub Actions workflows for continuous deployment. To use this method:

1.  **Configure GitHub Secrets:**
    Add the following secrets to your GitHub repository:
    - `AZURE_CREDENTIALS`: JSON output from `az ad sp create-for-rbac`
    - `REGISTRY_USERNAME`: ACR username
    - `REGISTRY_PASSWORD`: ACR password

2.  **Enable the workflow:**
    The workflow file is located at `.github/workflows/deploy.yml`. Make sure it's properly configured for your Azure resources.

3.  **Trigger the deployment:**
    Push changes to your repository or manually trigger the workflow from the GitHub Actions tab.

### Post-deployment

1.  **Access the application:**
    Once the deployment is complete, you can access the application at `https://excel-mapper-app.azurewebsites.net`.

2.  **Monitor the application:**
    ```bash
    az webapp log tail --name excel-mapper-app --resource-group excel-mapper-rg
    ```

> **Note:** For detailed deployment instructions, refer to the `DOCKER_AZURE_DEPLOYMENT.md` file.

This concludes the guide for running and deploying the Excel Template Mapper application.
