# 🐳 Docker Testing Guide for Excel Template Mapper

This guide explains how to run the comprehensive test script (`test_workflow.py`) in your Docker environment.

## 🚀 **Quick Start (Recommended)**

### **Option 1: Use the Automated Scripts**

#### **On Linux/Mac:**
```bash
# Make the script executable
chmod +x run_tests_docker.sh

# Run the tests
./run_tests_docker.sh
```

#### **On Windows (PowerShell):**
```powershell
# Run the tests
.\run_tests_docker.ps1
```

### **Option 2: Manual Docker Commands**

1. **Start your main application:**
   ```bash
   docker-compose up -d
   ```

2. **Build the test container:**
   ```bash
   docker build -f Dockerfile.test -t excel-mapper-test:latest .
   ```

3. **Run the tests:**
   ```bash
   docker run -it --rm \
     --network excel-template-mapper-final_v2_excel-mapper-network \
     -e BASE_URL=http://backend:8000 \
     -v "$(pwd)/test_files:/app/test_files" \
     -v "$(pwd)/test_results:/app/test_results" \
     excel-mapper-test:latest
   ```

## 📋 **Prerequisites**

1. **Docker Desktop** running
2. **Main application** running (backend + frontend)
3. **Test files** in the `test_files/` directory
4. **Test script** (`test_workflow.py`) in the current directory

## 🔧 **Setup Steps**

### **1. Prepare Test Files**

Place your Excel files in the `test_files/` directory with the correct names:
```bash
mkdir -p test_files
# Copy your Excel files with the exact names required
cp /path/to/your/client_data.xlsx test_files/client_bom_data.xlsx
cp /path/to/your/template.xlsx test_files/factwise_template.xlsx
```

### **2. Ensure Main Application is Running**

```bash
# Check if running
docker-compose ps

# Start if not running
docker-compose up -d

# Wait for backend to be ready
docker-compose logs -f backend
```

### **3. Verify Network Configuration**

The test container needs to connect to the same network as your main application:
```bash
# List networks
docker network ls

# Check which network your containers are using
docker-compose ps
```

## 🧪 **Running Tests**

### **Interactive Mode (Recommended for First Run)**

```bash
docker run -it --rm \
  --network excel-template-mapper-final_v2_excel-mapper-network \
  -e BASE_URL=http://backend:8000 \
  -v "$(pwd)/test_files:/app/test_files" \
  -v "$(pwd)/test_results:/app/test_results" \
  excel-mapper-test:latest
```

This will:
- Start the test script interactively
- Prompt you for file paths
- Show real-time progress
- Allow you to see any errors immediately

### **Non-Interactive Mode (For CI/CD)**

```bash
docker run --rm \
  --network excel-template-mapper-final_v2_excel-mapper-network \
  -e BASE_URL=http://backend:8000 \
  -v "$(pwd)/test_files:/app/test_files" \
  -v "$(pwd)/test_results:/app/test_results" \
  excel-mapper-test:latest python test_workflow.py
```

## 📊 **Test Results**

### **Console Output**
The test script provides real-time feedback with:
- ✅ **PASS** indicators for successful tests
- ❌ **FAIL** indicators for failed tests
- 📊 **Summary** with success rate and duration
- 🔍 **Detailed logs** for troubleshooting

### **JSON Results File**
Results are automatically saved to:
```
test_results/test_results_YYYYMMDD_HHMMSS.json
```

This file contains:
- Test summary statistics
- Individual test results with timestamps
- Error details for failed tests
- Performance metrics

## 🔍 **Troubleshooting**

### **Common Issues**

#### **1. Network Connection Error**
```bash
# Check if containers are on the same network
docker network inspect excel-template-mapper-final_v2_excel-mapper-network

# Verify backend is accessible
docker exec excel-template-mapper-final_v2_backend_1 curl -f http://localhost:8000/api/health/
```

#### **2. File Access Issues**
```bash
# Check file permissions
ls -la test_files/

# Verify volume mounting
docker run --rm -v "$(pwd)/test_files:/app/test_files" excel-mapper-test:latest ls -la /app/test_files
```

#### **3. Backend Not Ready**
```bash
# Check backend logs
docker-compose logs -f backend

# Wait for health check to pass
docker-compose ps
```

### **Debug Mode**

To debug issues, you can:

1. **Access the test container shell:**
   ```bash
   docker run -it --rm \
     --network excel-template-mapper-final_v2_excel-mapper-network \
     -e BASE_URL=http://backend:8000 \
     -v "$(pwd)/test_files:/app/test_files" \
     excel-mapper-test:latest bash
   ```

2. **Run tests manually inside the container:**
   ```bash
   # Inside the container
   python test_workflow.py
   ```

3. **Test network connectivity:**
   ```bash
   # Inside the container
   curl -f http://backend:8000/api/health/
   ```

## 🚀 **Advanced Usage**

### **Custom Test Configuration**

