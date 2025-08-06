# Gunicorn configuration file for Azure App Service

bind = "0.0.0.0:8000"
workers = 2
worker_connections = 1000
timeout = 600
keepalive = 2
max_requests = 1000
max_requests_jitter = 100
preload_app = True
accesslog = "-"
errorlog = "-"
loglevel = "info"
capture_output = True
enable_stdio_inheritance = True