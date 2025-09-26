# Docker Commands for Excel Template Mapper

This file contains essential Docker commands for running the Excel Template Mapper application on both Mac and Windows.

## Prerequisites

- Docker Desktop installed and running
- Git repository cloned locally

## Quick Start Commands

### 1. Build and Run with Docker Compose (Recommended)

```bash
# Build and start all services in detached mode
docker-compose up -d --build

# Access the application at http://localhost:8080
```

### 2. Stop the Application

```bash
# Stop all services
docker-compose down

# Stop and remove volumes (removes data)
docker-compose down -v
```

## Individual Docker Commands

### Build Commands

```bash
# Build the main application image
docker build -t excel-template-mapper:latest .

# Build with no cache (fresh build)
docker build --no-cache -t excel-template-mapper:latest .

# Build backend only
docker build -f Dockerfile.backend -t excel-mapper-backend .

# Build frontend only
docker build -f Dockerfile.frontend -t excel-mapper-frontend .
```

### Run Commands

```bash
# Run the complete application (frontend + backend)
docker run -d -p 8080:80 --name excel-mapper excel-template-mapper:latest

# Run backend only
docker run -d -p 8000:8000 --name excel-backend excel-mapper-backend

# Run frontend only
docker run -d -p 3000:3000 --name excel-frontend excel-mapper-frontend

# Run with environment variables
docker run -d -p 8080:80 -e DEBUG=False -e SECRET_KEY=your-secret excel-template-mapper:latest
```

## Management Commands

### Container Management

```bash
# List running containers
docker ps

# List all containers (including stopped)
docker ps -a

# Stop a specific container
docker stop excel-mapper

# Start a stopped container
docker start excel-mapper

# Restart a container
docker restart excel-mapper

# Remove a container
docker rm excel-mapper

# Force remove a running container
docker rm -f excel-mapper
```

### Image Management

```bash
# List all images
docker images

# Remove an image
docker rmi excel-template-mapper:latest

# Remove unused images
docker image prune

# Remove all unused images, containers, networks
docker system prune -a
```

### Logs and Debugging

```bash
# View container logs
docker logs excel-mapper

# Follow logs in real-time
docker logs -f excel-mapper

# View last 100 log entries
docker logs --tail 100 excel-mapper

# Execute commands inside running container
docker exec -it excel-mapper /bin/bash

# Execute commands inside running container (if bash not available)
docker exec -it excel-mapper /bin/sh
```

## Docker Compose Commands

### Basic Operations

```bash
# Start services (build if needed)
docker-compose up

# Start in background (detached mode)
docker-compose up -d

# Start with fresh build
docker-compose up --build

# Start specific service
docker-compose up frontend

# Stop services
docker-compose stop

# Stop and remove containers
docker-compose down

# Stop, remove containers, and volumes
docker-compose down -v
```

### Service Management

```bash
# View running services
docker-compose ps

# View service logs
docker-compose logs

# Follow specific service logs
docker-compose logs -f backend

# Restart a service
docker-compose restart backend

# Scale a service (if configured)
docker-compose up --scale backend=2
```

## Environment-Specific Commands

### Development

```bash
# Run with local development overrides
docker-compose -f docker-compose.yml -f docker-compose.dev.yml up

# Build for development
docker-compose -f docker-compose.dev.yml build
```

### Production

```bash
# Run production build
docker-compose -f docker-compose.prod.yml up -d

# Build for production
docker-compose -f docker-compose.prod.yml build --no-cache
```

## Troubleshooting Commands

### Common Issues

```bash
# Clean up everything and start fresh
docker-compose down -v
docker system prune -a
docker-compose up --build

# Check container resource usage
docker stats

# Inspect container configuration
docker inspect excel-mapper

# Check container health
docker exec excel-mapper curl -f http://localhost:8000/health || echo "Backend not healthy"

# Reset Docker (if things are really broken)
# On Windows: Reset Docker Desktop from the settings
# On Mac: Reset Docker Desktop from the settings
```

### File Permission Issues (Common on Windows)

```bash
# If you get permission errors, try running with elevated privileges
# Or ensure Docker Desktop has access to your drive

# Check if containers can access files
docker exec excel-mapper ls -la /app/
```

## Quick Reference

| Command | Purpose |
|---------|---------|
| `docker-compose up -d` | Start application in background |
| `docker-compose down` | Stop application |
| `docker-compose logs -f` | View live logs |
| `docker ps` | See running containers |
| `docker exec -it <container> bash` | Access container shell |
| `docker system prune` | Clean up unused resources |

## Access Points

After running the application:

- **Full Application**: http://localhost:8080
- **Backend API**: http://localhost:8000 (if running separately)
- **Frontend**: http://localhost:3000 (if running separately)

## Notes

- All commands work on both Windows (PowerShell/CMD) and Mac/Linux (Terminal)
- Ensure Docker Desktop is running before executing any commands
- The application includes both frontend and backend in a single container when using the main Dockerfile
- For development, you may want to run frontend and backend separately for hot reloading
