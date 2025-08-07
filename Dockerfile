FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Create necessary directories
RUN mkdir -p uploaded_files temp_downloads media/uploads logs

# Set environment variables
ENV PYTHONPATH=/app
ENV DJANGO_SETTINGS_MODULE=excel_mapping.settings

# Expose port
EXPOSE 8000

# Copy startup script
COPY simple_startup.sh /app/startup.sh
RUN chmod +x /app/startup.sh

# Run with startup script for Azure
CMD ["/app/startup.sh"]