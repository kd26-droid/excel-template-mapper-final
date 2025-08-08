#!/bin/bash
# Docker entrypoint script for Excel Template Mapper

set -e

echo "🚀 Starting Excel Template Mapper..."

# Backend setup
cd /app/backend

# Install dependencies if needed
echo "📦 Checking Python dependencies..."
python -m pip install --upgrade pip
pip install -r requirements.txt

# Create necessary directories
echo "📁 Ensuring required directories exist..."
mkdir -p media/uploads
mkdir -p temp_downloads
mkdir -p uploaded_files
mkdir -p logs
mkdir -p static

# Set permissions
chmod -R 755 media
chmod -R 755 temp_downloads
chmod -R 755 uploaded_files
chmod -R 755 logs
chmod -R 755 static

# Collect static files
echo "🎨 Collecting static files..."
python manage.py collectstatic --noinput --verbosity 1

# Run database migrations
echo "🗄️ Running database migrations..."
python manage.py migrate --verbosity 1

# Start Gunicorn in the background
echo "🌐 Starting Gunicorn server..."
gunicorn excel_mapping.wsgi:application \
    --bind=0.0.0.0:8000 \
    --timeout 600 \
    --workers 2 \
    --daemon

# Start Nginx
echo "🖥️ Starting Nginx server..."
nginx -g "daemon off;"