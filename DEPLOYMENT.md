# Deployment Guide

## 🚀 Production Deployment

### Prerequisites
- Python 3.8+
- Node.js 16+
- PostgreSQL 12+ (recommended)
- Redis (optional, for caching)
- Nginx (recommended for production)

## Backend Deployment

### 1. Server Setup
```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install required packages
sudo apt install python3-pip python3-venv postgresql postgresql-contrib nginx redis-server

# Create project directory
sudo mkdir -p /var/www/excel-mapper
sudo chown $USER:$USER /var/www/excel-mapper
cd /var/www/excel-mapper
```

### 2. Clone and Setup Application
```bash
# Clone repository
git clone <your-repo-url> .

# Create virtual environment
cd backend
python3 -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt
pip install gunicorn psycopg2-binary
```

### 3. Database Setup
```bash
# Create PostgreSQL database
sudo -u postgres psql
CREATE DATABASE excel_mapper;
CREATE USER excel_user WITH PASSWORD 'secure_password';
GRANT ALL PRIVILEGES ON DATABASE excel_mapper TO excel_user;
\q
```

### 4. Environment Configuration
```bash
# Copy and configure environment file
cp .env.example .env
nano .env
```

Configure the following in `.env`:
```bash
DEBUG=False
SECRET_KEY=your-very-secure-50-character-secret-key-here
ALLOWED_HOSTS=your-domain.com,www.your-domain.com
DATABASE_URL=postgresql://excel_user:secure_password@localhost:5432/excel_mapper
CORS_ALLOWED_ORIGINS=https://your-domain.com
REDIS_URL=redis://127.0.0.1:6379/1
```

### 5. Django Setup
```bash
# Run migrations
python manage.py migrate

# Collect static files
python manage.py collectstatic --noinput

# Create superuser
python manage.py createsuperuser

# Test the application
python manage.py runserver 0.0.0.0:8000
```

### 6. Gunicorn Configuration
Create `/etc/systemd/system/excel-mapper.service`:
```ini
[Unit]
Description=Excel Mapper Django App
After=network.target

[Service]
User=www-data
Group=www-data
WorkingDirectory=/var/www/excel-mapper/backend
Environment="PATH=/var/www/excel-mapper/backend/venv/bin"
ExecStart=/var/www/excel-mapper/backend/venv/bin/gunicorn --workers 3 --bind unix:/var/www/excel-mapper/backend/excel_mapper.sock excel_mapping.wsgi:application
Restart=always

[Install]
WantedBy=multi-user.target
```

Start the service:
```bash
sudo systemctl daemon-reload
sudo systemctl start excel-mapper
sudo systemctl enable excel-mapper
```

## Frontend Deployment

### 1. Build the Frontend
```bash
cd ../frontend

# Install dependencies
npm install

# Build for production
npm run build
```

### 2. Nginx Configuration
Create `/etc/nginx/sites-available/excel-mapper`:
```nginx
server {
    listen 80;
    server_name your-domain.com www.your-domain.com;

    # Frontend static files
    location / {
        root /var/www/excel-mapper/frontend/build;
        index index.html;
        try_files $uri $uri/ /index.html;
    }

    # Backend API
    location /api/ {
        include proxy_params;
        proxy_pass http://unix:/var/www/excel-mapper/backend/excel_mapper.sock;
    }

    # Django admin
    location /admin/ {
        include proxy_params;
        proxy_pass http://unix:/var/www/excel-mapper/backend/excel_mapper.sock;
    }

    # Static files
    location /static/ {
        alias /var/www/excel-mapper/backend/staticfiles/;
    }

    # Media files
    location /media/ {
        alias /var/www/excel-mapper/backend/media/;
    }

    # File upload limits
    client_max_body_size 50M;
}
```

Enable the site:
```bash
sudo ln -s /etc/nginx/sites-available/excel-mapper /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

## SSL Configuration (Let's Encrypt)

```bash
# Install Certbot
sudo apt install certbot python3-certbot-nginx

# Get SSL certificate
sudo certbot --nginx -d your-domain.com -d www.your-domain.com

