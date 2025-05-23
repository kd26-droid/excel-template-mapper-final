import pandas as pd
import uuid
import random
from typing import Dict, List, Tuple, Any
from io import BytesIO


def generate_session_id() -> str:
    """Generate a unique session ID"""
    return str(uuid.uuid4())


def extract_excel_columns(file_content: bytes, file_name: str) -> List[str]:
    """Extract column headers from Excel file"""
    try:
        # Read Excel file from bytes
        df = pd.read_excel(BytesIO(file_content), nrows=0)  # Only read headers
        return list(df.columns)
    except Exception as e:
        raise ValueError(f"Error reading Excel file {file_name}: {str(e)}")


def read_excel_data(file_content: bytes, file_name: str, max_rows: int = 100) -> pd.DataFrame:
    """Read Excel data with limited rows for preview"""
    try:
        df = pd.read_excel(BytesIO(file_content), nrows=max_rows)
        return df
    except Exception as e:
        raise ValueError(f"Error reading Excel data from {file_name}: {str(e)}")


def mock_ai_column_mapping(template_columns: List[str], user_columns: List[str]) -> List[Dict[str, Any]]:
    """Mock AI logic for column mapping with confidence scores"""
    mappings = []
    used_user_columns = set()
    
    # Common mapping patterns for demonstration
    common_mappings = {
        'item_name': ['product_name', 'item', 'product', 'name', 'description'],
        'item_code': ['sku', 'code', 'product_code', 'item_id', 'id'],
        'quantity': ['qty', 'amount', 'count', 'number'],
        'unit_price': ['price', 'cost', 'rate', 'unit_cost'],
        'total_price': ['total', 'amount', 'total_cost', 'value'],
        'category': ['type', 'group', 'class', 'classification'],
        'supplier': ['vendor', 'manufacturer', 'brand', 'company'],
        'unit': ['uom', 'unit_of_measure', 'measurement'],
    }
    
    for template_col in template_columns:
        best_match = None
        best_score = 0.0
        
        # Check for exact matches first
        template_lower = template_col.lower().replace('_', ' ').replace('-', ' ')
        
        for user_col in user_columns:
            if user_col in used_user_columns:
                continue
                
            user_lower = user_col.lower().replace('_', ' ').replace('-', ' ')
            
            # Exact match
            if template_lower == user_lower:
                best_match = user_col
                best_score = 0.95
                break
            
            # Partial match
            if template_lower in user_lower or user_lower in template_lower:
                score = 0.8
                if score > best_score:
                    best_match = user_col
                    best_score = score
            
            # Check common mappings
            if template_col.lower() in common_mappings:
                for pattern in common_mappings[template_col.lower()]:
                    if pattern in user_lower:
                        score = 0.7 + random.uniform(0.0, 0.2)  # Add some randomness
                        if score > best_score:
                            best_match = user_col
                            best_score = score
        
        # Add mapping result
        mapping = {
            'template_column': template_col,
            'user_column': best_match,
            'confidence_score': round(best_score, 2),
            'is_manual': False
        }
        
        if best_match:
            used_user_columns.add(best_match)
        
        mappings.append(mapping)
    
    return mappings


def apply_column_mapping(user_data: pd.DataFrame, mappings: List[Dict[str, Any]]) -> pd.DataFrame:
    """Apply column mappings to user data and return mapped DataFrame"""
    mapped_data = pd.DataFrame()
    
    # Create mapping dictionary
    mapping_dict = {}
    for mapping in mappings:
        if mapping['user_column']:
            mapping_dict[mapping['user_column']] = mapping['template_column']
    
    # Apply mappings
    for user_col, template_col in mapping_dict.items():
        if user_col in user_data.columns:
            mapped_data[template_col] = user_data[user_col]
    
    # Add empty columns for unmapped template columns
    for mapping in mappings:
        template_col = mapping['template_column']
        if template_col not in mapped_data.columns:
            mapped_data[template_col] = ''
    
    return mapped_data


def generate_mock_upload_history() -> List[Dict[str, Any]]:
    """Generate mock upload history for dashboard"""
    mock_data = [
        {
            'id': 1,
            'session_id': 'session_001',
            'template_name': 'Standard Item Template',
            'upload_date': '2024-01-15T10:30:00Z',
            'rows_processed': 150,
            'status': 'completed'
        },
        {
            'id': 2,
            'session_id': 'session_002',
            'template_name': 'Electronics Catalog',
            'upload_date': '2024-01-14T14:20:00Z',
            'rows_processed': 89,
            'status': 'completed'
        },
        {
            'id': 3,
            'session_id': 'session_003',
            'template_name': 'Office Supplies',
            'upload_date': '2024-01-13T09:15:00Z',
            'rows_processed': 234,
            'status': 'completed'
        },
        {
            'id': 4,
            'session_id': 'session_004',
            'template_name': 'Raw Materials',
            'upload_date': '2024-01-12T16:45:00Z',
            'rows_processed': 67,
            'status': 'in_progress'
        },
        {
            'id': 5,
            'session_id': 'session_005',
            'template_name': 'Medical Equipment',
            'upload_date': '2024-01-11T11:30:00Z',
            'rows_processed': 45,
            'status': 'completed'
        }
    ]
    
    return mock_data


def validate_excel_file(file) -> Tuple[bool, str]:
    """Validate if uploaded file is a valid Excel file"""
    try:
        if not file.name.endswith(('.xlsx', '.xls')):
            return False, "File must be an Excel file (.xlsx or .xls)"
        
        # Try to read the file to ensure it's valid
        df = pd.read_excel(file, nrows=1)
        
        if df.empty:
            return False, "Excel file appears to be empty"
        
        return True, "Valid Excel file"
    
    except Exception as e:
        return False, f"Invalid Excel file: {str(e)}"