# PowerShell script to run the Excel Template Mapper tests in Docker

Write-Host "🧪 Starting Excel Template Mapper Tests in Docker..." -ForegroundColor Blue

# Function to print colored output
function Write-Status {
    param([string]$Message)
    Write-Host "[INFO] $Message" -ForegroundColor Blue
}

function Write-Success {
    param([string]$Message)
    Write-Host "[SUCCESS] $Message" -ForegroundColor Green
}

function Write-Warning {
    param([string]$Message)
    Write-Host "[WARNING] $Message" -ForegroundColor Yellow
}

function Write-Error {
    param([string]$Message)
    Write-Host "[ERROR] $Message" -ForegroundColor Red
}

# Check if Docker is running
try {
    docker info | Out-Null
} catch {
    Write-Error "Docker is not running. Please start Docker Desktop first."
    exit 1
}

# Check if the main application is running
$backendRunning = docker-compose ps | Select-String "backend.*Up"
if (-not $backendRunning) {
    Write-Warning "Main application is not running. Starting it now..."
    docker-compose up -d
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to start main application. Please check docker-compose logs."
        exit 1
    }
    
    # Wait for backend to be ready
    Write-Status "Waiting for backend to be ready..."
    Start-Sleep -Seconds 10
}

# Create test directories if they don't exist
if (-not (Test-Path "test_files")) {
    New-Item -ItemType Directory -Path "test_files" | Out-Null
}
if (-not (Test-Path "test_results")) {
    New-Item -ItemType Directory -Path "test_results" | Out-Null
}

# Check if test files exist
if (-not (Test-Path "test_workflow.py")) {
    Write-Error "test_workflow.py not found in current directory."
    exit 1
}

if (-not (Test-Path "test_requirements.txt")) {
    Write-Error "test_requirements.txt not found in current directory."
    exit 1
}

# Build the test container
Write-Status "Building test container..."
docker build -f Dockerfile.test -t excel-mapper-test:latest .

if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to build test container."
    exit 1
}

Write-Success "Test container built successfully."

# Get the network name
$networkName = docker network ls --format "table {{.Name}}" | Select-String "excel-mapper" | ForEach-Object { $_.ToString().Trim() }
if (-not $networkName) {
    Write-Error "Could not find excel-mapper network. Please ensure the main application is running."
    exit 1
}

# Run the tests
Write-Status "Running tests..."
Write-Host ""

# Run the test container with interactive mode
docker run -it --rm `
    --network $networkName `
    -e BASE_URL=http://backend:8000 `
    -v "${PWD}/test_files:/app/test_files" `
    -v "${PWD}/test_results:/app/test_results" `
    excel-mapper-test:latest

# Check test results
if ($LASTEXITCODE -eq 0) {
    Write-Success "Tests completed successfully!"
    
    # Show test results if they exist
    if (Test-Path "test_results") {
        $testFiles = Get-ChildItem "test_results"
        if ($testFiles.Count -gt 0) {
            Write-Host ""
            Write-Status "Test results available in:"
            Get-ChildItem "test_results" | Format-Table Name, Length, LastWriteTime
        }
    }
} else {
    Write-Error "Tests failed or were interrupted."
    exit 1
}

Write-Host ""
Write-Status "Test run completed. You can:"
Write-Host "  - View test results in the test_results/ directory"
Write-Host "  - Check application logs with: docker-compose logs -f"
Write-Host "  - Stop the application with: docker-compose down"
