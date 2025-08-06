# CLAUDE.md - Development Guide

This file provides comprehensive guidance for Claude Code when working with the Excel Template Mapper codebase.

## 📋 Project Overview

**Project**: Excel Template Mapper for Factwise  
**Purpose**: Automate conversion of client Excel files to Factwise's internal BOM format  
**Architecture**: React frontend + Django REST API backend  
**Status**: Production-ready with advanced features  

## 🏗️ Technology Stack

### Backend (Django)
- **Framework**: Django 4.2 with Django REST Framework
- **Database**: SQLite (development) / PostgreSQL (production) 
- **File Processing**: pandas, openpyxl for Excel manipulation
- **APIs**: RESTful endpoints with JSON responses
- **Authentication**: Session-based (can be extended to JWT)

### Frontend (React)
- **Framework**: React 18 with functional components and hooks
- **UI Library**: Material-UI (MUI) for components and theming
- **Data Grid**: AG-Grid for spreadsheet-like data display and editing
- **Routing**: React Router v6 for client-side navigation
- **HTTP Client**: Axios for API communication
- **State Management**: React hooks (useState, useEffect, useCallback)

## 📁 Project Structure

```
BOM/
├── backend/                 # Django REST API
│   ├── excel_mapper/       # Main Django app
│   │   ├── views.py        # API endpoints and business logic
│   │   ├── models.py       # Database models (MappingTemplate)
│   │   ├── urls.py         # URL routing
│   │   ├── bom_header_mapper.py  # Column mapping logic
│   │   └── migrations/     # Database migrations
│   ├── excel_mapping/      # Django project settings
│   │   ├── settings.py     # Production-ready configuration
│   │   ├── urls.py         # Root URL configuration
│   │   └── wsgi.py         # WSGI application
│   ├── utils/              # Shared utilities
│   │   └── file_utils.py   # File handling utilities
│   └── manage.py           # Django management commands
├── frontend/               # React application
│   ├── src/
│   │   ├── components/     # Reusable UI components
│   │   │   ├── FormulaBuilder.js  # Smart tag creation interface
│   │   │   ├── ErrorBoundary.js   # Error handling wrapper
│   │   │   ├── Header.js          # Application header
│   │   │   └── LoadingSpinner.js  # Loading indicator
│   │   ├── pages/          # Main application screens
│   │   │   ├── UploadFiles.js     # File upload interface
│   │   │   ├── ColumnMapping.js   # Column mapping interface
│   │   │   ├── DataEditor.js      # Data editing spreadsheet
│   │   │   └── Dashboard.js       # Main dashboard
│   │   ├── services/       # API communication layer
│   │   │   └── api.js      # Axios-based API client
│   │   ├── utils/          # Frontend utilities
│   │   │   ├── helpers.js  # Common helper functions
│   │   │   └── theme.js    # Material-UI theme configuration
│   │   └── hooks/          # Custom React hooks
│   │       └── useApi.js   # API interaction hook
│   ├── public/             # Static assets
│   └── package.json        # Dependencies and scripts
├── docs/                   # Technical documentation
└── README.md               # Project overview and setup
```

## 🔧 Development Commands

### Backend (Django)
```bash
cd backend

# Setup
python -m venv venv
source venv/bin/activate  # Linux/Mac
# or
venv\Scripts\activate     # Windows

pip install -r requirements.txt

# Database
python manage.py migrate
python manage.py createsuperuser

# Development
python manage.py runserver              # Start dev server (port 8000)
python manage.py runserver 0.0.0.0:8000  # Bind to all interfaces
python manage.py shell                  # Django shell
python manage.py test                   # Run tests

# Production
python manage.py collectstatic          # Collect static files
gunicorn excel_mapping.wsgi:application  # Production server
```

### Frontend (React)
```bash
cd frontend

# Setup
npm install                 # Install dependencies
# or
yarn install

# Development
npm start                   # Start dev server (port 3000)
npm test                    # Run tests
npm run build               # Production build

# Linting and formatting
npm run lint                # ESLint
npm run format              # Prettier
```

## 🛠️ Core Components & Features

### 1. File Upload System (`UploadFiles.js`)
- **Purpose**: Handle client Excel file and template file uploads
- **Features**: Drag-and-drop, file validation, progress tracking
- **Backend**: `upload_files` endpoint creates session with unique ID
- **Session Management**: In-memory `SESSION_STORE` tracks user data

### 2. Column Mapping (`ColumnMapping.js`)
- **Purpose**: Map client columns to template fields
- **AI Suggestions**: `BOMHeaderMapper` provides intelligent mapping hints
- **Interactive UI**: Side-by-side column comparison with confidence scores
- **Backend**: `mapping_suggestions` and `save_mappings` endpoints

