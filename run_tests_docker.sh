#!/bin/bash

# Script to run the Excel Template Mapper tests in Docker

echo "🧪 Starting Excel Template Mapper Tests in Docker..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    print_error "Docker is not running. Please start Docker Desktop or Docker daemon first."
    exit 1
fi

# Check if the main application is running
if ! docker-compose ps | grep -q "backend.*Up"; then
    print_warning "Main application is not running. Starting it now..."
    docker-compose up -d
    if [ $? -ne 0 ]; then
        print_error "Failed to start main application. Please check docker-compose logs."
        exit 1
    fi
    
    # Wait for backend to be ready
    print_status "Waiting for backend to be ready..."
    sleep 10
fi

# Create test directories if they don't exist
mkdir -p test_files test_results

# Check if test files exist
if [ ! -f "test_workflow.py" ]; then
    print_error "test_workflow.py not found in current directory."
    exit 1
fi

if [ ! -f "test_requirements.txt" ]; then
    print_error "test_requirements.txt not found in current directory."
    exit 1
fi

# Build the test container
print_status "Building test container..."
docker build -f Dockerfile.test -t excel-mapper-test:latest .

if [ $? -ne 0 ]; then
    print_error "Failed to build test container."
    exit 1
fi

print_success "Test container built successfully."

# Run the tests
print_status "Running tests..."
echo ""

# Run the test container with interactive mode
docker run -it --rm \
    --network excel-template-mapper-final_v2_excel-mapper-network \
    -e BASE_URL=http://backend:8000 \
    -v "$(pwd)/test_files:/app/test_files" \
    -v "$(pwd)/test_results:/app/test_results" \
    excel-mapper-test:latest

# Check test results
if [ $? -eq 0 ]; then
    print_success "Tests completed successfully!"
    
    # Show test results if they exist
    if [ -d "test_results" ] && [ "$(ls -A test_results)" ]; then
        echo ""
        print_status "Test results available in:"
        ls -la test_results/
    fi
else
    print_error "Tests failed or were interrupted."
    exit 1
fi

echo ""
print_status "Test run completed. You can:"
echo "  - View test results in the test_results/ directory"
echo "  - Check application logs with: docker-compose logs -f"
echo "  - Stop the application with: docker-compose down"
