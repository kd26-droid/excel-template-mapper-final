# PDF OCR Processing with Azure AI Document Intelligence

This document provides a comprehensive overview of how the OCR AI Oracle system processes both single-page and multi-page PDF documents using Azure AI Document Intelligence.

## Overview

The system utilizes Azure AI Document Intelligence as the core OCR engine to extract structured data from PDF documents. The processing workflow is designed to handle various document types including invoices, business cards, bills of materials (BOMs), and general documents.

## Architecture Components

### Core Services

1. **Azure Document Service** (`backend/app/services/azure_service.py`)
   - Main interface to Azure AI Document Intelligence
   - Handles document analysis and blob storage
   - Provides fallback mock data for development

2. **Document Upload API** (`backend/app/api/v1/endpoints/documents.py`)
   - Handles file uploads and validation
   - Supports both single and bulk upload modes
   - Manages file storage and database records

3. **Background Processing** (`backend/app/worker.py`)
   - Celery-based task queue for asynchronous processing
   - Handles document analysis workflow
   - Manages vector storage and history logging

## Single-Page PDF OCR Workflow

### 1. Document Upload
```
User uploads PDF → File validation → Save to disk → Create database record → Queue processing task
```

**Key components:**
- **File validation**: Checks file extension (`.pdf` allowed), size limits (10MB max)
- **Storage location**: `/app/uploads/` directory
- **Database record**: Creates `Document` model with status "pending"

### 2. Background Processing
The `process_document_task` function handles the core OCR workflow:

```python
# Template mapping for different document types
template_map = {
    1: "prebuilt-invoice",      # Invoice documents
    2: "prebuilt-businessCard", # Business card documents
    3: "prebuilt-document",     # General documents
    4: "prebuilt-document"      # Bill of Materials (BOM)
}
```

### 3. Azure AI Document Intelligence Analysis
```python
# Core analysis call
result = azure_service.analyze_document(file_path, template_type)

# Analysis process:
with open(file_path, "rb") as file:
    poller = self.client.begin_analyze_document(
        model_id=template_type,
        analyze_request=file,
        content_type="application/octet-stream"
    )
    result = poller.result()
```

### 4. Data Extraction and Structuring
The Azure response is processed to extract:
- **Structured fields**: Key-value pairs with confidence scores
- **Raw text content**: Full text extracted from the document
- **Confidence metrics**: Overall confidence score for the extraction

Example extracted data structure:
```json
{
    "fields": {
        "InvoiceId": {"value": "INV-2024-001", "confidence": 0.95},
        "VendorName": {"value": "Sample Vendor Corp", "confidence": 0.92},
        "InvoiceDate": {"value": "2024-01-15", "confidence": 0.88},
        "TotalAmount": {"value": "1,234.56", "confidence": 0.94}
    },
    "confidence": 0.92,
    "raw_text": "Sample invoice content extracted via OCR"
}
```

### 5. Post-Processing
- **Blob Storage**: Upload processed document to Azure Blob Storage
- **Vector Storage**: Store extracted text in vector database for semantic search
- **Database Update**: Update document status to "completed" with results
- **History Logging**: Log processing events for audit trail

## Multi-Page PDF OCR Workflow

### Document Type Support
Multi-page PDF processing follows the same workflow as single-page documents. The Azure AI Document Intelligence service natively handles multi-page PDFs as a single document unit.

### Processing Characteristics
1. **Native Multi-Page Support**: Azure AI Document Intelligence processes all pages within a single analysis call
2. **Page Consolidation**: The service automatically:
   - Analyzes content across all pages
   - Correlates related information between pages
   - Provides consolidated structured output
3. **Cross-Page Field Extraction**: For documents like invoices spanning multiple pages:
   - Line items from different pages are consolidated
   - Totals are calculated across all pages
   - Related fields are properly associated

### Multi-Page Specific Features
```python
# Single API call handles entire multi-page document
result = azure_service.analyze_document(multi_page_pdf_path, "prebuilt-invoice")

# Azure automatically:
# - Processes all pages in sequence
# - Consolidates line items across pages
# - Calculates totals from all pages
# - Maintains field relationships
```

