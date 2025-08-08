# Excel Template Mapper

A professional application for mapping and transforming Excel data between different templates.

## Overview

Excel Template Mapper allows users to:

- Upload Excel files with different formats
- Map columns between source and target templates
- Transform data according to business rules
- Generate new Excel files with the transformed data

## Project Structure

- **Frontend**: React application with Material UI components
- **Backend**: Django REST API with pandas for Excel processing

## Quick Start with Docker

The easiest way to run the application is using Docker:

1. Make sure Docker is installed and running on your system
2. Run the start script:

```bash
./start_docker_app.sh
```

3. Access the application at http://localhost:8080

## Manual Setup

For development or if you prefer not to use Docker, see [Execute.md](Execute.md) for detailed instructions on setting up and running the application manually.

## Deployment

For deployment to Azure, see [DOCKER_AZURE_DEPLOYMENT.md](DOCKER_AZURE_DEPLOYMENT.md) for detailed instructions.

## Features

- Intuitive UI for mapping Excel columns
- Support for complex data transformations
- Preview of transformed data
- Download of generated Excel files
- Persistent mapping templates

## Technologies

- **Frontend**: React, Material UI, AG Grid
- **Backend**: Django, Django REST Framework, pandas
- **Containerization**: Docker, docker-compose
- **Deployment**: Azure App Service, Azure Container Registry

## License

This project is proprietary and confidential.