### 3. Data Editor (`DataEditor.js`)
- **Purpose**: Spreadsheet interface for data review and editing
- **Grid System**: AG-Grid with custom cell renderers and editors
- **Features**: 
  - Smart tag creation via FormulaBuilder
  - Factwise ID generation (combine columns)
  - Template save/load functionality
  - Real-time data validation
  - Export to Excel/CSV

### 4. Smart Tags System (`FormulaBuilder.js`)
- **Purpose**: Create conditional rules for automatic component tagging
- **Rule Engine**: IF/THEN logic with multiple conditions
- **Operators**: CONTAINS, EQUALS, STARTS_WITH, ENDS_WITH
- **Backend**: `apply_formulas` processes rules and generates new columns

### 5. Template Management
- **Models**: `MappingTemplate` stores column mappings and formula rules
- **Persistence**: Save column mappings, smart tag rules, Factwise ID rules
- **Reusability**: Apply saved templates to new files
- **Endpoints**: `save_mapping_template`, `get_mapping_templates`, `apply_mapping_template`

## 🔌 API Endpoints

### Core Data Flow
```
1. POST /api/upload/                    → Create session with files
2. POST /api/mapping/suggestions/       → Get AI mapping suggestions  
3. POST /api/mapping/save/             → Save column mappings
4. GET /api/data/                      → Get processed data for editing
5. POST /api/formulas/apply/           → Apply smart tag rules
6. POST /api/create-factwise-id/       → Create Factwise ID column
7. POST /api/data/save/                → Save edited data
8. POST /api/download/grid-excel/      → Download with frontend data
```

### Session Management
- **Session Storage**: In-memory dictionary `SESSION_STORE`
- **Session Data**: File paths, mappings, processed data, formulas
- **Persistence**: Enhanced data stored as `formula_enhanced_data`

### Template System
```python
# MappingTemplate model fields
- name: Template name
- description: Template description  
- mappings: Column mapping JSON
- formula_rules: Smart tag rules JSON
- factwise_rules: Factwise ID rules JSON
- created_at: Timestamp
- updated_at: Timestamp
```

## 💾 Data Processing Pipeline

### 1. File Upload & Validation
```python
# FileUploadManager handles file operations
- validate_excel_file()     # Check format, size, readability
- save_uploaded_file()      # Save to uploaded_files directory
- create_session()          # Generate UUID session ID
```

### 2. Column Mapping Intelligence
```python
# BOMHeaderMapper provides AI suggestions
- map_headers_to_template() # Fuzzy matching algorithm
- confidence scoring        # 0-100% confidence ratings
- specification detection   # Identify spec columns
```

### 3. Data Processing & Enhancement
```python
# Formula processing pipeline
- parse_formula_rules()     # Convert frontend rules to backend format
- apply_formula_logic()     # Execute conditional logic
- generate_new_columns()    # Create new data columns
- update_session_data()     # Store enhanced data
```

### 4. Export System
- **Original Method**: Export from session `formula_enhanced_data`
- **New Method**: Export actual frontend grid data via `download_grid_excel`
- **Formats**: Excel (.xlsx) and CSV support
- **Features**: Preserves all frontend edits, formulas, and enhancements

## 🎨 Frontend Architecture Patterns

### 1. Component Structure
```javascript
// Functional components with hooks
const DataEditor = () => {
  const [loading, setLoading] = useState(true);
  const [rowData, setRowData] = useState([]);
  
  // Memoized callbacks for performance
  const handleDownload = useCallback(async () => {
    // Implementation
  }, [dependencies]);
  
  return <Component />;
};
```

### 2. State Management
```javascript
// Local state with hooks
const [gridApi, setGridApi] = useState(null);
const [columnDefs, setColumnDefs] = useState([]);

// Effect hooks for data loading
useEffect(() => {
  fetchData();
}, [sessionId]);
```

### 3. API Integration
```javascript
// services/api.js - Centralized API calls
const api = {
  uploadFiles: (formData) => axios.post('/api/upload/', formData),
  getMappedData: (sessionId) => axios.get(`/api/data/?session_id=${sessionId}`),
  downloadGridExcel: (sessionId, headers, rows) => 
    axios.post('/api/download/grid-excel/', { session_id: sessionId, headers, rows })
};
```

## 🔍 Key Implementation Details

### 1. AG-Grid Integration
```javascript
// DataEditor.js - Grid configuration
const gridOptions = {
  animateRows: true,
  enableClipboard: true,
  rowSelection: 'multiple',
  stopEditingWhenCellsLoseFocus: true
};

// Custom cell styling based on data type
const cellStyle = (params) => {
  if (params.value === 'unknown') return { backgroundColor: '#ffebee' };
  if (isFormulaColumn) return { backgroundColor: '#e8f5e8' };
  return {};
};
```

