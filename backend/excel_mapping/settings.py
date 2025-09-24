"""
Production-ready settings for Excel Template Mapper application.
"""

import os
from pathlib import Path
from typing import Dict, Any

# Build paths inside the project like this: BASE_DIR / 'subdir'.
BASE_DIR = Path(__file__).resolve().parent.parent

# Security Settings
SECRET_KEY = os.environ.get(
    'SECRET_KEY', 
    'django-insecure-change-this-in-production'
)

DEBUG = os.environ.get('DEBUG', 'False').lower() in ('true', '1', 'yes')

ALLOWED_HOSTS = os.environ.get('ALLOWED_HOSTS', 'factwise-excel-mapper-backend.azurewebsites.net,localhost,127.0.0.1').split(',')

# Application definition
DJANGO_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
]

THIRD_PARTY_APPS = [
    'rest_framework',
    'corsheaders',
]

LOCAL_APPS = [
    'excel_mapper',
]

INSTALLED_APPS = DJANGO_APPS + THIRD_PARTY_APPS + LOCAL_APPS

MIDDLEWARE = [
    'corsheaders.middleware.CorsMiddleware',
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'excel_mapping.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'excel_mapping.wsgi.application'

# Database Configuration
DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.sqlite3',
        'NAME': BASE_DIR / 'db.sqlite3',
    }
}

# Production database configuration (PostgreSQL recommended)
if os.environ.get('DATABASE_URL'):
    import dj_database_url
    DATABASES['default'] = dj_database_url.parse(os.environ.get('DATABASE_URL'))

# REST Framework Configuration
REST_FRAMEWORK = {
    'DEFAULT_RENDERER_CLASSES': [
        'rest_framework.renderers.JSONRenderer',
    ],
    'DEFAULT_PARSER_CLASSES': [
        'rest_framework.parsers.JSONParser',
        'rest_framework.parsers.MultiPartParser',
        'rest_framework.parsers.FileUploadParser',
    ],
    'DEFAULT_PERMISSION_CLASSES': [
        'rest_framework.permissions.AllowAny',
    ],
    'DEFAULT_PAGINATION_CLASS': 'rest_framework.pagination.PageNumberPagination',
    'PAGE_SIZE': 20,
}

# CORS Configuration
# Exact origins (comma-separated)
CORS_ALLOWED_ORIGINS = os.environ.get(
    'CORS_ALLOWED_ORIGINS',
    'http://localhost:3000,http://127.0.0.1:3000,http://localhost:3001,http://127.0.0.1:3001'
).split(',')

# Regex origins (comma-separated Python regex patterns)
raw_origin_regexes = os.environ.get(
    'CORS_ALLOWED_ORIGIN_REGEXES',
    r'^https?://.*\\.azurewebsites\\.net$'
)
CORS_ALLOWED_ORIGIN_REGEXES = [pattern.strip() for pattern in raw_origin_regexes.split(',') if pattern.strip()]

CORS_ALLOW_ALL_ORIGINS = DEBUG  # Only allow all origins in development

# File Upload Configuration
# Stream large uploads to disk early to avoid memory pressure
# Keep thresholds modest; Nginx enforces the true max body size
FILE_UPLOAD_MAX_MEMORY_SIZE = int(os.environ.get('FILE_UPLOAD_MAX_MEMORY_SIZE', str(10 * 1024 * 1024)))  # 10MB
DATA_UPLOAD_MAX_MEMORY_SIZE = int(os.environ.get('DATA_UPLOAD_MAX_MEMORY_SIZE', str(10 * 1024 * 1024)))  # 10MB
FILE_UPLOAD_PERMISSIONS = 0o644

# Media and Static Files
MEDIA_URL = '/media/'
MEDIA_ROOT = BASE_DIR / 'media'

STATIC_URL = '/static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'