You can modify the test behavior by setting environment variables:

```bash
docker run -it --rm \
  --network excel-template-mapper-final_v2_excel-mapper-network \
  -e BASE_URL=http://backend:8000 \
  -e DEBUG=true \
  -e TEST_TIMEOUT=300 \
  -v "$(pwd)/test_files:/app/test_files" \
  -v "$(pwd)/test_results:/app/test_results" \
  excel-mapper-test:latest
```

### **Running Specific Test Methods**

If you want to run only specific parts of the test:

```bash
# Create a custom test script
echo 'from test_workflow import ExcelMapperTester
tester = ExcelMapperTester()
tester.create_session()
tester.upload_files()' > custom_test.py

# Run the custom test
docker run -it --rm \
  --network excel-template-mapper-final_v2_excel-mapper-network \
  -e BASE_URL=http://backend:8000 \
  -v "$(pwd)/test_files:/app/test_files" \
  -v "$(pwd)/custom_test.py:/app/custom_test.py" \
  excel-mapper-test:latest python custom_test.py
```

### **Integration with CI/CD**

For automated testing, you can:

1. **Use the non-interactive mode**
2. **Parse the JSON results file**
3. **Set exit codes based on test results**

Example CI/CD script:
```bash
#!/bin/bash
set -e

# Run tests
docker run --rm \
  --network excel-template-mapper-final_v2_excel-mapper-network \
  -e BASE_URL=http://backend:8000 \
  -v "$(pwd)/test_files:/app/test_files" \
  -v "$(pwd)/test_results:/app/test_results" \
  excel-mapper-test:latest

# Check results
if [ -f "test_results/latest_results.json" ]; then
    # Parse results and set exit code
    python -c "
import json
with open('test_results/latest_results.json') as f:
    data = json.load(f)
    if data['summary']['failed'] > 0:
        exit(1)
    exit(0)
    "
fi
```

## 📝 **File Structure**

```
excel-template-mapper-final_v2/
├── test_workflow.py              # Main test script
├── test_requirements.txt         # Python dependencies
├── Dockerfile.test               # Test container definition
├── docker-compose.test.yml       # Test-specific compose file
├── run_tests_docker.sh          # Linux/Mac test runner
├── run_tests_docker.ps1         # Windows PowerShell runner
├── test_files/                   # Directory for Excel files
│   ├── client_bom_data.xlsx     # Your Client BOM file (exact name required)
│   └── factwise_template.xlsx   # Your Factwise Template file (exact name required)
└── test_results/                 # Generated test results
    └── test_results_*.json      # Test result files
```

## 🎯 **What Gets Tested**

The test script automatically tests:

1. **📁 File Upload** - Client BOM and Factwise Template files
2. **🔗 Column Mapping** - Manual mapping between files
3. **🏷️ Default Values** - Setting and applying default values
4. **🏷️ Tags** - Creating and applying formula-based tags
5. **🆔 Factwise IDs** - Creating Factwise ID rules
6. **💾 Template Saving** - Saving complete mapping templates
7. **🔄 Template Application** - Applying saved templates
8. **🔗 Field Mapping Verification** - Confirming mapping success with data visibility
9. **🏷️ Default Values Verification** - Ensuring default values are visible without refresh
10. **🏷️ Tags Verification** - Confirming tags are applied and visible
11. **🆔 Factwise ID Verification** - Verifying Factwise IDs are generated on item code
12. **📥 Output Download** - Testing successful file download
13. **🔍 Data Integrity** - Verifying all data is correctly applied
14. **🔄 Template Reuse** - Testing template reuse with same files, preserving all components

## 🚫 **What the Tests Ensure**

- **No Multiples**: Tags and columns are not duplicated
- **No Refreshing**: All functionality works immediately without screen refresh
- **Complete Persistence**: All mappings, tags, default values, and Factwise IDs are preserved
- **End-to-End Validation**: Every step is verified for correctness and visibility

## 🔄 **Cleanup**

After testing, you can:

```bash
# Stop the main application
docker-compose down

# Remove test container
docker rmi excel-mapper-test:latest

# Clean up test results (optional)
rm -rf test_results/*
```

## 📞 **Support**

If you encounter issues:

1. **Check the console output** for error messages
2. **Review the JSON results file** for detailed test information
3. **Verify Docker network configuration**
4. **Ensure the main application is running and healthy**
5. **Check file permissions and volume mounting**

## 🎉 **Success Indicators**

A successful test run will show:
- All 17 tests passing (✅)
- 100% success rate
- Test results saved to JSON file
- No network or file access errors
- All three main issues (default values, tag duplication, Factwise ID refresh) working correctly
- Field mapping successful with data visibility
- Default values applied and visible without refresh
- Tags created and applied correctly
- Factwise IDs generated on item code
- Output can be downloaded successfully
- Template saved and reused with all components preserved
- No multiples, no refreshing required for any functionality
