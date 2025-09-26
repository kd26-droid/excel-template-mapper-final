#!/bin/bash

# Bash script to set up test files for Excel Template Mapper testing

echo "🔧 Setting up test files for Excel Template Mapper..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
WHITE='\033[1;37m'
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

print_info() {
    echo -e "${CYAN}[INFO]${NC} $1"
}

# Create test_files directory if it doesn't exist
if [ ! -d "test_files" ]; then
    print_status "Creating test_files directory..."
    mkdir -p test_files
    print_success "Created test_files directory"
else
    print_success "test_files directory already exists"
fi

# Create test_results directory if it doesn't exist
if [ ! -d "test_results" ]; then
    print_status "Creating test_results directory..."
    mkdir -p test_results
    print_success "Created test_results directory"
else
    print_success "test_results directory already exists"
fi

echo ""
print_info "Required test files:"
echo -e "  - ${WHITE}test_files/client_bom_data.xlsx${NC} (Client BOM file)"
echo -e "  - ${WHITE}test_files/factwise_template.xlsx${NC} (Factwise Template file)"

echo ""
print_status "Checking for existing files..."

if [ -f "test_files/client_bom_data.xlsx" ]; then
    print_success "client_bom_data.xlsx found"
    client_bom_exists=true
else
    print_error "client_bom_data.xlsx not found"
    client_bom_exists=false
fi

if [ -f "test_files/factwise_template.xlsx" ]; then
    print_success "factwise_template.xlsx found"
    template_exists=true
else
    print_error "factwise_template.xlsx not found"
    template_exists=false
fi

echo ""
if [ "$client_bom_exists" = true ] && [ "$template_exists" = true ]; then
    print_success "All test files are ready! You can now run the tests."
    echo ""
    print_info "To run tests:"
    echo -e "  - Bash: ${WHITE}./run_tests_docker.sh${NC}"
    echo -e "  - Manual: ${WHITE}docker run -it --rm --network excel-template-mapper-final_v2_excel-mapper-network -e BASE_URL=http://backend:8000 -v \"\$(pwd)/test_files:/app/test_files\" -v \"\$(pwd)/test_results:/app/test_results\" excel-mapper-test:latest${NC}"
else
    print_warning "Please place your Excel files in the test_files directory with the exact names:"
    echo -e "   - ${WHITE}client_bom_data.xlsx${NC} (your Client BOM file)"
    echo -e "   - ${WHITE}factwise_template.xlsx${NC} (your Factwise Template file)"
    echo ""
    print_warning "After placing the files, run this script again to verify."
fi

echo ""
print_info "Current directory contents:"
ls -la test_files/ 2>/dev/null || echo "No files found in test_files directory"