# Auto-renewal
sudo systemctl status certbot.timer
```

## Monitoring and Logging

### 1. Application Logs
```bash
# View Django logs
sudo journalctl -u excel-mapper -f

# View Nginx logs
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log
```

### 2. Health Check Endpoint
Add to Django `urls.py`:
```python
from django.http import JsonResponse

def health_check(request):
    return JsonResponse({"status": "healthy"})

urlpatterns = [
    path('health/', health_check),
    # ... other patterns
]
```

### 3. Process Management
```bash
# Restart services
sudo systemctl restart excel-mapper
sudo systemctl restart nginx

# Check status
sudo systemctl status excel-mapper
sudo systemctl status nginx
```

## Performance Optimization

### 1. Database Optimization
```sql
-- Add indexes for frequently queried fields
CREATE INDEX idx_mapping_template_name ON excel_mapper_mappingtemplate(name);
CREATE INDEX idx_mapping_template_created ON excel_mapper_mappingtemplate(created_at);
```

### 2. Redis Caching
```python
# In settings.py
CACHES = {
    'default': {
        'BACKEND': 'django.core.cache.backends.redis.RedisCache',
        'LOCATION': 'redis://127.0.0.1:6379/1',
        'OPTIONS': {
            'CLIENT_CLASS': 'django_redis.client.DefaultClient',
        }
    }
}
```

### 3. Static Files Compression
```nginx
# Add to nginx configuration
gzip on;
gzip_vary on;
gzip_min_length 1024;
gzip_types text/plain text/css text/xml text/javascript application/javascript application/xml+rss application/json;
```

## Backup Strategy

### 1. Database Backup
```bash
# Create backup script /usr/local/bin/backup-db.sh
#!/bin/bash
BACKUP_DIR="/var/backups/excel-mapper"
DATE=$(date +%Y%m%d_%H%M%S)
mkdir -p $BACKUP_DIR

pg_dump -U excel_user -h localhost excel_mapper > $BACKUP_DIR/db_backup_$DATE.sql
gzip $BACKUP_DIR/db_backup_$DATE.sql

# Keep only last 7 days
find $BACKUP_DIR -name "db_backup_*.sql.gz" -mtime +7 -delete
```

Add to crontab:
```bash
# Daily backup at 2 AM
0 2 * * * /usr/local/bin/backup-db.sh
```

### 2. Application Backup
```bash
# Backup uploaded files and media
rsync -av /var/www/excel-mapper/backend/media/ /backup/media/
rsync -av /var/www/excel-mapper/backend/uploaded_files/ /backup/uploaded_files/
```

## Security Checklist

- [ ] Debug mode disabled (`DEBUG=False`)
- [ ] Strong secret key configured
- [ ] Database credentials secured
- [ ] HTTPS enabled with valid SSL certificate
- [ ] Firewall configured (only ports 22, 80, 443 open)
- [ ] Regular security updates applied
- [ ] File upload directory outside web root
- [ ] CORS origins restricted to your domain
- [ ] Server headers configured (security headers)
- [ ] Log files monitored and rotated
- [ ] Database backups automated and tested

## Scaling Considerations

### Horizontal Scaling
- Use load balancer (nginx upstream)
- Shared Redis instance for session storage
- Shared database (PostgreSQL cluster)
- Shared file storage (AWS S3/similar)

### Performance Monitoring
- Monitor memory usage during Excel processing
- Track API response times
- Monitor database query performance
- Set up alerts for error rates

## Troubleshooting

### Common Issues
1. **Permission errors**: Check file ownership and permissions
2. **Database connection**: Verify PostgreSQL service and credentials
3. **Static files not loading**: Run `collectstatic` and check Nginx config
4. **File upload errors**: Check `client_max_body_size` in Nginx
5. **Memory issues**: Monitor RAM usage during large file processing

### Debugging Commands
```bash
# Check service status
sudo systemctl status excel-mapper nginx postgresql redis

# View logs
journalctl -u excel-mapper -n 100
tail -f /var/log/nginx/error.log

# Test database connection
python manage.py shell
>>> from django.db import connection
>>> connection.ensure_connection()

# Check static files
python manage.py collectstatic --dry-run
```

This deployment guide provides a complete production setup for the Excel Template Mapper application.