# Logging Configuration (Azure-compatible)
LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'formatters': {
        'verbose': {
            'format': '[{asctime}] {levelname} {name} {message}',
            'style': '{',
            'datefmt': '%Y-%m-%d %H:%M:%S'
        },
        'simple': {
            'format': '[{asctime}] {levelname} {message}',
            'style': '{',
            'datefmt': '%Y-%m-%d %H:%M:%S'
        },
        'debug': {
            'format': '[{asctime}] 🔍 {levelname} {name} {funcName}:{lineno} {message}',
            'style': '{',
            'datefmt': '%Y-%m-%d %H:%M:%S.%f'
        }
    },
    'handlers': {
        'console': {
            'class': 'logging.StreamHandler',
            'formatter': 'debug',
            'level': 'DEBUG',
        },
        'file': {
            'class': 'logging.FileHandler',
            'filename': BASE_DIR / 'debug.log',
            'formatter': 'debug',
            'level': 'DEBUG',
        },
        'error_file': {
            'class': 'logging.FileHandler',
            'filename': BASE_DIR / 'error.log',
            'formatter': 'verbose',
            'level': 'ERROR',
        }
    },
    'loggers': {
        'excel_mapper': {
            'handlers': ['console', 'file', 'error_file'],
            'level': 'DEBUG',
            'propagate': False,
        },
        'django': {
            'handlers': ['console', 'file'],
            'level': 'INFO',
            'propagate': False,
        },
        'django.request': {
            'handlers': ['console', 'file', 'error_file'],
            'level': 'DEBUG',
            'propagate': False,
        },
        'django.db.backends': {
            'handlers': ['console', 'file'],
            'level': 'DEBUG',
            'propagate': False,
        }
    },
    'root': {
        'handlers': ['console', 'file'],
        'level': 'INFO',
    },
}

# Internationalization
LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'UTC'
USE_I18N = True
USE_TZ = True

# Default primary key field type
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

# Azure Document Intelligence Configuration
AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT = os.environ.get(
    'AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT',
    'https://fw-ocr-form-recognizer.cognitiveservices.azure.com/'
)
AZURE_DOCUMENT_INTELLIGENCE_KEY = os.environ.get(
    'AZURE_DOCUMENT_INTELLIGENCE_KEY'
)

# PDF Processing Configuration
PDF_CONFIG = {
    'max_file_size_mb': int(os.environ.get('PDF_MAX_FILE_SIZE_MB', '50')),
    'max_pages': int(os.environ.get('PDF_MAX_PAGES', '50')),
    'image_dpi': int(os.environ.get('PDF_IMAGE_DPI', '300')),  # Higher DPI for better accuracy
    'supported_formats': ['.pdf'],
    'ocr_model': 'prebuilt-layout',  # Layout model for table extraction (confirmed available)
    'confidence_threshold': 0.8,  # Higher threshold for better quality
    'processing_timeout_seconds': 600,  # Longer timeout for complex processing
}

# Application-specific settings
APP_CONFIG = {
    'max_file_size_mb': int(os.environ.get('MAX_FILE_SIZE_MB', '25')),
    'session_timeout_minutes': int(os.environ.get('SESSION_TIMEOUT_MINUTES', '60')),
    'max_sessions_per_user': int(os.environ.get('MAX_SESSIONS_PER_USER', '10')),
    'cleanup_temp_files_hours': int(os.environ.get('CLEANUP_TEMP_FILES_HOURS', '24')),
    'default_page_size': int(os.environ.get('DEFAULT_PAGE_SIZE', '20')),
    'max_page_size': int(os.environ.get('MAX_PAGE_SIZE', '100')),
}

# Cache Configuration
CACHES = {
    'default': {
        'BACKEND': 'django.core.cache.backends.redis.RedisCache',
        'LOCATION': os.environ.get('REDIS_URL', 'redis://127.0.0.1:6379/1'),
    } if os.environ.get('REDIS_URL') else {
        'BACKEND': 'django.core.cache.backends.locmem.LocMemCache',
        'LOCATION': 'excel-mapper-cache',
    }
}

# Security settings for production
if not DEBUG:
    SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
    # SECURE_SSL_REDIRECT = True
    SECURE_HSTS_SECONDS = 31536000
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    SECURE_HSTS_PRELOAD = True
    SECURE_CONTENT_TYPE_NOSNIFF = True
    SECURE_BROWSER_XSS_FILTER = True
    X_FRAME_OPTIONS = 'DENY'
    SECURE_REFERRER_POLICY = 'strict-origin-when-cross-origin'
