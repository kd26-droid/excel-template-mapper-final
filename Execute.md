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

### Running the Backend (Django)

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

You can run the backend as a Docker container. This is a good way to test the production-like environment locally.

1.  **Build the Docker image:**
    From the root directory of the project, run:
    ```bash
    docker build -t excel-template-mapper-backend .
    ```

2.  **Run the Docker container:**
    ```bash
    docker run -p 8000:8000 excel-template-mapper-backend
    ```
    The backend will be running inside the container and accessible at `http://localhost:8000`.

    > **Note for Windows Users:** If you encounter a "file not found" or "no such file or directory" error when running the container, it might be due to line endings in shell scripts (`startup.sh`). The `Dockerfile` has been updated to automatically correct this, so ensure you have the latest version of the `Dockerfile` before rebuilding the image.

3.  **Run the frontend:**
    Follow the steps in the "Running the Frontend (React)" section to start the frontend development server. The frontend will connect to the containerized backend.

## 4. Deployment to Azure

The project includes a comprehensive script to automate deployment to Azure. This script will provision all the necessary resources and deploy the application.

### Pre-deployment Steps

1.  **Log in to Azure:**
    Make sure you are logged into your Azure account through the Azure CLI:
    ```bash
    az login
    ```

2.  **Set the correct subscription:**
    If you have multiple subscriptions, set the one you want to use:
    ```bash
    az account set --subscription "<Your-Subscription-ID>"
    ```

3.  **Review the deployment script:**
    Open the `deploy-to-azure.sh` script and review the configuration variables at the top. You can customize the `RESOURCE_PREFIX` and other settings if needed.

### Running the Deployment Script

1.  **Execute the script:**
    From the root directory of the project, run the script:
    ```bash
    ./deploy-to-azure.sh
    ```

2.  **Monitor the deployment:**
    The script will print its progress as it creates the resource group, database, storage account, and app services. This process can take 10-15 minutes.

### Post-deployment

1.  **Check the GitHub Actions:**
    The script sets up GitHub Actions for continuous deployment. Go to your GitHub repository and check the "Actions" tab to see the deployment progress for the backend and frontend.

2.  **Access the application:**
    Once the deployment is complete, the script will output the URLs for the frontend and backend. You can access the live application through the frontend URL.

This concludes the guide for running and deploying the Excel Template Mapper application.
