# Multi-stage build for Excel Template Mapper

# Backend build stage
FROM python:3.11-slim AS backend-build

WORKDIR /app/backend

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy backend requirements and install Python dependencies
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend code
COPY backend/ .

# Create necessary directories
RUN mkdir -p media/uploads temp_downloads uploaded_files logs
RUN chmod -R 755 media temp_downloads uploaded_files logs

# Set environment variables
ENV PYTHONPATH=/app/backend
ENV DJANGO_SETTINGS_MODULE=excel_mapping.settings

# Frontend build stage
FROM node:18-alpine AS frontend-build

WORKDIR /app/frontend

# Accept API base URL at build time for CRA
ARG REACT_APP_API_BASE_URL
ENV REACT_APP_API_BASE_URL=${REACT_APP_API_BASE_URL}

# Copy frontend package files
COPY frontend/package*.json ./

# Install dependencies
RUN npm ci

# Copy frontend source code
COPY frontend/ .

# Build frontend
ENV CI=false
ENV ESLINT_NO_DEV_ERRORS=true
RUN npm run build

# Final stage
FROM python:3.11-slim

WORKDIR /app

# Install system dependencies including poppler for PDF processing
RUN apt-get update && apt-get install -y \
    nginx \
    curl \
    openssh-server \
    poppler-utils \
    && rm -rf /var/lib/apt/lists/*

# Prepare SSH server
RUN mkdir -p /var/run/sshd
RUN sed -i 's/#\?PermitRootLogin .*/PermitRootLogin yes/' /etc/ssh/sshd_config \
 && sed -i 's/#\?PasswordAuthentication .*/PasswordAuthentication yes/' /etc/ssh/sshd_config \
 && echo 'root:Docker!' | chpasswd

# Copy backend from build stage
COPY --from=backend-build /app/backend /app/backend
COPY --from=backend-build /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=backend-build /usr/local/bin /usr/local/bin

# Copy frontend build from build stage
COPY --from=frontend-build /app/frontend/build /app/frontend/build
RUN ls -la /app/frontend/build || true \
 && test -f /app/frontend/build/index.html

# Configure nginx (ensure our config is loaded)
RUN rm -f /etc/nginx/conf.d/default.conf || true \
 && rm -f /etc/nginx/sites-enabled/default || true
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy startup script
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
# Normalize potential CRLF and make executable (prevents 'no such file' on Azure)
RUN sed -i 's/\r$//' /app/docker-entrypoint.sh \
 && chmod +x /app/docker-entrypoint.sh \
 && ls -la /app/docker-entrypoint.sh

# Expose ports
EXPOSE 80 2222

# Set working directory to backend for easier command execution
WORKDIR /app/backend

# Start services
CMD ["/app/docker-entrypoint.sh"]