### 2. Formula Builder Logic
```javascript
// FormulaBuilder.js - Rule creation
const createRule = {
  column: 'description',
  condition: 'CONTAINS', 
  value: 'capacitor',
  output_column: 'component_type',
  output_value: 'Capacitor'
};

// Backend processing in views.py
def process_formula_rules(rules, data):
    for rule in rules:
        if rule['condition'] == 'CONTAINS':
            mask = data[rule['column']].str.contains(rule['value'], na=False)
            data.loc[mask, rule['output_column']] = rule['output_value']
```

### 3. Template System Implementation
```javascript
// Template saving from frontend
const saveTemplate = async () => {
  await api.saveMappingTemplate(sessionId, templateName, {
    mappings: currentMappings,
    formula_rules: appliedFormulas,
    factwise_id_rule: factwiseIdRule
  });
};

// Template application
const applyTemplate = async (template) => {
  await api.applyMappingTemplate(sessionId, template.id);
  if (template.formula_rules) {
    await api.applyFormulas(sessionId, template.formula_rules);
  }
  fetchData(); // Reload with template applied
};
```

## 🐛 Common Issues & Solutions

### 1. File Upload Problems
- **Issue**: Large files timeout
- **Solution**: Increase `FILE_UPLOAD_MAX_MEMORY_SIZE` in settings
- **Code**: `settings.py` line 114-115

### 2. Column Mapping Accuracy
- **Issue**: Poor mapping suggestions
- **Solution**: Improve fuzzy matching in `BOMHeaderMapper`
- **Code**: `bom_header_mapper.py` line 45-80

### 3. Grid Performance
- **Issue**: Slow rendering with large datasets
- **Solution**: Enable virtualization and pagination
- **Code**: `DataEditor.js` gridOptions configuration

### 4. Export Discrepancies
- **Issue**: Downloaded file missing frontend changes
- **Solution**: Use `download_grid_excel` endpoint with actual grid data
- **Code**: `DataEditor.js` handleDownloadExcel function

## 🚀 Development Best Practices

### 1. Code Organization
- Keep components focused on single responsibility
- Use custom hooks for complex logic
- Implement error boundaries for crash protection
- Follow React patterns: functional components, hooks

### 2. API Design
- RESTful endpoints with consistent naming
- Comprehensive error handling and logging
- Input validation and sanitization
- Session-based data management

### 3. Performance Optimization
- Memoize expensive calculations with `useMemo`
- Use `useCallback` for event handlers
- Implement proper loading states
- Optimize database queries with select_related

### 4. Error Handling
```javascript
// Frontend error handling
try {
  const response = await api.uploadFiles(formData);
  showSnackbar('Upload successful', 'success');
} catch (error) {
  console.error('Upload failed:', error);
  showSnackbar('Upload failed. Please try again.', 'error');
}

// Backend error handling
try:
    # Process data
    return Response({'success': True})
except Exception as e:
    logger.error(f"Error in endpoint: {e}")
    return Response({
        'success': False,
        'error': 'Processing failed'
    }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
```

## 🔒 Security Considerations

### 1. File Upload Security
- Validate file extensions and MIME types
- Limit file sizes to prevent DoS attacks
- Scan uploaded files for malware (production)
- Store uploaded files outside web root

### 2. Data Protection
- Sanitize all user inputs
- Use parameterized database queries
- Implement CSRF protection
- Enable CORS only for trusted origins

### 3. Production Settings
```python
# settings.py - Production security
DEBUG = False
ALLOWED_HOSTS = ['your-domain.com']
SECURE_SSL_REDIRECT = True
SECURE_HSTS_SECONDS = 31536000
```

## 📈 Performance Monitoring

### 1. Backend Metrics
- Response times for API endpoints
- Database query performance
- File processing duration
- Memory usage during Excel processing

### 2. Frontend Metrics  
- Component render times
- Bundle size and loading performance
- API response times from client perspective
- User interaction responsiveness

## 🔧 Troubleshooting Guide

### Common Development Issues

1. **CORS Errors**
   - Check `CORS_ALLOWED_ORIGINS` in settings.py
   - Ensure frontend URL matches exactly

2. **Database Migration Issues**
   - Delete db.sqlite3 and migrations (development only)
   - Run `python manage.py makemigrations` then `migrate`

3. **File Upload Failures**
   - Check file permissions on uploaded_files directory
   - Verify file size limits in settings

4. **Grid Display Issues**
   - Clear browser cache
   - Check AG-Grid license (community vs enterprise)
   - Verify column definitions structure

---

This guide provides comprehensive context for developing and maintaining the Excel Template Mapper application. Reference this document for architectural decisions, implementation patterns, and troubleshooting guidance.