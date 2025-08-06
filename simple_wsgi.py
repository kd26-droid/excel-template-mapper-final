"""
Simple WSGI application for testing deployment
"""
import os
import sys
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def application(environ, start_response):
    """Simple WSGI application"""
    try:
        logger.info(f"Request: {environ.get('REQUEST_METHOD')} {environ.get('PATH_INFO')}")
        
        path = environ.get('PATH_INFO', '/')
        method = environ.get('REQUEST_METHOD', 'GET')
        
        if path == '/health' or path == '/api/health/':
            response_body = b'{"status": "ok", "message": "Excel Template Mapper API is running"}'
            status = '200 OK'
            headers = [('Content-type', 'application/json'), ('Content-Length', str(len(response_body)))]
        elif path == '/':
            response_body = b'{"message": "Excel Template Mapper Backend", "status": "running"}'
            status = '200 OK'
            headers = [('Content-type', 'application/json'), ('Content-Length', str(len(response_body)))]
        else:
            response_body = b'{"error": "Not found"}'
            status = '404 Not Found'
            headers = [('Content-type', 'application/json'), ('Content-Length', str(len(response_body)))]
            
        start_response(status, headers)
        return [response_body]
        
    except Exception as e:
        logger.error(f"Error in WSGI app: {e}")
        response_body = f'{{"error": "Internal server error: {str(e)}"}}'.encode('utf-8')
        status = '500 Internal Server Error'
        headers = [('Content-type', 'application/json'), ('Content-Length', str(len(response_body)))]
        start_response(status, headers)
        return [response_body]

if __name__ == '__main__':
    from wsgiref.simple_server import make_server
    httpd = make_server('', 8000, application)
    print("Serving on port 8000...")
    httpd.serve_forever()