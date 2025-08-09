#!/bin/bash
# Azure App Service Startup Script for Excel Template Mapper
# This script runs when the backend starts on Azure

echo "🚀 Starting Excel Template Mapper Backend..."

# Install dependencies if needed
echo "📦 Installing Python dependencies..."
python -m pip install --upgrade pip
pip install -r requirements.txt

# Create necessary directories
echo "📁 Creating required directories..."
mkdir -p media/uploads
mkdir -p temp_downloads
mkdir -p uploaded_files
mkdir -p logs

# Set permissions
chmod -R 755 media
chmod -R 755 temp_downloads
chmod -R 755 uploaded_files
chmod -R 755 logs

# Collect static files
echo "🎨 Collecting static files..."
python manage.py collectstatic --noinput --verbosity 2

# Run database migrations
echo "🗄️  Running database migrations..."
python manage.py migrate --verbosity 2

# Create superuser if needed (optional)
# echo "👤 Creating superuser..."
# python manage.py shell -c "
# from django.contrib.auth import get_user_model
# User = get_user_model()
# if not User.objects.filter(username='admin').exists():
#     User.objects.create_superuser('admin', 'admin@factwise.io', 'ExcelMapper2025!')
#     print('Superuser created: admin / ExcelMapper2025!')
# else:
#     print('Superuser already exists')
# "

# Start Gunicorn server (SINGLE WORKER FOR SESSION PERSISTENCE)
echo "🌐 Starting Gunicorn server with single worker for session persistence..."
exec gunicorn excel_mapping.wsgi:application \
    --bind=0.0.0.0:${PORT:-8000} \
    --timeout 600 \
    --workers 1 \
    --max-requests 1000 \
    --max-requests-jitter 100 \
    --preload \
    --access-logfile - \
    --error-logfile - \
    --log-level info