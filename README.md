# Excel Template Mapper — Factwise Project

## Project Overview

Procurement users receive item lists in Excel format from their clients, but these follow different formats. Our software (Factwise) accepts only our internal Excel format. Currently, users manually convert columns from client Excel into our format, which is time-consuming.

This tool automates the mapping process, allows edits, and streamlines file conversion using AI-assisted column mapping.

## Technologies Used

- Frontend: React with Material-UI
- Backend: Django REST Framework
- API communication: RESTful (JSON-based)

## UI Flow and Feature Breakdown

### Screen 1: Upload Files

- Two upload inputs:
  - User Excel File (from client)
  - Factwise Excel Template
- A "Submit" button
- Sends both files to backend via API

Backend Logic:
- Accept two Excel files
- Store them temporarily (in memory or filesystem)
- Return column headers from both files

### Screen 2: Column Mapping

- Display column headers:
  - Left column: Factwise template
  - Right column: User Excel file
- Pre-map matches (mock AI logic)
- Show:
  - Confidence score for each match (mocked)
  - Editable dropdowns for unmatched fields
- Button: “Save Mapping”

Backend Logic:
- Accept Excel files
- Return mock column mappings and confidence scores

### Screen 3: Sheet Review + Edit

- Editable table (spreadsheet-style UI)
- Display mapped and merged data
- Allow users to edit cell values
- Save button

Backend Logic:
- Accept updated data
- Return success message

### Screen 4: Upload Dashboard

- List of uploaded file mappings
- Mock table with:
  - Template Name
  - Upload Date
  - Number of Rows Processed
- “View” and “Download” buttons (mock only)

Backend Logic:
- Return mock list of past uploads

## API Requirements

APIs should:
- Upload and receive files
- Return headers for mapping
- Return mapping with confidence score
- Accept saved mappings
- Accept final editable sheet data
- Return list of uploads

Keep it modular and scalable. Each endpoint should be usable separately with JSON.

## Implementation

### Project Structure

```
BOM/
├── backend/                # Django backend
│   ├── excel_mapper/       # Main Django project
│   └── excel_mapping/      # Django app for Excel mapping functionality
│       ├── models.py       # Data models
│       ├── views.py        # API views
│       └── urls.py         # URL routing
└── frontend/              # React frontend
    ├── public/             # Static files
    └── src/                # Source code
        ├── components/     # Reusable UI components
        ├── pages/          # Page components
        ├── services/       # API services
        └── utils/          # Utility functions
```

### API Endpoints Implemented

- `POST /api/upload/`: Upload Excel files
- `GET /api/mapping/{session_id}/`: Get column mapping suggestions
- `POST /api/mapping/{session_id}/`: Save column mappings
- `GET /api/data/{session_id}/`: Get mapped data
- `POST /api/data/{session_id}/`: Save edited data
- `GET /api/dashboard/`: Get dashboard data
- `GET /api/download/{session_id}/`: Download processed file
- `GET /api/health/`: Health check endpoint