## Template-Specific Processing

### Invoice Processing (`prebuilt-invoice`)
- **Multi-page support**: Full support for invoices spanning multiple pages
- **Field extraction**: Vendor details, line items, totals, dates
- **Cross-page correlation**: Line items and totals calculated across all pages

### Business Card Processing (`prebuilt-businessCard`)
- **Typical usage**: Single-page documents
- **Field extraction**: Contact information, company details, addresses

### General Document Processing (`prebuilt-document`)
- **Multi-page support**: Handles documents of any length
- **Field extraction**: General text extraction with basic structure recognition
- **Use case**: BOMs, contracts, general business documents

## File Handling and Storage

### Supported Formats
```python
ALLOWED_EXTENSIONS = {'.pdf', '.jpg', '.jpeg', '.png', '.tiff', '.tif'}
```

### Size Limitations
- **Single file**: 10MB maximum
- **Bulk upload**: 100MB total maximum, 50 files maximum

### Storage Architecture
1. **Local Storage**: `/app/uploads/` for temporary processing
2. **Azure Blob Storage**: Long-term storage for processed documents
3. **Database**: Metadata and extracted results in PostgreSQL
4. **Vector Database**: Extracted text for semantic search capabilities

## Error Handling and Fallbacks

### Azure Service Unavailable
When Azure AI Document Intelligence is not configured or unavailable:
```python
def _mock_analysis(self) -> Dict[str, Any]:
    """Mock analysis for development"""
    return {
        "fields": {
            "InvoiceId": {"value": "INV-2024-001", "confidence": 0.95},
            # ... mock data
        },
        "confidence": 0.92,
        "raw_text": "Sample invoice content extracted via OCR"
    }
```

### Processing Failures
- **Status tracking**: Document status updated to "failed" on errors
- **Error logging**: Detailed error information stored in history
- **File cleanup**: Temporary files removed on failure
- **Retry mechanism**: Built into Celery task queue

## Performance Considerations

### Asynchronous Processing
- **Background tasks**: OCR processing doesn't block API responses
- **Queue management**: Celery with Redis for task distribution
- **Status polling**: Clients can check processing status via API

### Scalability Features
- **Horizontal scaling**: Multiple worker processes can handle concurrent documents
- **Resource management**: File size limits prevent memory issues
- **Batch processing**: Bulk upload API for efficient multi-document processing

## Configuration Requirements

### Azure Services
```python
# Required environment variables
AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT = "https://your-service.cognitiveservices.azure.com/"
AZURE_DOCUMENT_INTELLIGENCE_KEY = "your-api-key"
AZURE_STORAGE_CONNECTION_STRING = "your-storage-connection-string"
AZURE_STORAGE_CONTAINER_NAME = "your-container-name"
```

### Dependencies
```
azure-ai-documentintelligence
azure-storage-blob
azure-core
```

## API Endpoints

### Single Document Upload
```
POST /api/v1/documents/upload
- Form data: file, template_id
- Response: Document ID and processing status
```

### Bulk Document Upload
```
POST /api/v1/documents/bulk-upload
- Form data: files[], template_id
- Response: Array of document IDs and processing status
```

### Document Status Check
```
GET /api/v1/documents/{doc_id}
- Response: Processing status, extracted data, confidence score
```

## Best Practices

### PDF Quality Optimization
- **Resolution**: Higher resolution PDFs yield better OCR results
- **Text clarity**: Clear, unscanned text provides optimal extraction
- **File size**: Balance quality with processing speed

### Template Selection
- **Invoice documents**: Use template_id=1 for structured invoice processing
- **Business cards**: Use template_id=2 for contact information extraction
- **General documents**: Use template_id=3 or 4 for flexible text extraction

### Error Monitoring
- **Status tracking**: Always check document processing status
- **Confidence scores**: Monitor extraction confidence for quality assurance
- **Error logging**: Review processing logs for optimization opportunities

This comprehensive workflow ensures robust, scalable PDF OCR processing for both single-page and multi-page documents using Azure's state-of-the-art AI services.