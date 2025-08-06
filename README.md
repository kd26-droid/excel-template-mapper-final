# Excel Template Mapper - Factwise BOM Processing Tool

A comprehensive web application for automating the conversion of client Excel files to Factwise's internal format. This tool provides intelligent column mapping, data processing, and enhanced tagging capabilities for Bill of Materials (BOM) files.

## 🚀 Features

### Core Functionality
- **Intelligent File Upload**: Support for Excel (.xlsx) files with automatic format detection
- **AI-Powered Column Mapping**: Smart suggestions for mapping client columns to template fields
- **Interactive Data Editor**: Spreadsheet-like interface for data review and editing
- **Template Management**: Save and reuse column mappings for consistent processing

### Advanced Features
- **Smart Tags**: Automatically generate component tags based on specifications and descriptions
- **Formula Builder**: Create custom rules for data transformation and enhancement  
- **Factwise ID Generation**: Combine columns to create unique identifiers
- **Specification Parsing**: Intelligent parsing of component specifications
- **Bulk Processing**: Handle multiple files simultaneously
- **Export Options**: Download processed files in Excel or CSV format

## 🏗️ Architecture

### Technology Stack
- **Frontend**: React 18 with Material-UI, AG-Grid for data display
- **Backend**: Django 4.2 with Django REST Framework
- **Database**: SQLite (development) / PostgreSQL (production)
- **File Processing**: pandas, openpyxl for Excel manipulation

### Project Structure
```
BOM/
├── backend/                 # Django REST API
│   ├── excel_mapper/       # Main application
│   ├── excel_mapping/      # Django project settings
│   ├── utils/              # Utility functions
│   └── manage.py
├── frontend/               # React application
│   ├── src/
│   │   ├── components/     # Reusable components
│   │   ├── pages/          # Main application pages
│   │   ├── services/       # API communication
│   │   └── utils/          # Helper functions
│   └── public/
├── docs/                   # Technical documentation
└── README.md
```

## 🛠️ Installation & Setup

### Prerequisites
- Python 3.8+
- Node.js 16+
- npm or yarn

### Backend Setup
```bash
cd backend

# Create virtual environment
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Run migrations
python manage.py migrate

# Create superuser (optional)
python manage.py createsuperuser

# Start development server
python manage.py runserver
```

### Frontend Setup
```bash
cd frontend

# Install dependencies
npm install

# Start development server
npm start
```

### Environment Configuration
Create `.env` files in the backend directory:

```bash
# backend/.env
DEBUG=True
SECRET_KEY=your-secret-key-here
ALLOWED_HOSTS=localhost,127.0.0.1
CORS_ALLOWED_ORIGINS=http://localhost:3000
```

## 🎯 Usage

### Basic Workflow
1. **Upload Files**: Select client Excel file and template file
2. **Column Mapping**: Review and adjust AI-suggested mappings
3. **Data Processing**: Apply transformations and smart tags
4. **Data Editing**: Review and edit processed data
5. **Export**: Download the processed file

### Advanced Features

#### Smart Tags
Create intelligent tags for components:
```
Rule: IF description CONTAINS "capacitor" AND "ceramic" 
      THEN tag = "Ceramic Capacitor"
```

#### Factwise ID Creation
Combine columns to create unique identifiers:
```
Column 1 + "_" + Column 2 = "MPN123_SUPPLIER456"
```

#### Template Management
Save frequently used mappings:
- Column mappings
- Smart tag rules
- Factwise ID configurations

## 📚 API Documentation

### Core Endpoints
- `POST /api/upload/` - Upload files and create session
- `POST /api/mapping/suggestions/` - Get AI mapping suggestions
- `POST /api/mapping/save/` - Save column mappings
- `GET /api/data/` - Retrieve processed data
- `POST /api/formulas/apply/` - Apply smart tag rules
- `GET /api/download/` - Download processed files

### Template Management
- `GET /api/templates/` - List saved templates
- `POST /api/templates/save/` - Save new template
- `POST /api/templates/apply/` - Apply existing template

## 🔧 Configuration

### File Upload Limits
- Maximum file size: 25MB
- Supported formats: .xlsx
- Session timeout: 60 minutes

### Performance Settings
- Default page size: 20 rows
- Maximum page size: 100 rows
- Cache timeout: 1 hour

## 🚀 Production Deployment

### Backend (Django)
```bash
# Install production dependencies
pip install gunicorn psycopg2-binary

# Collect static files
python manage.py collectstatic

# Run with Gunicorn
gunicorn excel_mapping.wsgi:application --bind 0.0.0.0:8000
```

### Frontend (React)
```bash
# Build for production
npm run build

# Serve with nginx or similar
```

### Database Migration
For production, use PostgreSQL:
```python
DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.postgresql',
        'NAME': 'excel_mapper',
        'USER': 'your_user',
        'PASSWORD': 'your_password',
        'HOST': 'localhost',
        'PORT': '5432',
    }
}
```

## 🧪 Testing

### Backend Tests
```bash
cd backend
python manage.py test
```

### Frontend Tests
```bash
cd frontend
npm test
```

## 📈 Performance Optimization

- **Pagination**: Large datasets are automatically paginated
- **Lazy Loading**: Components load data as needed
- **Caching**: Template mappings and session data are cached
- **File Processing**: Streaming for large Excel files

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is proprietary software developed for Factwise. All rights reserved.

## 🆘 Support

For technical support or questions:
- Check the documentation in the `docs/` directory
- Review the API endpoints documentation
- Contact the development team

---

**Built with ❤️ for Factwise** - Streamlining BOM processing with intelligent automation