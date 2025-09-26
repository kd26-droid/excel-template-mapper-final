# Excel Template Mapper - Comprehensive Test Script

## Overview

This test script (`test_workflow.py`) is designed to thoroughly test the complete workflow of the Excel Template Mapper application. It automates the entire process from file upload to template application, ensuring that all the recent fixes for the three reported issues are working correctly.

## What It Tests

The script tests the complete end-to-end workflow:

1. **📁 File Upload Setup** - Gets file paths from user
2. **🆔 Session Creation** - Creates a new session for testing
3. **📤 File Upload** - Uploads both Client BOM and Factwise Template files
4. **📋 Header Extraction** - Extracts headers from both uploaded files
5. **🔗 Manual Column Mapping** - Creates manual mapping between client and template columns
6. **🏷️ Default Values** - Adds default values to unmapped fields
7. **🏷️ Tag Creation** - Creates and applies formula-based tags
8. **🆔 Factwise ID Creation** - Creates Factwise ID rules
9. **💾 Template Saving** - Saves the complete mapping template
10. **🔄 Template Application Verification** - Applies the saved template to verify it works
11. **🔗 Field Mapping Verification** - Verifies that field mapping happened successfully
12. **🏷️ Default Values Verification** - Confirms default values are applied and visible
13. **🏷️ Tags Verification** - Verifies tags are correctly applied and visible
14. **🆔 Factwise ID Verification** - Confirms Factwise IDs are created on item code
15. **📥 Output Download Test** - Tests if the output can be downloaded successfully
16. **🔍 Data Integrity Verification** - Verifies all data is correctly applied
17. **🔄 Template Reuse Test** - Tests template reuse with same files, preserving all components

## Recent Fixes Being Tested

This script specifically tests the three issues that were recently fixed:

### ✅ Issue 1: Default Values Not Showing After Template Save
- **Fix**: Modified backend to return default values in response and frontend to immediately apply them
- **Test**: Verifies default values are visible immediately after template save without refresh

### ✅ Issue 2: Tag Duplication After Template Save
- **Fix**: Added logic to prevent dynamic column regeneration when counts match
- **Test**: Ensures tags are not duplicated when applying saved templates

### ✅ Issue 3: Factwise ID Only Working After Screen Refresh
- **Fix**: Simplified frontend refresh logic and enhanced backend session persistence
- **Test**: Verifies Factwise IDs work immediately without requiring refresh

## Prerequisites

1. **Python 3.7+** installed on your system
2. **Excel Template Mapper backend** running (default: http://localhost:8000)
3. **Test files directory** with required Excel files:
   - `test_files/client_bom_data.xlsx` (your source data)
   - `test_files/factwise_template.xlsx` (your target template)

## Installation

1. Install the required dependencies:
   ```bash
   pip install -r test_requirements.txt
   ```

2. Ensure your backend is running:
   ```bash
   # In your backend directory
   python manage.py runserver
   ```

## Usage

### Basic Usage

1. **Prepare your test files:**
   ```bash
   # Create test_files directory
   mkdir -p test_files
   
   # Copy your Excel files with the correct names
   cp /path/to/your/client_data.xlsx test_files/client_bom_data.xlsx
   cp /path/to/your/template.xlsx test_files/factwise_template.xlsx
   ```

2. **Run the test script:**
   ```bash
   python test_workflow.py
   ```

3. **The script will automatically:**
   - Load files from `test_files/` directory
   - Use `client_bom_data.xlsx` as Client BOM
   - Use `factwise_template.xlsx` as Factwise Template
   - Execute all 17 test steps with detailed feedback

### Advanced Usage

You can also run specific test methods by modifying the script:

```python
# Create tester instance
tester = ExcelMapperTester("http://localhost:8000")

# Run specific tests
tester.create_session()
tester.upload_files()
# ... etc
```

## Test Output

The script provides comprehensive logging with:

- **Timestamps** for each operation
- **Status indicators** (✅ PASS, ❌ FAIL)
- **Detailed error messages** when tests fail
- **Progress tracking** through each workflow step
- **Final summary** with success rate and duration
- **JSON results file** saved for further analysis

### Sample Output

```
🚀 STARTING COMPLETE WORKFLOW TEST
================================================================================

📁 FILE UPLOAD SETUP
============================================================
✅ Client BOM: client_bom_data.xlsx
✅ Factwise Template: factwise_template.xlsx
📁 Files loaded from: test_files/

🆔 SESSION CREATION
============================================================
[2024-01-15 10:30:15.123] INFO: Session created successfully: abc123
✅ Session Creation: PASS
   Details: Session ID: abc123

📤 FILE UPLOAD
============================================================
✅ Client BOM Upload: PASS
✅ Factwise Template Upload: PASS

...

📊 TEST RESULTS SUMMARY
================================================================================
Total Tests: 17
Passed: 17
Failed: 0
Success Rate: 100.0%
Total Duration: 0:00:45.123456

🎉 ALL TESTS PASSED! The workflow is working correctly.
✅ All functionality verified:
   • Field mapping successful
   • Default values applied and visible
   • Tags created and applied correctly
   • Factwise IDs generated on item code
   • Output can be downloaded
   • Template saved successfully
   • Template reused with same files - all components preserved
   • No multiples, no refreshing required

📄 Detailed results saved to: test_results_20240115_103015.json
```

## 🎯 **What Gets Tested**

The script automatically tests:

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

## Test Results File

The script generates a detailed JSON results file (`test_results_YYYYMMDD_HHMMSS.json`) containing:

- **Summary statistics** (total tests, passed, failed, success rate, duration)
- **Individual test results** with timestamps and details
- **Error details** for failed tests

This file can be used for:
- Regression testing
- Performance analysis
- Bug reporting
- CI/CD integration

## Troubleshooting

### Common Issues

1. **Connection Error**: Ensure your backend is running and accessible
2. **File Not Found**: Verify file paths are correct and files exist
3. **Permission Error**: Ensure you have read access to the Excel files
4. **API Error**: Check backend logs for detailed error information

### Debug Mode

The script includes comprehensive logging. If you encounter issues:

1. Check the console output for detailed error messages
2. Review the generated JSON results file
3. Check your backend logs for corresponding errors
4. Verify the API endpoints are working correctly

## Customization

### Modifying Test Data

You can customize the test data by modifying these methods:

- **`add_default_values()`**: Change the default values being set
- **`add_tags()`**: Modify the tags and formulas being created
- **`create_factwise_ids()`**: Adjust the Factwise ID rules

### Adding New Tests

To add new test cases:

1. Create a new method in the `ExcelMapperTester` class
2. Add the test call to `run_complete_test()`
3. Use `log_test()` to record test results

## Integration

This test script can be integrated into:

- **CI/CD pipelines** for automated testing
- **Development workflows** for regression testing
- **Quality assurance** processes
- **Performance monitoring** systems

## Support

If you encounter issues with the test script:

1. Check the console output for error messages
2. Verify your backend is running correctly
3. Ensure all dependencies are installed
4. Check file permissions and paths
5. Review the generated test results file

## License

This test script is part of the Excel Template Mapper project and follows the same license terms.
