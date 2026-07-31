# Gunicorn configuration for Azure App Service.
#
# ONE worker, MANY threads — this is deliberate and load-bearing.
#
# The app keeps session state in an in-process dict (SESSION_STORE) plus
# module-level caches. Separate worker PROCESSES do NOT share that memory, so with
# 2+ workers a request that lands on a different worker than the one that wrote the
# data sees stale or missing state. That is the cause of the "random" behaviour:
# works only on the 2nd/3rd try, "MPN validated but the columns don't appear",
# and same-request-sometimes-times-out. A single worker keeps every request on one
# consistent memory.
#
# Threads (the gthread worker) still give concurrency: a long MPN validation waits
# on the Digi-Key API (I/O), which releases the GIL, so health checks and normal
# reads are served on other threads instead of blocking behind it.

bind = "0.0.0.0:8000"
workers = 1
worker_class = "gthread"
threads = 8
worker_connections = 1000
timeout = 600
keepalive = 2
# Recycle the (single) worker infrequently so an in-flight workflow isn't cut off;
# session state is file-persisted, so a recycle reloads cleanly either way.
max_requests = 2000
max_requests_jitter = 200
preload_app = True
accesslog = "-"
errorlog = "-"
loglevel = "info"
capture_output = True
enable_stdio_inheritance = True
