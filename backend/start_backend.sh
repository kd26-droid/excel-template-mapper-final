#!/bin/sh
set -e

python manage.py migrate --noinput --verbosity 1

exec gunicorn excel_mapping.wsgi:application \
  --bind 0.0.0.0:8000 \
  --workers 1 \
  --timeout 600 \
  --max-requests 1000 \
  --max-requests-jitter 100 \
  --preload \
  --access-logfile - \
  --error-logfile - \
  --log-level info
