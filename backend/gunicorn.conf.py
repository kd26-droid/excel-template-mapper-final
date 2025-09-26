# Gunicorn configuration file for Azure App Service
# IMPORTANT: Using single worker to ensure session persistence across requests
# Multi-worker configuration causes session loss due to separate memory spaces

bind = "0.0.0.0:8000"
workers = 1  # Changed from 2 to 1 to fix session persistence issues
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

# Single worker ensures that:
# 1. All requests hit the same process with the same SESSION_STORE memory
# 2. Sessions created in /upload/ are accessible in /headers/{session_id}/
# 3. No need for complex file-based session synchronization
# 4. Immediate fix for the 404 "Session not found" errors

# Note: For high-traffic production, consider using Redis or database-backed sessions
# instead of increasing worker count, to maintain session persistence