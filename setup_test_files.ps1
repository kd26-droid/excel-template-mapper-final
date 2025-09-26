# PowerShell script to set up test files for Excel Template Mapper testing

Write-Host "🔧 Setting up test files for Excel Template Mapper..." -ForegroundColor Blue

# Create test_files directory if it doesn't exist
if (-not (Test-Path "test_files")) {
    Write-Host "Creating test_files directory..." -ForegroundColor Yellow
    New-Item -ItemType Directory -Path "test_files" | Out-Null
    Write-Host "✅ Created test_files directory" -ForegroundColor Green
} else {
    Write-Host "✅ test_files directory already exists" -ForegroundColor Green
}

# Create test_results directory if it doesn't exist
if (-not (Test-Path "test_results")) {
    Write-Host "Creating test_results directory..." -ForegroundColor Yellow
    New-Item -ItemType Directory -Path "test_results" | Out-Null
    Write-Host "✅ Created test_results directory" -ForegroundColor Green
} else {
    Write-Host "✅ test_results directory already exists" -ForegroundColor Green
}

Write-Host ""
Write-Host "📁 Required test files:" -ForegroundColor Cyan
Write-Host "  - test_files/client_bom_data.xlsx (Client BOM file)" -ForegroundColor White
Write-Host "  - test_files/factwise_template.xlsx (Factwise Template file)" -ForegroundColor White

Write-Host ""
Write-Host "🔍 Checking for existing files..." -ForegroundColor Yellow

$clientBomExists = Test-Path "test_files/client_bom_data.xlsx"
$templateExists = Test-Path "test_files/factwise_template.xlsx"

if ($clientBomExists) {
    Write-Host "✅ client_bom_data.xlsx found" -ForegroundColor Green
} else {
    Write-Host "❌ client_bom_data.xlsx not found" -ForegroundColor Red
}

if ($templateExists) {
    Write-Host "✅ factwise_template.xlsx found" -ForegroundColor Green
} else {
    Write-Host "❌ factwise_template.xlsx not found" -ForegroundColor Red
}

Write-Host ""
if ($clientBomExists -and $templateExists) {
    Write-Host "🎉 All test files are ready! You can now run the tests." -ForegroundColor Green
    Write-Host ""
    Write-Host "To run tests:" -ForegroundColor Cyan
    Write-Host "  - PowerShell: .\run_tests_docker.ps1" -ForegroundColor White
    Write-Host "  - Manual: docker run -it --rm --network excel-template-mapper-final_v2_excel-mapper-network -e BASE_URL=http://backend:8000 -v '${PWD}/test_files:/app/test_files' -v '${PWD}/test_results:/app/test_results' excel-mapper-test:latest" -ForegroundColor White
} else {
    Write-Host "⚠️  Please place your Excel files in the test_files directory with the exact names:" -ForegroundColor Yellow
    Write-Host "   - client_bom_data.xlsx (your Client BOM file)" -ForegroundColor White
    Write-Host "   - factwise_template.xlsx (your Factwise Template file)" -ForegroundColor White
    Write-Host ""
    Write-Host "After placing the files, run this script again to verify." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "📋 Current directory contents:" -ForegroundColor Cyan
Get-ChildItem "test_files" -ErrorAction SilentlyContinue | Format-Table Name, Length, LastWriteTime
