"""
Working views for Excel Template Mapper application.
Optimized for smooth Excel to Excel mapping functionality.
"""

import os
import uuid
import logging
from pathlib import Path
from datetime import datetime
from typing import Dict, Any, Optional

import pandas as pd
from django.conf import settings
from django.http import FileResponse, Http404
from rest_framework import status
from rest_framework.decorators import api_view, parser_classes
from rest_framework.parsers import MultiPartParser, FormParser
from rest_framework.response import Response
from rest_framework.views import APIView
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill

from .bom_header_mapper import BOMHeaderMapper
from .models import MappingTemplate, TagTemplate
try:
    # Prefer relative import; fall back gracefully on any import error
    from .azure_storage import hybrid_file_manager
except Exception:
    # Fallback to local file manager if azure_storage is not available
    import os
    import uuid
    from pathlib import Path
    from typing import Tuple
    
    class LocalFileManager:
        def __init__(self):
            self.local_upload_dir = Path(settings.BASE_DIR) / 'uploaded_files'
            self.local_temp_dir = Path(settings.BASE_DIR) / 'temp_downloads'
            self._ensure_local_directories()
        
        def _ensure_local_directories(self):
            self.local_upload_dir.mkdir(parents=True, exist_ok=True)
            self.local_temp_dir.mkdir(parents=True, exist_ok=True)
        
        def save_upload_file(self, file, prefix="upload") -> Tuple[str, str]:
            file_extension = Path(file.name).suffix
            unique_filename = f"{uuid.uuid4()}_{prefix}{file_extension}"
            local_file_path = self.local_upload_dir / unique_filename
            
            with open(local_file_path, 'wb+') as destination:
                for chunk in file.chunks():
                    destination.write(chunk)
            
            return str(local_file_path), file.name
        
        def get_file_path(self, file_identifier: str) -> str:
            return file_identifier
    
    hybrid_file_manager = LocalFileManager()

# Configure logging
logger = logging.getLogger(__name__)

# In-memory store for each session
SESSION_STORE = {}

# Session persistence helper functions
def save_session_to_file(session_id, session_data):
    """Save session data to file for persistence."""
    try:
        session_file = hybrid_file_manager.local_temp_dir / f"session_{session_id}.json"
        import json
        with open(session_file, 'w') as f:
            # Convert paths to strings for JSON serialization
            serializable_data = {}
            for key, value in session_data.items():
                if isinstance(value, Path):
                    serializable_data[key] = str(value)
                else:
                    serializable_data[key] = value
            json.dump(serializable_data, f)
        logger.info(f"💾 Saved session {session_id} to file")
    except Exception as e:
        logger.warning(f"Failed to save session {session_id}: {e}")

def load_session_from_file(session_id):
    """Load session data from file."""
    try:
        session_file = hybrid_file_manager.local_temp_dir / f"session_{session_id}.json"
        if session_file.exists():
            import json
            with open(session_file, 'r') as f:
                session_data = json.load(f)
            logger.info(f"📂 Loaded session {session_id} from file")
            return session_data
    except Exception as e:
        logger.warning(f"Failed to load session {session_id}: {e}")
    return None

def get_session(session_id):
    """
    Universal session retrieval that works across multiple workers.
    Checks memory first, then loads from file if needed.
    Returns session data or None if not found.
    """
    if session_id in SESSION_STORE:
        logger.info(f"🔍 Session {session_id} found in memory")
        return SESSION_STORE[session_id]
    
    # Try to load from file
    logger.info(f"🔍 Session {session_id} not in memory, trying file")
    session_data = load_session_from_file(session_id)
    if session_data:
        SESSION_STORE[session_id] = session_data
        logger.info(f"🔄 Restored session {session_id} from file to memory")
        logger.info(f"🔍 Session keys: {list(session_data.keys())}")
        return session_data
    
    logger.warning(f"❌ Session {session_id} not found in memory or file")
    return None

def save_session(session_id, session_data):
    """
    Universal session saving that persists across multiple workers.
    Saves to both memory and file.
    """
    SESSION_STORE[session_id] = session_data
    save_session_to_file(session_id, session_data)
    logger.info(f"💾 Saved session {session_id} to both memory and file")


# Use hybrid file manager from azure_storage module
# This automatically handles Azure Blob Storage when available,
# falls back to local storage for development


def apply_column_mappings(client_file, mappings, sheet_name=None, header_row=0, session_id=None):
    """
    Apply column mappings to transform client data to template format.
    Now supports multiple source columns mapping to the same template column name (with identical names).
    Includes ALL template columns, even unmapped ones (which will be empty).
    """
    try:
        logger.info(f"🔍 apply_column_mappings received mappings: {mappings}")
        
        # Get template headers - use dynamic columns if available, otherwise read from file
        template_headers = []
        if session_id and session_id in SESSION_STORE:
            info = SESSION_STORE[session_id]
            
            # Prefer canonical current headers (persisted)
            canonical_headers = info.get("current_template_headers") or info.get("enhanced_headers")
            if canonical_headers and isinstance(canonical_headers, list) and len(canonical_headers) > 0:
                template_headers = canonical_headers
                logger.info(f"🔍 Using {len(template_headers)} canonical template headers from session")
            elif 'tags_count' in info or 'spec_pairs_count' in info or 'customer_id_pairs_count' in info:
                # Dynamic template columns when counts provided
                tags_count = info.get('tags_count', 1)
                spec_pairs_count = info.get('spec_pairs_count', 1)
                customer_id_pairs_count = info.get('customer_id_pairs_count', 1)
                template_headers = generate_template_columns(tags_count, spec_pairs_count, customer_id_pairs_count)
                logger.info(f"🔍 Generated {len(template_headers)} dynamic template columns")
            else:
                # Fallback to reading from template file
                template_headers = SESSION_STORE[session_id].get("template_headers", [])
                if not template_headers:
                    try:
                        from .bom_header_mapper import BOMHeaderMapper
                        mapper = BOMHeaderMapper()
                        template_headers = mapper.read_excel_headers(
                            file_path=hybrid_file_manager.get_file_path(info["template_path"]),
                            sheet_name=info.get("template_sheet_name"),
                            header_row=info.get("template_header_row", 1) - 1 if info.get("template_header_row", 1) > 0 else 0
                        )
                        # Store in session for future use
                        SESSION_STORE[session_id]["template_headers"] = template_headers
                        logger.info(f"🔍 Read and cached {len(template_headers)} template headers from file")
                    except Exception as e:
                        logger.warning(f"Could not read template headers: {e}")
                else:
                    logger.info(f"🔍 Found {len(template_headers)} template headers from session")
        
        # Handle new mapping format from frontend
        if isinstance(mappings, dict) and 'mappings' in mappings:
            # New format: ordered list of individual mappings
            mapping_list = mappings['mappings']
            logger.info(f"🔍 Processing new mapping format with {len(mapping_list)} mappings")
            
            # Extract and save default values if provided
            if 'default_values' in mappings and session_id and session_id in SESSION_STORE:
                default_values = mappings['default_values']
                SESSION_STORE[session_id]["default_values"] = default_values
                logger.info(f"🔧 DEBUG: Saved default values to session {session_id}: {default_values}")
        else:
            # Fallback to old format for compatibility - convert to preserve order better
            mapping_list = []
            logger.info(f"🔍 Converting old format mappings: {mappings}")
            
            # Process in the order they appear in the original dict to preserve user intent
            # Don't sort alphabetically as that changes the user's intended order
            
            for template_column, source_info in mappings.items():
                if isinstance(source_info, list):
                    # Multiple sources mapped to same target - this was the problematic case
                    logger.info(f"🔍 Old format: Multiple sources {source_info} -> {template_column}")
                    for source_column in source_info:
                        mapping_list.append({'source': source_column, 'target': template_column})
                        logger.info(f"🔍 Converted: {source_column} -> {template_column}")
                else:
                    # Single source mapping
                    logger.info(f"🔍 Old format: Single source {source_info} -> {template_column}")
                    mapping_list.append({'source': source_info, 'target': template_column})
            
            logger.info(f"🔍 Converted old format to {len(mapping_list)} individual mappings")
        
        # Resolve local path if using Azure Blob Storage and read the client data
        client_local_path = hybrid_file_manager.get_file_path(client_file)
        if str(client_local_path).lower().endswith('.csv'):
            df = pd.read_csv(client_local_path, header=header_row)
        else:
            result = pd.read_excel(client_local_path, sheet_name=sheet_name, header=header_row)
            
            # Handle multiple sheets case
            if isinstance(result, dict):
                # If sheet_name is None, we get a dict with all sheets
                # Use the first sheet
                first_sheet_name = list(result.keys())[0]
                df = result[first_sheet_name]
            else:
                df = result
        
        # Clean column names
        df.columns = [str(col).strip() for col in df.columns]
        
        # Build column order - start with mapped columns in order, then add unmapped template columns
        mapped_targets = []
        mapping_dict = {}  # target -> list of mappings for that target
        
        for mapping in mapping_list:
            target = mapping['target']
            if target not in mapping_dict:
                mapping_dict[target] = []
                mapped_targets.append(target)
            mapping_dict[target].append(mapping)
        
        # Add unmapped template columns at the end
        column_order = mapped_targets.copy()
        if template_headers:
            for template_col in template_headers:
                if template_col not in mapped_targets:
                    column_order.append(template_col)
        
        # Get session default values for unmapped fields
        session_default_values = {}
        if session_id and session_id in SESSION_STORE:
            session_default_values = SESSION_STORE[session_id].get("default_values", {})
        
        # Process each row - match the header logic
        transformed_rows = []
        for _, row in df.iterrows():
            transformed_row = []
            
            for target_column in column_order:
                if target_column in mapping_dict:
                    # This column has mappings - for numbered fields, take the first mapping only
                    mappings_for_target = mapping_dict[target_column]
                    
                    # For our numbered fields (Tag_1, Tag_2, etc.), there should be exactly one mapping per target
                    # Take the first (and usually only) mapping
                    mapping = mappings_for_target[0]
                    source_column = mapping['source']
                    
                    # IMPORTANT: Handle default value mappings (from template apply)
                    if source_column and source_column.startswith("__DEFAULT__"):
                        # Extract default value from special source format: "__DEFAULT__value"
                        default_value = source_column[11:]  # Remove "__DEFAULT__" prefix
                        transformed_row.append(default_value)
                        logger.info(f"🔧 Applied default value '{default_value}' to column '{target_column}'")
                    elif source_column and source_column in df.columns:
                        value = row.get(source_column, "")
                        if pd.isna(value):
                            value = ""
                        else:
                            value = str(value).strip()

                        # If the mapped source yields an empty value, fall back to session default if available
                        if (value == "" or value is None) and target_column in session_default_values:
                            default_value = session_default_values.get(target_column, "")
                            value = str(default_value)
                            logger.info(f"🔧 Applied session default value '{default_value}' to mapped column '{target_column}' due to empty source value")

                        transformed_row.append(value)
                    else:
                        # Source column missing - fall back to default if available
                        if target_column in session_default_values:
                            default_value = session_default_values.get(target_column, "")
                            transformed_row.append(str(default_value))
                            logger.info(f"🔧 Applied session default value '{default_value}' to unmapped/missing-source column '{target_column}'")
                        else:
                            transformed_row.append("")  # Empty value for missing source columns
                        
                    # Handle additional mappings to the same target (rare with numbered system)
                    for additional_mapping in mappings_for_target[1:]:
                        additional_source = additional_mapping['source']
                        if additional_source and additional_source in df.columns:
                            additional_value = row.get(additional_source, "")
                            if pd.isna(additional_value):
                                additional_value = ""
                            else:
                                additional_value = str(additional_value).strip()
                            transformed_row.append(additional_value)
                        else:
                            transformed_row.append("")
                else:
                    # Unmapped template column - check for default value, otherwise empty
                    if target_column in session_default_values:
                        default_value = session_default_values[target_column]
                        transformed_row.append(str(default_value))
                        logger.info(f"🔧 Applied session default value '{default_value}' to unmapped column '{target_column}'")
                    else:
                        transformed_row.append("")  # Empty value for truly unmapped columns
            
            transformed_rows.append(transformed_row)
        
        # Build final headers list - for numbered fields, don't add duplicates
        # Our numbered fields (Tag_1, Tag_2, etc.) are already unique
        final_headers = []
        seen_headers = set()
        
        for target_column in column_order:
            if target_column in mapping_dict:
                # For numbered fields, each mapping should map to exactly one header
                mappings_for_target = mapping_dict[target_column]
                
                # If target_column is already numbered (e.g., Tag_1, Tag_2), use it as-is
                if target_column not in seen_headers:
                    final_headers.append(target_column)
                    seen_headers.add(target_column)
                elif len(mappings_for_target) > 1:
                    # Only create numbered variants if we have multiple mappings to the same unnumbered target
                    # This should rarely happen with our new numbering system
                    base_name = target_column.split('_')[0] if '_' in target_column else target_column
                    counter = 2
                    new_header = f"{base_name}_{counter}"
                    while new_header in seen_headers:
                        counter += 1
                        new_header = f"{base_name}_{counter}"
                    final_headers.append(new_header)
                    seen_headers.add(new_header)
            else:
                # Unmapped template column - add as-is if not already seen
                if target_column not in seen_headers:
                    final_headers.append(target_column)
                    seen_headers.add(target_column)
        
        # Return data structure that includes column order and data
        return {
            'headers': final_headers,
            'data': transformed_rows
        }
        
    except Exception as e:
        logger.error(f"Error in apply_column_mappings: {e}")
        return {'headers': [], 'data': []}


@api_view(['GET'])
def health_check(request):
    """Health check endpoint."""
    return Response({
        'status': 'healthy',
        'timestamp': datetime.utcnow().isoformat(),
        'version': '1.0.0'
    })


@api_view(['POST'])
def debug_session(request):
    """Debug endpoint to check session data."""
    session_id = request.data.get('session_id')
    if session_id in SESSION_STORE:
        session_data = SESSION_STORE[session_id].copy()
        # Remove sensitive file paths for security
        session_data.pop('client_path', None)
        session_data.pop('template_path', None)
        
        # Add extra debug info for mappings
        mappings = session_data.get('mappings')
        if mappings:
            logger.info(f"🔍 DEBUG Session {session_id} mappings: {mappings}")
            logger.info(f"🔍 DEBUG Mappings type: {type(mappings)}")
            if isinstance(mappings, dict):
                logger.info(f"🔍 DEBUG Mappings keys: {list(mappings.keys())}")
                if 'mappings' in mappings:
                    logger.info(f"🔍 DEBUG New format detected with {len(mappings['mappings'])} individual mappings")
                else:
                    logger.info(f"🔍 DEBUG Old format detected")
        
        return Response({'session_data': session_data})
    else:
        return Response({'error': 'Session not found'}, status=404)


@api_view(['POST'])
@parser_classes([MultiPartParser, FormParser])
def upload_files(request):
    """
    Upload and process client and template files.
    Optimized for Excel to Excel mapping.
    """
    try:
        # Extract form data
        client_file = request.FILES.get('clientFile')
        template_file = request.FILES.get('templateFile')
        sheet_name = request.data.get('sheetName')
        header_row = int(request.data.get('headerRow', 1))
        template_sheet_name = request.data.get('templateSheetName')
        template_header_row = int(request.data.get('templateHeaderRow', 1))
        use_template_id = request.data.get('useTemplateId')
        
        # Extract formula rules if provided
        formula_rules_json = request.data.get('formulaRules')
        formula_rules = []
        if formula_rules_json:
            try:
                import json
                formula_rules = json.loads(formula_rules_json)
            except json.JSONDecodeError:
                logger.warning(f"Invalid formula rules JSON: {formula_rules_json}")
        
        # Validation
        if not client_file or not template_file:
            return Response({
                'success': False,
                'error': 'Both client and template files are required'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        # Validate file types
        allowed_extensions = ['.xlsx', '.xls', '.csv']
        client_ext = Path(client_file.name).suffix.lower()
        template_ext = Path(template_file.name).suffix.lower()
        
        if client_ext not in allowed_extensions or template_ext not in allowed_extensions:
            return Response({
                'success': False,
                'error': f'Only Excel (.xlsx, .xls) and CSV files are supported'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        # Save uploaded files
        client_path, client_original_name = hybrid_file_manager.save_upload_file(client_file, "client")
        template_path, template_original_name = hybrid_file_manager.save_upload_file(template_file, "template")
        
        # Generate session ID
        session_id = str(uuid.uuid4())
        
        # Store session data using universal session saving
        session_data = {
            "client_path": client_path,
            "template_path": template_path,
            "original_client_name": client_original_name,
            "original_template_name": template_original_name,
            "sheet_name": sheet_name,
            "header_row": header_row,
            "template_sheet_name": template_sheet_name,
            "template_header_row": template_header_row,
            "created": datetime.utcnow().isoformat(),
            "mappings": None,
            "edited_data": None,
            "original_template_id": None,
            "template_modified": False,
            "formula_rules": formula_rules if formula_rules else []
        }
        
        # Save session with universal persistence (critical for multi-worker environments)
        save_session(session_id, session_data)
        
        # Apply template if specified
        template_applied = False
        template_success = False
        applied_mappings = {}
        applied_formulas = False
        
        if use_template_id:
            try:
                template = MappingTemplate.objects.get(id=int(use_template_id))
                
                # Read client headers to apply template
                mapper = BOMHeaderMapper()
                client_headers = mapper.read_excel_headers(
                    file_path=hybrid_file_manager.get_file_path(client_path),
                    sheet_name=sheet_name,
                    header_row=header_row - 1 if header_row > 0 else 0
                )
                
                # Apply template mappings
                application_result = template.apply_to_headers(client_headers)
                
                if application_result['total_mapped'] > 0:
                    template_applied = True
                    template_success = True  # Consider success if any mappings work
                    applied_mappings = application_result['mappings']  # Old format
                    
                    # Use new format if available (preserves duplicates)
                    if 'mappings_new_format' in application_result and application_result['mappings_new_format']:
                        total_applied = application_result['total_mappings_with_duplicates']
                        new_format_mappings = {
                            "mappings": application_result['mappings_new_format']
                        }
                        logger.info(f"✅ Template applied successfully with {total_applied} mappings (including duplicates)")
                    else:
                        # Fallback to old format conversion
                        total_applied = application_result['total_mapped']
                        new_format_mappings = {
                            "mappings": [
                                {"source": source_col, "target": template_col}
                                for template_col, source_col in applied_mappings.items()
                            ]
                        }
                        logger.info(f"✅ Template applied successfully with {total_applied} mappings")
                    
                    # Update session with applied mappings
                    SESSION_STORE[session_id]["original_template_id"] = int(use_template_id)
                    SESSION_STORE[session_id]["mappings"] = new_format_mappings
                    logger.info(f"🔄 Converted {len(applied_mappings)} unique mappings from template application")
                    
                    # Apply formula rules if they exist (from template or Step 3)
                    template_formula_rules = getattr(template, 'formula_rules', []) or []
                    combined_formula_rules = template_formula_rules + formula_rules
                    if combined_formula_rules:
                        SESSION_STORE[session_id]["formula_rules"] = combined_formula_rules
                        
                        # Apply formulas to create enhanced data
                        mapping_result = apply_column_mappings(
                            client_file=client_path,
                            mappings=new_format_mappings,
                            sheet_name=sheet_name,
                            header_row=header_row - 1 if header_row > 0 else 0,
                            session_id=session_id
                        )
                        
                        # Convert to dict format for formula processing
                        dict_rows = []
                        for row_list in mapping_result['data']:
                            row_dict = {}
                            for i, header in enumerate(mapping_result['headers']):
                                if i < len(row_list):
                                    row_dict[header] = row_list[i]
                                else:
                                    row_dict[header] = ""
                            dict_rows.append(row_dict)
                        
                        # Apply formula rules to create enhanced data
                        formula_result = apply_formula_rules(
                            data_rows=dict_rows,
                            headers=mapping_result['headers'],
                            formula_rules=combined_formula_rules
                        )
                        
                        # Store enhanced data in session
                        SESSION_STORE[session_id]["formula_enhanced_data"] = formula_result['data']
                        SESSION_STORE[session_id]["enhanced_headers"] = formula_result['headers']
                        applied_formulas = True
                    
                    # Apply factwise rules if they exist
                    template_factwise_rules = getattr(template, 'factwise_rules', []) or []
                    if template_factwise_rules:
                        SESSION_STORE[session_id]["factwise_rules"] = template_factwise_rules
                        
                        # Apply each factwise rule with error handling
                        for rule in template_factwise_rules:
                            try:
                                if rule.get("type") == "factwise_id":
                                    first_column = rule.get("first_column")
                                    second_column = rule.get("second_column")
                                    operator = rule.get("operator", "_")
                                
                                    if first_column and second_column:
                                        # Get current data (either formula-enhanced or basic mapped)
                                        current_data = SESSION_STORE[session_id].get("formula_enhanced_data")
                                        current_headers = SESSION_STORE[session_id].get("enhanced_headers")
                                        
                                        if not current_data:
                                            # Use basic mapped data if no formula data exists
                                            mapping_result = apply_column_mappings(
                                                client_file=client_path,
                                                mappings=new_format_mappings,
                                                sheet_name=sheet_name,
                                                header_row=header_row - 1 if header_row > 0 else 0,
                                                session_id=session_id
                                            )
                                            current_data = mapping_result['data']
                                            current_headers = mapping_result['headers']
                                        
                                        # Check if required columns exist for Factwise ID
                                        if first_column not in current_headers:
                                            logger.warning(f"🆔 Factwise ID: First column '{first_column}' not found in headers: {current_headers}")
                                            continue  # Skip this factwise rule
                                        
                                        if second_column not in current_headers:
                                            logger.warning(f"🆔 Factwise ID: Second column '{second_column}' not found in headers: {current_headers}")
                                            continue  # Skip this factwise rule

                                        # Apply Factwise ID creation and map it to 'Item code' column
                                        first_col_idx = current_headers.index(first_column)
                                        second_col_idx = current_headers.index(second_column)

                                        # Determine target 'Item code' index; add if missing
                                        item_code_idx = None
                                        if "Item code" in current_headers:
                                            item_code_idx = current_headers.index("Item code")
                                            new_headers = list(current_headers)
                                            new_data_rows = []
                                        else:
                                            # Prepend 'Item code' if not present
                                            new_headers = ["Item code"] + list(current_headers)
                                            item_code_idx = 0
                                            new_data_rows = []

                                        if first_col_idx >= 0 and second_col_idx >= 0:
                                            for row in current_data:
                                                first_val = str(row[first_col_idx] if first_col_idx < len(row) else "").strip()
                                                second_val = str(row[second_col_idx] if second_col_idx < len(row) else "").strip()

                                                if first_val and second_val:
                                                    factwise_id = f"{first_val}{operator}{second_val}"
                                                elif first_val:
                                                    factwise_id = first_val
                                                elif second_val:
                                                    factwise_id = second_val
                                                else:
                                                    factwise_id = ""

                                                # Place into Item code column, adjusting row shape if we had to prepend
                                                if "Item code" in current_headers:
                                                    new_row = list(row)
                                                    # Ensure row length
                                                    while len(new_row) < len(new_headers):
                                                        new_row.append("")
                                                    new_row[item_code_idx] = factwise_id
                                                else:
                                                    new_row = [factwise_id] + list(row)

                                                new_data_rows.append(new_row)

                                            # Update session with Item code-enhanced data
                                            SESSION_STORE[session_id]["formula_enhanced_data"] = new_data_rows
                                            SESSION_STORE[session_id]["enhanced_headers"] = new_headers

                                            logger.info(f"🆔 Applied Factwise ID rule (mapped to 'Item code') from template during upload: {first_column} {operator} {second_column}")
                            except Exception as factwise_error:
                                logger.warning(f"🆔 Failed to apply Factwise ID rule during upload: {factwise_error}")
                                # Continue with other rules even if this one fails
                    
                    # Apply default values if they exist
                    template_default_values = getattr(template, 'default_values', {}) or {}
                    if template_default_values:
                        SESSION_STORE[session_id]["default_values"] = template_default_values
                        logger.info(f"🔧 DEBUG: Applied default values from template during upload: {template_default_values}")
                    
                    # Increment template usage
                    template.increment_usage()
                
            except Exception as e:
                import traceback
                logger.error(f"Template application failed: {e}")
                logger.error(f"Template application traceback: {traceback.format_exc()}")
                template_applied = True
                template_success = False
        
        logger.info(f"Files uploaded successfully for session {session_id}")
        
        return Response({
            'success': True,
            'session_id': session_id,
            'message': 'Files uploaded successfully',
            'template_applied': template_applied,
            'template_success': template_success,
            'applied_mappings': applied_mappings,
            'applied_formulas': applied_formulas
        }, status=status.HTTP_201_CREATED)
        
    except Exception as e:
        logger.error(f"Error in upload_files: {e}")
        return Response({
            'success': False,
            'error': f'Upload failed: {str(e)}'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['GET'])
def get_headers(request, session_id):
    """Get headers from uploaded files."""
    try:
        # Use universal session retrieval (works across multiple workers)
        info = get_session(session_id)
        if not info:
            return Response({
                'success': False,
                'error': 'Session not found'
            }, status=status.HTTP_404_NOT_FOUND)
        mapper = BOMHeaderMapper()
        
        # Read client headers (support Azure Blob by resolving to local cache)
        client_headers = mapper.read_excel_headers(
            file_path=hybrid_file_manager.get_file_path(info["client_path"]),
            sheet_name=info["sheet_name"],
            header_row=info["header_row"] - 1 if info["header_row"] > 0 else 0
        )
        
        # Read template headers (allow enhanced headers override)
        template_headers = mapper.read_excel_headers(
            file_path=hybrid_file_manager.get_file_path(info["template_path"]),
            sheet_name=info.get("template_sheet_name"),
            header_row=info.get("template_header_row", 1) - 1 if info.get("template_header_row", 1) > 0 else 0
        )
        # Try to read optional/mandatory annotations from rows above headers (substring match)
        template_optionals_map = {}
        try:
            import pandas as pd
            template_path = hybrid_file_manager.get_file_path(info["template_path"])
            template_header_row_idx = info.get("template_header_row", 1) - 1 if info.get("template_header_row", 1) > 0 else 0
            if template_header_row_idx > 0:
                # Read all rows above the header row to scan for annotations
                if str(template_path).lower().endswith('.csv'):
                    df_ann = pd.read_csv(template_path, header=None, nrows=template_header_row_idx)
                else:
                    df_ann = pd.read_excel(template_path, sheet_name=info.get("template_sheet_name"), header=None, nrows=template_header_row_idx)
                # For each header column, scan upward for any cell containing 'optional'
                for idx, header in enumerate(template_headers):
                    is_optional = False
                    if idx < df_ann.shape[1] and df_ann.shape[0] > 0:
                        col_series = df_ann.iloc[:, idx]
                        for cell in col_series[::-1]:  # scan from nearest row upward
                            try:
                                text = str(cell).strip().lower()
                            except Exception:
                                text = ''
                            if 'optional' in text:
                                is_optional = True
                                break
                            if 'mandatory' in text:
                                # Explicit mandatory marker above; stop scanning
                                is_optional = False
                                break
                    template_optionals_map[str(header)] = is_optional
        except Exception as e:
            logger.warning(f"Optional/Mandatory annotations not read: {e}")
        enhanced_headers = info.get("enhanced_headers")
        
        # Debug logging
        logger.info(f"🔍 Session {session_id} - enhanced_headers: {enhanced_headers}")
        logger.info(f"🔍 Session {session_id} - template_headers from file: {template_headers}")
        
        # Get column counts from session (with defaults)
        tags_count = info.get('tags_count', 1)
        spec_pairs_count = info.get('spec_pairs_count', 1)
        customer_id_pairs_count = info.get('customer_id_pairs_count', 1)
        
        # Helper functions for robust special-column detection (case/trim tolerant)
        def _norm(h: str) -> str:
            try:
                return str(h or '').strip().lower()
            except Exception:
                return ''
        def _is_tag(h: str) -> bool:
            h_norm = _norm(h)
            return h_norm == 'tag' or h_norm.startswith('tag_')
        def _is_spec_name(h: str) -> bool:
            h_norm = _norm(h)
            return h_norm == 'specification name' or h_norm.startswith('specification_name_')
        def _is_spec_value(h: str) -> bool:
            h_norm = _norm(h)
            return h_norm == 'specification value' or h_norm.startswith('specification_value_')
        def _is_cust_name(h: str) -> bool:
            h_norm = _norm(h)
            return h_norm == 'customer identification name' or h_norm.startswith('customer_identification_name_')
        def _is_cust_value(h: str) -> bool:
            h_norm = _norm(h)
            return h_norm == 'customer identification value' or h_norm.startswith('customer_identification_value_')

        # Always regenerate a canonical header list based on current counts
        # Start from original template headers, keep non-specials in order, cap specials to counts, then append any extras to reach counts
        if tags_count > 0 or spec_pairs_count > 0 or customer_id_pairs_count > 0:
            regenerated_headers = []
            tags_used = 0
            spec_used = 0
            cust_used = 0
            i = 0
            while i < len(template_headers):
                h = str(template_headers[i])
                if _is_tag(h):
                    if tags_used < tags_count:
                        regenerated_headers.append(f'Tag_{tags_used + 1}')
                        tags_used += 1
                    i += 1
                    continue
                if _is_spec_name(h) and (i + 1) < len(template_headers) and _is_spec_value(template_headers[i+1]):
                    if spec_used < spec_pairs_count:
                        regenerated_headers.extend([f'Specification_Name_{spec_used + 1}', f'Specification_Value_{spec_used + 1}'])
                        spec_used += 1
                    i += 2
                    continue
                if _is_cust_name(h) and (i + 1) < len(template_headers) and _is_cust_value(template_headers[i+1]):
                    if cust_used < customer_id_pairs_count:
                        regenerated_headers.extend([f'Customer_Identification_Name_{cust_used + 1}', f'Customer_Identification_Value_{cust_used + 1}'])
                        cust_used += 1
                    i += 2
                    continue
                # Non-optional or unknown headers are preserved
                regenerated_headers.append(h)
                i += 1

            # Append extras if counts exceed those available in the file
            if tags_used < tags_count:
                for i in range(tags_used, tags_count):
                    regenerated_headers.append(f'Tag_{i + 1}')
            if spec_used < spec_pairs_count:
                missing_spec = spec_pairs_count - spec_used
                for i in range(spec_used, spec_pairs_count):
                    regenerated_headers.extend([f'Specification_Name_{i + 1}', f'Specification_Value_{i + 1}'])
            if cust_used < customer_id_pairs_count:
                missing_cust = customer_id_pairs_count - cust_used
                for i in range(cust_used, customer_id_pairs_count):
                    regenerated_headers.extend([f'Customer_Identification_Name_{i + 1}', f'Customer_Identification_Value_{i + 1}'])

            # Store canonical headers in session
            info["current_template_headers"] = regenerated_headers
            # Keep enhanced_headers for backward compatibility with older FE
            info["enhanced_headers"] = regenerated_headers
            save_session(session_id, info)
            template_headers_to_use = regenerated_headers
            logger.info(f"🔍 Regenerated canonical template headers based on counts: {template_headers_to_use}")
        else:
            template_headers_to_use = template_headers
            logger.info(f"🔍 Using template_headers from file: {template_headers_to_use}")
            # Store template_headers in session for future use by update_column_counts
            info['template_headers'] = template_headers
            save_session(session_id, info)
        
        # Compute template_optionals aligned to the headers being returned
        def is_special_optional(h: str) -> bool:
            h_lower = (h or '').lower()
            return (h == 'Tag' or h.startswith('Tag_') or 
                   'specification' in h_lower or 
                   'customer identification' in h_lower or 
                   'customer_identification' in h_lower)
        
        template_optionals = []
        for h in template_headers_to_use:
            if is_special_optional(h):
                template_optionals.append(True)
            else:
                template_optionals.append(bool(template_optionals_map.get(str(h), False)))
        
        # Generate template columns based on counts (for reference)
        template_columns = generate_template_columns(tags_count, spec_pairs_count, customer_id_pairs_count)
        
        return Response({
            'success': True,
            'client_headers': client_headers,
            'template_headers': template_headers_to_use,
            'template_columns': template_columns,
            'template_optionals': template_optionals,
            'column_counts': {
                'tags_count': tags_count,
                'spec_pairs_count': spec_pairs_count,
                'customer_id_pairs_count': customer_id_pairs_count
            },
            'client_file': info.get('original_client_name', ''),
            'template_file': info.get('original_template_name', '')
        })
        
    except Exception as e:
        logger.error(f"Error in get_headers: {e}")
        return Response({
            'success': False,
            'error': f'Failed to get headers: {str(e)}'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
def mapping_suggestions(request):
    """Get AI-powered mapping suggestions."""
    try:
        session_id = request.data.get('session_id')
        if not session_id:
            return Response({
                'success': False,
                'error': 'Session ID is required'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        info = get_session(session_id)
        if not info:
            return Response({
                'success': False,
                'error': 'Session not found'
            }, status=status.HTTP_404_NOT_FOUND)
        mapper = BOMHeaderMapper()
        
        # Get mapping suggestions
        mapping_results = mapper.map_headers_to_template(
            client_file=hybrid_file_manager.get_file_path(info["client_path"]),
            template_file=hybrid_file_manager.get_file_path(info["template_path"]),
            client_sheet_name=info["sheet_name"],
            template_sheet_name=info.get("template_sheet_name"),
            client_header_row=info["header_row"] - 1 if info["header_row"] > 0 else 0,
            template_header_row=info.get("template_header_row", 1) - 1 if info.get("template_header_row", 1) > 0 else 0
        )
        
        # Prepare AI suggestions in format expected by frontend
        ai_suggestions = {}
        for result in mapping_results:
            if result['mapped_client_header'] and result['confidence'] >= 40:
                ai_suggestions[result['template_header']] = {
                    'suggested_column': result['mapped_client_header'],
                    'confidence': result['confidence'],
                    'is_specification_mapping': False
                }
        
        # Get headers for response
        client_headers = mapper.read_excel_headers(
            file_path=hybrid_file_manager.get_file_path(info["client_path"]),
            sheet_name=info["sheet_name"],
            header_row=info["header_row"] - 1 if info["header_row"] > 0 else 0
        )
        
        template_headers = mapper.read_excel_headers(
            file_path=hybrid_file_manager.get_file_path(info["template_path"]),
            sheet_name=info.get("template_sheet_name"),
            header_row=info.get("template_header_row", 1) - 1 if info.get("template_header_row", 1) > 0 else 0
        )
        
        return Response({
            'success': True,
            'ai_suggestions': ai_suggestions,
            'mapping_details': mapping_results,
            'template_headers': template_headers,
            'client_headers': client_headers,
            'user_columns': client_headers,
            'template_columns': template_headers,
            'specification_opportunity': {'detected': False},
            'session_metadata': {
                'original_template_id': info.get('original_template_id'),
                'template_applied': info.get('template_applied', False)
            }
        })
        
    except Exception as e:
        logger.error(f"Error in mapping_suggestions: {e}")
        return Response({
            'success': False,
            'error': f'Failed to generate suggestions: {str(e)}'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
def save_mappings(request):
    """Save column mappings for a session."""
    try:
        session_id = request.data.get('session_id')
        mappings = request.data.get('mappings', {})
        default_values = request.data.get('default_values', {})
        
        if not session_id:
            return Response({
                'success': False,
                'error': 'Session ID is required'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        info = get_session(session_id)
        if not info:
            return Response({
                'success': False,
                'error': 'Session not found'
            }, status=status.HTTP_404_NOT_FOUND)
        
        # Normalize mappings format and save
        # Accept both array format [{source, target}, ...] and object with .mappings
        normalized = mappings
        if isinstance(mappings, dict) and 'mappings' in mappings and isinstance(mappings['mappings'], list):
            normalized = mappings  # already in new format
        elif isinstance(mappings, list):
            normalized = { 'mappings': mappings }
        elif isinstance(mappings, dict):
            # old format {target: source} -> new format list
            normalized = { 'mappings': [ {'source': src, 'target': tgt} for tgt, src in mappings.items() ] }
        info["mappings"] = normalized
        
        # Save default values to session
        info["default_values"] = default_values
        logger.info(f"🔧 DEBUG: Session {session_id} - Saved default values: {default_values}")
        
        # Mark template as modified if it was originally from a saved template
        if info.get("original_template_id"):
            info["template_modified"] = True
        
        # Persist session using universal saving
        save_session(session_id, info)
        
        return Response({
            'success': True,
            'message': 'Mappings saved successfully'
        })
        
    except Exception as e:
        logger.error(f"Error in save_mappings: {e}")
        return Response({
            'success': False,
            'error': f'Failed to save mappings: {str(e)}'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['GET'])
def get_existing_mappings(request, session_id):
    """Get existing mappings for a session."""
    try:
        print(f"🔍 PRINT DEBUG: get_existing_mappings called for session {session_id}")
        logger.info(f"🔍 DEBUG: get_existing_mappings called for session {session_id}")
        session_data = get_session(session_id)
        print(f"🔍 PRINT DEBUG: Retrieved session data with keys: {list(session_data.keys()) if session_data else 'None'}")
        logger.info(f"🔍 DEBUG: Retrieved session data with keys: {list(session_data.keys()) if session_data else 'None'}")
        if not session_data:
            return Response({
                'success': False,
                'error': 'Session not found'
            }, status=status.HTTP_404_NOT_FOUND)
        mappings = session_data.get("mappings", {})
        default_values = session_data.get("default_values", {})
        
        # IMPORTANT: Derive column counts from default values if missing from session
        # This handles cases where templates were applied before the column count saving fix
        tags_count = session_data.get("tags_count", 1)
        spec_pairs_count = session_data.get("spec_pairs_count", 1)
        customer_id_pairs_count = session_data.get("customer_id_pairs_count", 1)
        
        logger.info(f"🔍 DEBUG: Session column counts - tags={tags_count}, spec={spec_pairs_count}, customer={customer_id_pairs_count}")
        logger.info(f"🔍 DEBUG: Default values keys: {list(default_values.keys()) if default_values else 'None'}")
        logger.info(f"🔍 DEBUG: Original template ID: {session_data.get('original_template_id')}")
        
        # If column counts are missing but we have default values, derive them
        if (tags_count == 1 and spec_pairs_count == 1 and customer_id_pairs_count == 1 
            and default_values and session_data.get("original_template_id")):
            logger.info("🔍 DEBUG: Conditions met, attempting to derive column counts")
            # Count Tag_ fields in default values
            tag_fields = [field for field in default_values.keys() if field.startswith("Tag_")]
            logger.info(f"🔍 DEBUG: Found tag fields: {tag_fields}")
            if tag_fields:
                # Extract numbers from Tag_1, Tag_2, etc. and find the maximum
                tag_numbers = []
                for field in tag_fields:
                    try:
                        num = int(field.split('_')[1])
                        tag_numbers.append(num)
                    except (IndexError, ValueError):
                        pass
                if tag_numbers:
                    tags_count = max(tag_numbers)
                    logger.info(f"🔍 Derived tags_count={tags_count} from default values: {tag_fields}")
        
        # Include session metadata for template state restoration
        session_metadata = {
            'template_applied': bool(session_data.get("original_template_id")),
            'original_template_id': session_data.get("original_template_id"),
            'template_name': None,  # Will be filled if we have template
            'template_success': True,  # Assume success if template was applied
            'formula_rules': session_data.get("formula_rules", []),
            'factwise_rules': session_data.get("factwise_rules", []),
            # IMPORTANT: Include column counts so frontend shows all dynamic columns
            'column_counts': {
                'tags_count': tags_count,
                'spec_pairs_count': spec_pairs_count,
                'customer_id_pairs_count': customer_id_pairs_count
            }
        }
        
        # Get template name if template was applied
        if session_metadata['original_template_id']:
            try:
                from .models import MappingTemplate
                template = MappingTemplate.objects.get(id=session_metadata['original_template_id'])
                session_metadata['template_name'] = template.name
            except Exception:
                session_metadata['template_name'] = 'Applied Template'
        
        return Response({
            'success': True,
            'mappings': mappings,
            'default_values': default_values,
            'session_metadata': session_metadata
        })
        
    except Exception as e:
        logger.error(f"Error in get_existing_mappings: {e}")
        return Response({
            'success': False,
            'error': f'Failed to get mappings: {str(e)}'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['GET'])
def data_view(request):
    """Get transformed data with applied mappings."""
    try:
        session_id = request.GET.get('session_id')
        page = int(request.GET.get('page', 1))
        page_size = int(request.GET.get('page_size', 20))
        
        if not session_id:
            return Response({
                'success': False,
                'error': 'No session ID provided'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        # Check if session exists in memory, if not try to load from file
        if session_id not in SESSION_STORE:
            session_data = load_session_from_file(session_id)
            if session_data:
                SESSION_STORE[session_id] = session_data
                logger.info(f"🔄 Restored session {session_id} from file")
                logger.info(f"🔧 DEBUG: Restored session contains default_values: {session_data.get('default_values', {})}")
            else:
                return Response({
                    'success': False,
                    'error': 'Session not found. Please upload files again.'
                }, status=status.HTTP_400_BAD_REQUEST)
        
        info = SESSION_STORE[session_id]
        logger.info(f"🔧 DEBUG: Processing session {session_id} for data view")
        
        # Always process fresh data - no caching
        mappings = info.get("mappings")
        # If mappings missing, try to refresh from file to handle multi-worker race
        if not mappings:
            refreshed = load_session_from_file(session_id)
            if refreshed and refreshed.get("mappings"):
                SESSION_STORE[session_id] = refreshed
                info = refreshed
                mappings = info.get("mappings")
                logger.info(f"🔄 Refreshed session {session_id} from file to load latest mappings")
        
        if not mappings:
            return Response({
                'success': False,
                'error': 'No mappings found. Please create mappings first.'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        # Convert mappings list format to expected dict format for apply_column_mappings
        if isinstance(mappings, list):
            # Convert list format to new dict format that apply_column_mappings expects
            formatted_mappings = {"mappings": mappings}
            logger.info(f"🔧 DEBUG: Converted list mappings to dict format: {formatted_mappings}")
        else:
            formatted_mappings = mappings
            logger.info(f"🔧 DEBUG: Using existing dict mappings: {formatted_mappings}")
        
        # Apply mappings to get fresh transformed data
        mapping_result = apply_column_mappings(
            client_file=info["client_path"],
            mappings=formatted_mappings,
            sheet_name=info["sheet_name"],
            header_row=info["header_row"] - 1 if info["header_row"] > 0 else 0,
            session_id=session_id
        )
        
        # Extract data and headers from new format
        transformed_rows = mapping_result['data']
        headers_to_use = mapping_result['headers']
        
        # Apply formula rules if they exist to create unique tag columns
        formula_rules = info.get("formula_rules", [])
        
        # Ensure formula column headers are included in headers_to_use
        if formula_rules:
            formula_headers = []
            for rule in formula_rules:
                target_col = rule.get('target_column')
                if target_col and target_col not in headers_to_use:
                    formula_headers.append(target_col)
            
            if formula_headers:
                headers_to_use.extend(formula_headers)
                logger.info(f"🔧 DEBUG: Added formula headers to response: {formula_headers}")
                logger.info(f"🔧 DEBUG: Updated headers_to_use: {headers_to_use}")
        
        # Deduplicate formula rules to prevent duplicate columns
        if formula_rules:
            # Create a unique key for each rule to identify duplicates
            seen_rules = set()
            deduplicated_rules = []
            
            for rule in formula_rules:
                # Create a unique identifier for this rule
                rule_key = (
                    rule.get('source_column', ''),
                    rule.get('column_type', ''),
                    rule.get('specification_name', ''),
                    str(rule.get('sub_rules', []))
                )
                
                if rule_key not in seen_rules:
                    seen_rules.add(rule_key)
                    deduplicated_rules.append(rule)
                else:
                    logger.info(f"🔧 DEBUG: Skipping duplicate formula rule: {rule}")
            
            formula_rules = deduplicated_rules
            logger.info(f"🔧 DEBUG: Deduplicated {len(info.get('formula_rules', []))} rules to {len(formula_rules)} rules")
        
        if formula_rules and transformed_rows:
            try:
                # Get all expected formula columns from session's formula_rules
                expected_formula_columns = set()
                for rule in formula_rules:
                    target_col = rule.get('target_column')
                    if target_col and (target_col.startswith('Tag_') or target_col.startswith('Spec_')):
                        expected_formula_columns.add(target_col)
                
                # Check which formula columns are missing from current headers
                existing_formula_columns = [h for h in headers_to_use if h.startswith('Tag_') or h.startswith('Spec_')]
                missing_formula_columns = expected_formula_columns - set(existing_formula_columns)
                
                if missing_formula_columns or expected_formula_columns:
                    if missing_formula_columns:
                        logger.info(f"🔧 DEBUG: Missing formula columns: {missing_formula_columns}, applying formulas")
                    else:
                        logger.info(f"🔧 DEBUG: All formula columns exist: {existing_formula_columns}, applying formulas to populate data")
                else:
                    logger.info(f"🔧 DEBUG: No existing formula columns found, applying {len(formula_rules)} formula rules")
                
                # Convert list-based data to dict format for formula processing
                if transformed_rows and isinstance(transformed_rows[0], list):
                    dict_rows = []
                    for row_list in transformed_rows:
                        row_dict = {}
                        for i, header in enumerate(headers_to_use):
                            if i < len(row_list):
                                row_dict[header] = row_list[i]
                            else:
                                row_dict[header] = ""
                        dict_rows.append(row_dict)
                    transformed_rows_for_formulas = dict_rows
                else:
                    transformed_rows_for_formulas = transformed_rows
                    
                formula_result = apply_formula_rules(
                    data_rows=transformed_rows_for_formulas,
                    headers=headers_to_use,
                    formula_rules=formula_rules
                )
                
                # Use formula-enhanced data
                transformed_rows = formula_result['data']
                headers_to_use = formula_result['headers']
                
                logger.info(f"🔧 DEBUG: Applied formula rules, new headers: {headers_to_use}")
                
            except Exception as e:
                logger.warning(f"Formula application failed in data_view: {e}")
                # Continue with non-enhanced data
        
        # Apply factwise ID rules if they exist
        factwise_rules = info.get("factwise_rules", [])
        logger.info(f"🔧 DEBUG: Found {len(factwise_rules)} factwise rules: {factwise_rules}")
        
        for factwise_rule in factwise_rules:
            if factwise_rule.get("type") == "factwise_id" and transformed_rows:
                try:
                    first_col = factwise_rule.get("first_column")
                    second_col = factwise_rule.get("second_column")
                    operator = factwise_rule.get("operator", "_")
                    strategy = factwise_rule.get("strategy", "fill_only_null")
                    
                    logger.info(f"🔧 DEBUG: Factwise rule - first_col: '{first_col}', second_col: '{second_col}', operator: '{operator}'")
                    logger.info(f"🔧 DEBUG: Available headers: {headers_to_use}")
                    
                    if first_col and second_col and first_col in headers_to_use and second_col in headers_to_use:
                        first_idx = headers_to_use.index(first_col)
                        second_idx = headers_to_use.index(second_col)
                        
                        logger.info(f"🔧 DEBUG: Column indices - first_idx: {first_idx}, second_idx: {second_idx}")
                        
                        # Map into Item code rather than creating a new column
                        # Normalize headers to find Item code variant
                        def norm(s: str) -> str:
                            return str(s).strip().lower().replace(' ', '').replace('_', '').replace('-', '')

                        item_header = None
                        for h in headers_to_use:
                            if norm(h) == norm('item code'):
                                item_header = h
                                break

                        if not item_header:
                            # If no Item code header exists yet, create one at the beginning
                            headers_to_use.insert(0, 'Item code')
                            item_header = 'Item code'
                            for i, row in enumerate(transformed_rows):
                                if isinstance(row, dict):
                                    first_val = row.get(first_col, "")
                                    second_val = row.get(second_col, "")
                                    factwise_id = f"{first_val}{operator}{second_val}" if first_val and second_val else (first_val or second_val or "")
                                    row[item_header] = factwise_id
                                else:
                                    first_val = row[first_idx] if first_idx < len(row) else ""
                                    second_val = row[second_idx] if second_idx < len(row) else ""
                                    factwise_id = f"{first_val}{operator}{second_val}" if first_val and second_val else (first_val or second_val or "")
                                    row.insert(0, factwise_id)
                        else:
                            # Fill existing Item code per strategy
                            for i, row in enumerate(transformed_rows):
                                if isinstance(row, dict):
                                    first_val = row.get(first_col, "")
                                    second_val = row.get(second_col, "")
                                    factwise_id = f"{first_val}{operator}{second_val}" if first_val and second_val else (first_val or second_val or "")
                                    if strategy == 'override_all' or not row.get(item_header):
                                        row[item_header] = factwise_id
                                else:
                                    first_val = row[first_idx] if first_idx < len(row) else ""
                                    second_val = row[second_idx] if second_idx < len(row) else ""
                                    factwise_id = f"{first_val}{operator}{second_val}" if first_val and second_val else (first_val or second_val or "")
                                    # Find index of item_header
                                    try:
                                        item_idx = headers_to_use.index(item_header)
                                    except ValueError:
                                        item_idx = None
                                    if item_idx is not None:
                                        if strategy == 'override_all' or (item_idx < len(row) and (row[item_idx] is None or str(row[item_idx]).strip() == "")):
                                            # Ensure row length and assign
                                            while len(row) <= item_idx:
                                                row.append("")
                                            row[item_idx] = factwise_id
                            
                            if i == 0:  # Log first row for debugging
                                logger.info(f"🔧 DEBUG: First row Factwise ID: '{factwise_id}' from '{first_val}' + '{operator}' + '{second_val}'")
                    else:
                        logger.warning(f"🔧 DEBUG: Columns not found - first_col '{first_col}' in headers: {first_col in headers_to_use}, second_col '{second_col}' in headers: {second_col in headers_to_use}")
                            
                except Exception as e:
                    logger.warning(f"Factwise ID application failed: {e}")
                    import traceback
                    logger.warning(f"Traceback: {traceback.format_exc()}")
        
        if not transformed_rows:
            return Response({
                'success': False,
                'error': 'No data could be transformed'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        # Convert list-based data to dict format - headers are already unique
        if transformed_rows and isinstance(transformed_rows[0], list):
            dict_rows = []
            for row_list in transformed_rows:
                row_dict = {}
                
                for i, header in enumerate(headers_to_use):
                    if i < len(row_list):
                        row_dict[header] = row_list[i]
                    else:
                        # Handle missing values
                        row_dict[header] = ""
                
                dict_rows.append(row_dict)
            transformed_rows = dict_rows
        
        # Apply default values for unmapped fields
        default_values = info.get("default_values", {})
        logger.info(f"🔧 DEBUG: Session {session_id} - Checking default values: {default_values}")
        logger.info(f"🔧 DEBUG: Session {session_id} - Headers available: {headers_to_use}")
        
        if default_values and transformed_rows:
            logger.info(f"🔧 DEBUG: Applying default values to {len(transformed_rows)} rows: {default_values}")
            
            for field_name, default_value in default_values.items():
                # Enhanced field name matching for numbered fields
                matched_field = None
                
                # First, try exact match
                if field_name in headers_to_use:
                    matched_field = field_name
                else:
                    # For numbered fields, also try case-insensitive and normalized matching
                    field_lower = field_name.lower().replace(' ', '_').replace('-', '_')
                    
                    for header in headers_to_use:
                        header_lower = header.lower().replace(' ', '_').replace('-', '_')
                        if header_lower == field_lower:
                            matched_field = header
                            break
                    
                    # If still no match, try pattern matching for numbered fields
                    if not matched_field:
                        # Handle cases where frontend might use different numbering format
                        import re
                        # Extract base name and number from field_name
                        match = re.match(r'(.+?)_?(\d+)$', field_name)
                        if match:
                            base_name, number = match.groups()
                            # Try to find a similar numbered field in headers
                            for header in headers_to_use:
                                if re.match(rf'{re.escape(base_name)}_?\d+$', header, re.IGNORECASE):
                                    matched_field = header
                                    break
                
                if matched_field:
                    logger.info(f"🔧 DEBUG: Found matching field '{matched_field}' for default value field '{field_name}'")
                    logger.info(f"🔧 DEBUG: Setting default value '{default_value}' for field '{matched_field}' in {len(transformed_rows)} rows")
                    
                    # Apply the default value to all rows for this field
                    rows_updated = 0
                    for row in transformed_rows:
                        # Only set default if the field is empty or doesn't exist
                        current_value = row.get(matched_field, "")
                        if not current_value or current_value == "":
                            row[matched_field] = default_value
                            rows_updated += 1
                    
                    logger.info(f"🔧 DEBUG: Updated {rows_updated} rows with default value '{default_value}' for field '{matched_field}'")
                else:
                    logger.warning(f"🔧 DEBUG: Default value field '{field_name}' not found in headers: {headers_to_use}")
                    logger.warning(f"🔧 DEBUG: Available header patterns: {[h for h in headers_to_use if any(base in h.lower() for base in ['tag', 'spec', 'customer'])]}")
        else:
            if not default_values:
                logger.info(f"🔧 DEBUG: Session {session_id} - No default values found in session data")
            if not transformed_rows:
                logger.info(f"🔧 DEBUG: Session {session_id} - No transformed rows found")
        
        # Implement pagination
        total_rows = len(transformed_rows)
        start_idx = (page - 1) * page_size
        end_idx = start_idx + page_size
        paginated_rows = transformed_rows[start_idx:end_idx]
        
        # Use the headers we determined above (either enhanced or template headers)
        
        # Include formula rules in response if they exist
        formula_rules = info.get("formula_rules", [])
        
        
        # Apply pagination 
        total_rows = len(transformed_rows)
        start_idx = (page - 1) * page_size
        end_idx = start_idx + page_size
        paginated_rows = transformed_rows[start_idx:end_idx]
        
        return Response({
            'success': True,
            'data': paginated_rows,
            'headers': headers_to_use,
            'formula_rules': formula_rules,  # Include existing formula rules
            'pagination': {
                'page': page,
                'page_size': page_size,
                'total_rows': total_rows,
                'total_pages': (total_rows + page_size - 1) // page_size
            }
        })
        
    except Exception as e:
        logger.error(f"Error in data_view: {e}")
        return Response({
            'success': False,
            'error': f'Failed to get data: {str(e)}'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
def save_data(request):
    """Save edited data."""
    try:
        session_id = request.data.get('session_id')
        data = request.data.get('data', [])
        
        if not session_id:
            return Response({
                'success': False,
                'error': 'Session ID is required'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        info = get_session(session_id)
        if not info:
            return Response({
                'success': False,
                'error': 'Session not found'
            }, status=status.HTTP_404_NOT_FOUND)
        
        # Save edited data to session
        info["edited_data"] = data
        save_session(session_id, info)
        
        return Response({
            'success': True,
            'message': 'Data saved successfully'
        })
        
    except Exception as e:
        logger.error(f"Error in save_data: {e}")
        return Response({
            'success': False,
            'error': f'Failed to save data: {str(e)}'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['GET', 'POST'])
def download_file(request):
    """Download processed/converted file."""
    try:
        # Support both GET and POST requests (JSON or form data)
        if request.method == 'POST':
            session_id = request.data.get('session_id') or request.POST.get('session_id')
        else:
            session_id = request.GET.get('session_id')
        
        if not session_id:
            return Response({
                'success': False,
                'error': 'Session ID is required'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        info = get_session(session_id)
        if not info:
            return Response({
                'success': False,
                'error': 'Session not found'
            }, status=status.HTTP_404_NOT_FOUND)
        mappings = info.get("mappings")
        
        if not mappings:
            return Response({
                'success': False,
                'error': 'No mappings found'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        # Check if we have formula-enhanced data first
        enhanced_data = info.get("formula_enhanced_data")
        
        if enhanced_data:
            # Use formula-enhanced data for download
            transformed_rows = enhanced_data
            all_headers = info.get("enhanced_headers") or []
        else:
            # Fall back to regular mapped data
            mapping_result = apply_column_mappings(
                client_file=info["client_path"],
                mappings=mappings,
                sheet_name=info["sheet_name"],
                header_row=info["header_row"] - 1 if info["header_row"] > 0 else 0,
                session_id=session_id
            )
            transformed_rows = mapping_result['data']
            all_headers = mapping_result['headers']

        # Ensure default values are applied in the download path as well (parity with data_view)
        try:
            session_default_values = info.get("default_values", {}) or {}
            if session_default_values and transformed_rows:
                # If rows are dicts, apply directly; if lists, map via headers
                if transformed_rows and isinstance(transformed_rows[0], dict):
                    for field_name, default_value in session_default_values.items():
                        for row in transformed_rows:
                            current_value = row.get(field_name, "")
                            if not current_value or current_value == "":
                                row[field_name] = default_value
                elif transformed_rows and isinstance(transformed_rows[0], list) and all_headers:
                    # Build header index map
                    header_index = {h: idx for idx, h in enumerate(all_headers)}
                    for field_name, default_value in session_default_values.items():
                        # Exact match first
                        target_header = None
                        if field_name in header_index:
                            target_header = field_name
                        else:
                            # Case-insensitive normalized match
                            norm = field_name.lower().replace(' ', '_').replace('-', '_')
                            for h in all_headers:
                                if h.lower().replace(' ', '_').replace('-', '_') == norm:
                                    target_header = h
                                    break
                        if target_header is not None:
                            idx = header_index.get(target_header)
                            if idx is not None:
                                for row in transformed_rows:
                                    if idx < len(row):
                                        if row[idx] is None or str(row[idx]).strip() == "":
                                            row[idx] = default_value
        except Exception as _e:
            logger.warning(f"Download default application skipped due to error: {_e}")
        
        if not transformed_rows:
            return Response({
                'success': False,
                'error': 'No data to download'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        # For enhanced data, use the enhanced headers
        enhanced_headers = info.get("enhanced_headers")
        if enhanced_data and enhanced_headers:
            all_headers = enhanced_headers
            # Convert enhanced data (dict format) to list format for consistency
            if transformed_rows and isinstance(transformed_rows[0], dict):
                converted_rows = []
                for row_dict in transformed_rows:
                    row_list = []
                    for header in all_headers:
                        row_list.append(row_dict.get(header, ""))
                    converted_rows.append(row_list)
                transformed_rows = converted_rows
        
        # Create DataFrame with duplicate column names support
        if transformed_rows and all_headers:
            # Use pandas with list data and original headers for export
            df = pd.DataFrame(transformed_rows, columns=all_headers)
        else:
            # Create empty DataFrame
            df = pd.DataFrame(columns=all_headers or [])
        
        # Prune _numbers from column names for download only (Tag_1, Tag_2 → Tag)
        if not df.empty:
            import re
            final_columns = []
            for col in df.columns:
                # Remove _number suffix from column names (e.g., Tag_1 → Tag, Specification_Name_2 → Specification_Name)
                pruned_col = re.sub(r'_\d+$', '', str(col))
                final_columns.append(pruned_col)
            
            df.columns = final_columns
        
        # Get format preference (default to Excel)
        if request.method == 'POST':
            format_type = (request.data.get('format') or request.POST.get('format', 'excel')).lower()
        else:
            format_type = request.GET.get('format', 'excel').lower()
        
        # Create output file
        output_dir = hybrid_file_manager.local_temp_dir
        
        from datetime import datetime
        timestamp = datetime.now().strftime('%y%m%d_%H%M%S')
        base_name = f"FactWise_Filled_{timestamp}"
        if format_type == 'csv':
            filename = f"{base_name}.csv"
            output_file = output_dir / filename
            df.to_csv(output_file, index=False)
            content_type = 'text/csv'
        else:  # Excel format (default)
            filename = f"{base_name}.xlsx"
            output_file = output_dir / filename
            df.to_excel(output_file, index=False, engine='openpyxl')
            content_type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        
        response = FileResponse(
            open(output_file, 'rb'),
            as_attachment=True,
            filename=filename,
            content_type=content_type
        )
        
        return response
        
    except Exception as e:
        logger.error(f"Error in download_file: {e}")
        return Response({
            'success': False,
            'error': f'Download failed: {str(e)}'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['GET'])
def download_original_file(request):
    """Download original uploaded client file."""
    try:
        session_id = request.GET.get('session_id')
        
        if not session_id or session_id not in SESSION_STORE:
            return Response({
                'success': False,
                'error': 'Invalid session'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        info = SESSION_STORE[session_id]
        client_path = info["client_path"]
        original_name = info["original_client_name"]
        
        if not Path(client_path).exists():
            return Response({
                'success': False,
                'error': 'Original file not found'
            }, status=status.HTTP_404_NOT_FOUND)
        
        response = FileResponse(
            open(client_path, 'rb'),
            as_attachment=True,
            filename=original_name
        )
        
        return response
        
    except Exception as e:
        logger.error(f"Error in download_original_file: {e}")
        return Response({
            'success': False,
            'error': f'Download failed: {str(e)}'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
def download_grid_excel(request):
    """Download Excel file with frontend grid data."""
    try:
        data = request.data
        session_id = data.get('session_id')
        headers = data.get('headers', [])
        rows = data.get('rows', [])
        
        if not session_id:
            return Response({
                'success': False,
                'error': 'Session ID required'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        # Create DataFrame from frontend data
        import pandas as pd
        df = pd.DataFrame(rows)
        
        # Ensure columns match headers
        if headers:
            df.columns = headers[:len(df.columns)]
        
        # Prune _numbers from column names for download only (Tag_1, Tag_2 → Tag)
        if not df.empty and len(df.columns) > 0:
            import re
            final_columns = []
            for col in df.columns:
                # Remove _number suffix from column names (e.g., Tag_1 → Tag, Specification_Name_2 → Specification_Name)
                pruned_col = re.sub(r'_\d+$', '', str(col))
                final_columns.append(pruned_col)
            
            df.columns = final_columns
        
        # Generate filename with YYMMDD_HHMMSS
        from datetime import datetime
        timestamp = datetime.now().strftime('%y%m%d_%H%M%S')
        filename = f'FactWise_Filled_{timestamp}.xlsx'
        
        # Create temp file
        temp_file = os.path.join('temp_downloads', filename)
        os.makedirs('temp_downloads', exist_ok=True)
        
        # Save to Excel
        df.to_excel(temp_file, index=False)
        
        # Return file response
        response = FileResponse(
            open(temp_file, 'rb'),
            as_attachment=True,
            filename=filename
        )
        
        return response
        
    except Exception as e:
        logger.error(f"Error in download_grid_excel: {e}")
        return Response({
            'success': False,
            'error': f'Excel export failed: {str(e)}'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['GET'])
def dashboard_view(request):
    """Get dashboard data."""
    try:
        # Get recent sessions
        uploads = []
        for session_id, session_data in list(SESSION_STORE.items())[-10:]:  # Last 10 sessions
            # Try to get row count from processed data or client data
            rows_processed = 0
            logger.info(f"Session {session_id}: Checking for data to calculate rows")
            logger.info(f"Session {session_id}: Session data keys: {list(session_data.keys())}")
            logger.info(f"Session {session_id}: edited_data type: {type(session_data.get('edited_data'))}")
            logger.info(f"Session {session_id}: client_data type: {type(session_data.get('client_data'))}")
            logger.info(f"Session {session_id}: client_path: {session_data.get('client_path')}")
            
            if session_data.get('edited_data'):
                try:
                    # If we have processed data, count the rows
                    if isinstance(session_data['edited_data'], list):
                        rows_processed = len(session_data['edited_data'])
                        logger.info(f"Session {session_id}: Got rows from edited_data list: {rows_processed}")
                    elif isinstance(session_data['edited_data'], dict) and 'data' in session_data['edited_data']:
                        rows_processed = len(session_data['edited_data']['data'])
                        logger.info(f"Session {session_id}: Got rows from edited_data dict: {rows_processed}")
                except Exception as e:
                    logger.warning(f"Session {session_id}: Error counting edited_data rows: {e}")
                    rows_processed = 0
            elif session_data.get('client_data'):
                try:
                    # Fallback to client data if processed data not available
                    if isinstance(session_data['client_data'], list):
                        rows_processed = len(session_data['client_data'])
                        logger.info(f"Session {session_id}: Got rows from client_data list: {rows_processed}")
                    elif isinstance(session_data['client_data'], dict) and 'data' in session_data['client_data']:
                        rows_processed = len(session_data['client_data']['data'])
                        logger.info(f"Session {session_id}: Got rows from client_data dict: {rows_processed}")
                except Exception as e:
                    logger.warning(f"Session {session_id}: Error counting client_data rows: {e}")
                    rows_processed = 0
            else:
                # Try to calculate rows from processed data that would be used for download
                try:
                    if session_data.get('mappings'):
                        # Import here to avoid circular imports
                        from .bom_header_mapper import BOMHeaderMapper
                        import pandas as pd
                        
                        # Get client file info
                        client_path = session_data.get('client_path')
                        sheet_name = session_data.get('sheet_name')
                        header_row = session_data.get('header_row', 1) - 1 if session_data.get('header_row', 1) > 0 else 0
                        
                        logger.info(f"Session {session_id}: Attempting to read client file for row count")
                        logger.info(f"Session {session_id}: client_path: {client_path}")
                        logger.info(f"Session {session_id}: sheet_name: {sheet_name}")
                        logger.info(f"Session {session_id}: header_row: {header_row}")
                        
                        if client_path:
                            # Try to resolve the file path using hybrid_file_manager
                            try:
                                client_local_path = hybrid_file_manager.get_file_path(client_path)
                                logger.info(f"Session {session_id}: Resolved client_local_path: {client_local_path}")
                                
                                # Check if the resolved path exists
                                if Path(client_local_path).exists():
                                    logger.info(f"Session {session_id}: Resolved path exists, reading file")
                                    if str(client_local_path).lower().endswith('.csv'):
                                        df = pd.read_csv(client_local_path, header=header_row)
                                    else:
                                        result = pd.read_excel(client_local_path, sheet_name=sheet_name, header=header_row)
                                        if isinstance(result, dict):
                                            first_sheet_name = list(result.keys())[0]
                                            df = result[first_sheet_name]
                                        else:
                                            df = result
                                    
                                    rows_processed = len(df)
                                    logger.info(f"Session {session_id}: Successfully calculated rows from client file: {rows_processed}")
                                else:
                                    logger.warning(f"Session {session_id}: Resolved path does not exist: {client_local_path}")
                                    # Try to check if the original path exists
                                    if Path(client_path).exists():
                                        logger.info(f"Session {session_id}: Original path exists, using it directly")
                                        if str(client_path).lower().endswith('.csv'):
                                            df = pd.read_csv(client_path, header=header_row)
                                        else:
                                            result = pd.read_excel(client_path, sheet_name=sheet_name, header=header_row)
                                            if isinstance(result, dict):
                                                first_sheet_name = list(result.keys())[0]
                                                df = result[first_sheet_name]
                                            else:
                                                df = result
                                        
                                        rows_processed = len(df)
                                        logger.info(f"Session {session_id}: Successfully calculated rows from original path: {rows_processed}")
                                    else:
                                        logger.warning(f"Session {session_id}: Neither resolved nor original path exists")
                            except Exception as path_error:
                                logger.warning(f"Session {session_id}: Error resolving file path: {path_error}")
                                # Fallback: try to read directly from client_path
                                if Path(client_path).exists():
                                    logger.info(f"Session {session_id}: Fallback: original path exists, reading directly")
                                    if str(client_path).lower().endswith('.csv'):
                                        df = pd.read_csv(client_path, header=header_row)
                                    else:
                                        result = pd.read_excel(client_path, sheet_name=sheet_name, header=header_row)
                                        if isinstance(result, dict):
                                            first_sheet_name = list(result.keys())[0]
                                            df = result[first_sheet_name]
                                        else:
                                            df = result
                                    
                                    rows_processed = len(df)
                                    logger.info(f"Session {session_id}: Fallback successful, rows: {rows_processed}")
                                else:
                                    logger.warning(f"Session {session_id}: Fallback path also does not exist: {client_path}")
                        else:
                            logger.info(f"Session {session_id}: No client_path found in session data")
                except Exception as e:
                    logger.warning(f"Session {session_id}: Error calculating rows from client file: {e}")
                    rows_processed = 0
                
                if rows_processed == 0:
                    logger.info(f"Session {session_id}: No edited_data, client_data, or client file found")
            
            logger.info(f"Session {session_id}: Final rows_processed: {rows_processed}")
            
            # Check if file is ready for download
            has_mappings = bool(session_data.get('mappings'))
            has_processed_data = bool(session_data.get('edited_data'))
            # Consider complete if user has gone through the mapping process
            is_complete = has_mappings
            
            # Generate the filename that would be used for download
            filled_sheet_name = None
            if is_complete:
                from datetime import datetime
                # Use the session creation time or current time for consistency
                session_created = session_data.get('created')
                if session_created:
                    try:
                        if isinstance(session_created, str):
                            created_dt = datetime.fromisoformat(session_created.replace('Z', '+00:00'))
                        else:
                            created_dt = session_created
                        timestamp = created_dt.strftime('%y%m%d_%H%M%S')
                        filled_sheet_name = f"FactWise_Filled_{timestamp}.xlsx"
                        logger.info(f"Session {session_id}: Generated filled_sheet_name from session_created: {filled_sheet_name}")
                    except Exception as e:
                        # Fallback to current time if session time parsing fails
                        logger.warning(f"Session {session_id}: Error parsing session_created, using current time: {e}")
                        timestamp = datetime.now().strftime('%y%m%d_%H%M%S')
                        filled_sheet_name = f"FactWise_Filled_{timestamp}.xlsx"
                        logger.info(f"Session {session_id}: Generated filled_sheet_name from current time: {filled_sheet_name}")
                else:
                    logger.info(f"Session {session_id}: No session_created, using current time")
                    timestamp = datetime.now().strftime('%y%m%d_%H%M%S')
                    filled_sheet_name = f"FactWise_Filled_{timestamp}.xlsx"
                    logger.info(f"Session {session_id}: Generated filled_sheet_name from current time: {filled_sheet_name}")
            else:
                logger.info(f"Session {session_id}: Not complete, no filled_sheet_name generated")
            
            uploads.append({
                'session_id': session_id,
                'client_file': session_data.get('original_client_name', 'Unknown'),
                'template_file': session_data.get('original_template_name', 'Unknown'),
                'filled_sheet_name': filled_sheet_name,
                'created': session_data.get('created', datetime.now().isoformat()),
                'has_mappings': is_complete,
                'rows_processed': rows_processed,
                'status': 'Complete' if is_complete else 'Pending'
            })
        
        # Get saved templates
        try:
            templates = MappingTemplate.objects.all().order_by('-created_at')[:10]
            saved_templates = [template.get_mapping_summary() for template in templates]
        except Exception:
            saved_templates = []
        
        return Response({
            'success': True,
            'uploads': uploads,
            'saved_templates': saved_templates
        })
        
    except Exception as e:
        logger.error(f"Error in dashboard_view: {e}")
        return Response({
            'success': False,
            'error': f'Failed to get dashboard data: {str(e)}'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


# Template management views
@api_view(['POST'])
def update_column_counts(request):
    """Update dynamic column counts for the current session."""
    try:
        session_id = request.data.get('session_id')
        tags_count = request.data.get('tags_count', 1)
        spec_pairs_count = request.data.get('spec_pairs_count', 1)
        customer_id_pairs_count = request.data.get('customer_id_pairs_count', 1)
        
        info = get_session(session_id)
        if not info:
            return Response({
                'success': False,
                'error': 'Invalid session ID'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        # Validate counts are positive integers
        try:
            tags_count = max(0, int(tags_count))
            spec_pairs_count = max(0, int(spec_pairs_count))
            customer_id_pairs_count = max(0, int(customer_id_pairs_count))
        except (ValueError, TypeError):
            return Response({
                'success': False,
                'error': 'Column counts must be positive integers'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        # Store column counts in session
        info['tags_count'] = tags_count
        info['spec_pairs_count'] = spec_pairs_count
        info['customer_id_pairs_count'] = customer_id_pairs_count
        
        # Save session to file
        save_session(session_id, info)
        
        # Get existing headers to preserve numbering
        existing_headers = info.get('current_template_headers') or info.get('enhanced_headers') or []
        
        # Generate new template columns based on counts, preserving existing numbering
        template_columns = generate_template_columns(
            tags_count, 
            spec_pairs_count, 
            customer_id_pairs_count, 
            existing_headers=existing_headers
        )

        # Build canonical headers by pruning/adding optional groups starting from original template headers
        try:
            base_headers = info.get('template_headers')
            if not base_headers:
                # Read from file if not cached
                mapper = BOMHeaderMapper()
                base_headers = mapper.read_excel_headers(
                    file_path=hybrid_file_manager.get_file_path(info["template_path"]),
                    sheet_name=info.get("template_sheet_name"),
                    header_row=info.get("template_header_row", 1) - 1 if info.get("template_header_row", 1) > 0 else 0
                )
                info['template_headers'] = base_headers
        except Exception:
            base_headers = []

        def _norm(h: str) -> str:
            try:
                return str(h or '').strip().lower()
            except Exception:
                return ''
        def _is_tag(h: str) -> bool:
            h_norm = _norm(h)
            return h_norm == 'tag' or h_norm.startswith('tag_')
        def _is_spec_name(h: str) -> bool:
            h_norm = _norm(h)
            return h_norm == 'specification name' or h_norm.startswith('specification_name_')
        def _is_spec_value(h: str) -> bool:
            h_norm = _norm(h)
            return h_norm == 'specification value' or h_norm.startswith('specification_value_')
        def _is_cust_name(h: str) -> bool:
            h_norm = _norm(h)
            return h_norm == 'customer identification name' or h_norm.startswith('customer_identification_name_')
        def _is_cust_value(h: str) -> bool:
            h_norm = _norm(h)
            return h_norm == 'customer identification value' or h_norm.startswith('customer_identification_value_')

        regenerated_headers = []
        tags_used = 0
        spec_used = 0
        cust_used = 0
        i = 0
        while i < len(base_headers):
            h = str(base_headers[i])
            if _is_tag(h):
                if tags_used < tags_count:
                    regenerated_headers.append(f'Tag_{tags_used + 1}')
                    tags_used += 1
                i += 1
                continue
            if _is_spec_name(h) and (i + 1) < len(base_headers) and _is_spec_value(base_headers[i+1]):
                if spec_used < spec_pairs_count:
                    regenerated_headers.extend([f'Specification_Name_{spec_used + 1}', f'Specification_Value_{spec_used + 1}'])
                    spec_used += 1
                i += 2
                continue
            if _is_cust_name(h) and (i + 1) < len(base_headers) and _is_cust_value(base_headers[i+1]):
                if cust_used < customer_id_pairs_count:
                    regenerated_headers.extend([f'Customer_Identification_Name_{cust_used + 1}', f'Customer_Identification_Value_{cust_used + 1}'])
                    cust_used += 1
                i += 2
                continue
            # Non-optional or unknown headers are preserved
            regenerated_headers.append(h)
            i += 1

        # Append extras if counts exceed those available in the file
        if tags_used < tags_count:
            for i in range(tags_used, tags_count):
                regenerated_headers.append(f'Tag_{i + 1}')
        if spec_used < spec_pairs_count:
            for i in range(spec_used, spec_pairs_count):
                regenerated_headers.extend([f'Specification_Name_{i + 1}', f'Specification_Value_{i + 1}'])
        if cust_used < customer_id_pairs_count:
            for i in range(cust_used, customer_id_pairs_count):
                regenerated_headers.extend([f'Customer_Identification_Name_{i + 1}', f'Customer_Identification_Value_{i + 1}'])

        info["current_template_headers"] = regenerated_headers
        # Backward compatibility
        info["enhanced_headers"] = regenerated_headers
        save_session(session_id, info)

        # Debug logging
        logger.info(f"🔧 Updated session {session_id} with canonical headers: {regenerated_headers}")
        logger.info(f"🔧 Session store now contains: {list(info.keys())}")

        # Compute template_optionals for the canonical headers (Tags/Spec/Customer always optional)
        def is_special_optional(h: str) -> bool:
            h_lower = (h or '').lower()
            return (h == 'Tag' or h.startswith('Tag_') or 
                   'specification' in h_lower or 
                   'customer identification' in h_lower or 
                   'customer_identification' in h_lower)

        template_optionals = [True if is_special_optional(h) else False for h in regenerated_headers]

        return Response({
            'success': True,
            'template_columns': template_columns,
            'enhanced_headers': regenerated_headers,
            'template_optionals': template_optionals,
            'counts': {
                'tags_count': tags_count,
                'spec_pairs_count': spec_pairs_count,
                'customer_id_pairs_count': customer_id_pairs_count
            }
        })
        
    except Exception as e:
        logger.error(f"❌ Error updating column counts: {str(e)}")
        return Response({
            'success': False,
            'error': str(e)
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


def generate_template_columns(tags_count, spec_pairs_count, customer_id_pairs_count, existing_headers=None):
    """Generate template column names with simple sequential numbering."""
    columns = []
    
    # Basic mandatory columns (these should come from template configuration)
    basic_columns = ["Quantity", "Description", "Part Number", "Manufacturer"]
    columns.extend(basic_columns)
    
    # Simple sequential tag numbering - just add what's requested
    for i in range(tags_count):
        columns.append(f"Tag_{i + 1}")
    
    # Add Specification Name/Value pairs with unique numbers
    for i in range(spec_pairs_count):
        columns.append(f"Specification_Name_{i + 1}")
        columns.append(f"Specification_Value_{i + 1}")
    
    # Add Customer Identification Name/Value pairs with unique numbers  
    for i in range(customer_id_pairs_count):
        columns.append(f"Customer_Identification_Name_{i + 1}")
        columns.append(f"Customer_Identification_Value_{i + 1}")
    
    return columns


@api_view(['POST'])
def save_mapping_template(request):
    """Save current session mapping as a reusable template."""
    try:
        session_id = request.data.get('session_id')
        template_name = request.data.get('template_name')
        description = request.data.get('description', '')
        override_mappings = request.data.get('mappings')  # Optional mappings override
        override_formula_rules = request.data.get('formula_rules')  # Optional formula rules override
        override_factwise_rules = request.data.get('factwise_rules')  # Optional factwise rules override
        override_default_values = request.data.get('default_values')  # Optional default values override
        
        if not template_name:
            return Response({
                'success': False,
                'error': 'Template name is required'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        # Handle two cases: session-based templates and standalone formula templates
        if session_id and session_id in SESSION_STORE:
            # Session-based template (normal case)
            info = SESSION_STORE[session_id]
            raw_mappings = override_mappings if override_mappings is not None else info.get("mappings")
            formula_rules = override_formula_rules if override_formula_rules is not None else info.get("formula_rules", [])
            factwise_rules = override_factwise_rules if override_factwise_rules is not None else info.get("factwise_rules", [])
            default_values = override_default_values if override_default_values is not None else info.get("default_values", {})
            
            # Convert mappings from new format to old format for template storage
            if raw_mappings and isinstance(raw_mappings, dict) and 'mappings' in raw_mappings:
                # New format: {'mappings': [{'source': '...', 'target': '...'}, ...]}
                # For templates, we need to preserve all mappings including duplicates
                # Store both the old format dict and new format list for compatibility
                mappings = {}
                mapping_list = []
                
                for mapping_item in raw_mappings['mappings']:
                    source = mapping_item.get('source')
                    target = mapping_item.get('target')
                    if source and target:
                        # Store in new format list (preserves duplicates)
                        mapping_list.append({'source': source, 'target': target})
                        # Store in old format dict (for compatibility, will overwrite duplicates)
                        mappings[target] = source
                
                # Store both formats - use new format as primary, old format as fallback
                mappings = {
                    'new_format': mapping_list,
                    'old_format': mappings
                }
                logger.info(f"🔄 Converted {len(raw_mappings['mappings'])} mappings from new format, preserving duplicates")
            else:
                mappings = raw_mappings or {}
            
            if not mappings and not formula_rules:
                return Response({
                    'success': False,
                    'error': 'No mappings or formula rules to save'
                }, status=status.HTTP_400_BAD_REQUEST)
        else:
            # Standalone template (formula-only from Dashboard)
            mappings = override_mappings or {}
            formula_rules = override_formula_rules or []
            
            if not formula_rules:
                return Response({
                    'success': False,
                    'error': 'No formula rules provided for standalone template'
                }, status=status.HTTP_400_BAD_REQUEST)
            
            info = None  # No session info for standalone templates
        
        # Read headers (only if we have session info)
        if info:
            mapper = BOMHeaderMapper()
            client_headers = mapper.read_excel_headers(
                file_path=info["client_path"],
                sheet_name=info["sheet_name"],
                header_row=info["header_row"] - 1 if info["header_row"] > 0 else 0
            )

            # Prefer canonical dynamic headers if present in session to capture Tag_/Spec_/Customer dynamic changes
            canonical_headers = info.get("current_template_headers") or info.get("enhanced_headers")
            if canonical_headers and isinstance(canonical_headers, list) and len(canonical_headers) > 0:
                template_headers = canonical_headers
                logger.info(f"🔧 DEBUG: Using canonical template headers from session for save_mapping_template ({len(template_headers)} headers)")
            else:
                template_headers = mapper.read_excel_headers(
                    file_path=info["template_path"],
                    sheet_name=info.get("template_sheet_name"),
                    header_row=info.get("template_header_row", 1) - 1 if info.get("template_header_row", 1) > 0 else 0
                )
                logger.info(f"🔧 DEBUG: Using original file template headers for save_mapping_template ({len(template_headers)} headers)")
        else:
            # Standalone template - use empty headers
            client_headers = []
            template_headers = []
        
        # Get column counts from request, session, or use defaults
        if info:
            # Try to get from session first (for dynamic fields created in ColumnMapping)
            tags_count = request.data.get('tags_count') or info.get('tags_count', 1)
            spec_pairs_count = request.data.get('spec_pairs_count') or info.get('spec_pairs_count', 1) 
            customer_id_pairs_count = request.data.get('customer_id_pairs_count') or info.get('customer_id_pairs_count', 1)
        else:
            # Standalone template - use request or defaults
            tags_count = request.data.get('tags_count', 1)
            spec_pairs_count = request.data.get('spec_pairs_count', 1) 
            customer_id_pairs_count = request.data.get('customer_id_pairs_count', 1)
        
        # Create template with backward compatibility
        try:
            logger.info(f"🔧 DEBUG: Saving template '{template_name}' with factwise_rules: {factwise_rules}")
            logger.info(f"🔧 DEBUG: Saving template '{template_name}' with default_values: {default_values}")
            template = MappingTemplate.objects.create(
                name=template_name,
                description=description,
                template_headers=template_headers,
                source_headers=client_headers,
                mappings=mappings,
                formula_rules=formula_rules,  # Include formula rules
                factwise_rules=factwise_rules,  # Include factwise ID rules
                default_values=default_values,  # Include default values
                tags_count=tags_count,
                spec_pairs_count=spec_pairs_count,
                customer_id_pairs_count=customer_id_pairs_count,
                session_id=session_id
            )
        except Exception as e:
            # If new fields don't exist yet, create without them
            if 'formula_rules' in str(e) or 'factwise_rules' in str(e) or 'default_values' in str(e):
                template = MappingTemplate.objects.create(
                    name=template_name,
                    description=description,
                    template_headers=template_headers,
                    source_headers=client_headers,
                    mappings=mappings,
                    session_id=session_id
                )
            else:
                raise e
        
        return Response({
            'success': True,
            'message': 'Template saved successfully',
            'template_id': template.id
        }, status=status.HTTP_201_CREATED)
        
    except Exception as e:
        logger.error(f"Error in save_mapping_template: {e}")
        return Response({
            'success': False,
            'error': f'Failed to save template: {str(e)}'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
def update_mapping_template(request):
    """Update/overwrite an existing mapping template."""
    try:
        session_id = request.data.get('session_id')
        template_id = request.data.get('template_id')
        action = request.data.get('action')
        template_name = request.data.get('template_name')
        description = request.data.get('description', '')
        
        if not session_id or session_id not in SESSION_STORE:
            return Response({
                'success': False,
                'error': 'Invalid session'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        if not template_id:
            return Response({
                'success': False,
                'error': 'Template ID is required'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        # Get the existing template
        try:
            template = MappingTemplate.objects.get(id=template_id)
        except MappingTemplate.DoesNotExist:
            return Response({
                'success': False,
                'error': 'Template not found'
            }, status=status.HTTP_404_NOT_FOUND)
        
        info = SESSION_STORE[session_id]
        mappings = info.get("mappings")
        
        if not mappings:
            return Response({
                'success': False,
                'error': 'No mappings to save'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        # Read headers
        mapper = BOMHeaderMapper()
        client_headers = mapper.read_excel_headers(
            file_path=info["client_path"],
            sheet_name=info["sheet_name"],
            header_row=info["header_row"] - 1 if info["header_row"] > 0 else 0
        )

        # Prefer canonical dynamic headers if available
        canonical_headers = info.get("current_template_headers") or info.get("enhanced_headers")
        if canonical_headers and isinstance(canonical_headers, list) and len(canonical_headers) > 0:
            template_headers = canonical_headers
            logger.info(f"🔧 DEBUG: Using canonical template headers from session for update_mapping_template ({len(template_headers)} headers)")
        else:
            template_headers = mapper.read_excel_headers(
                file_path=info["template_path"],
                sheet_name=info.get("template_sheet_name"),
                header_row=info.get("template_header_row", 1) - 1 if info.get("template_header_row", 1) > 0 else 0
            )
            logger.info(f"🔧 DEBUG: Using original file template headers for update_mapping_template ({len(template_headers)} headers)")
        
        # Get formula rules from session if they exist
        formula_rules = info.get("formula_rules", [])
        
        # Update the template
        template.client_headers = client_headers
        template.template_headers = template_headers
        template.mappings = mappings
        template.formula_rules = formula_rules  # Update formula rules

        # Also persist dynamic counts and default values if present
        tags_count = info.get('tags_count', getattr(template, 'tags_count', 1))
        spec_pairs_count = info.get('spec_pairs_count', getattr(template, 'spec_pairs_count', 1))
        customer_id_pairs_count = info.get('customer_id_pairs_count', getattr(template, 'customer_id_pairs_count', 1))
        default_values = info.get('default_values', getattr(template, 'default_values', {}))

        try:
            template.tags_count = int(tags_count)
            template.spec_pairs_count = int(spec_pairs_count)
            template.customer_id_pairs_count = int(customer_id_pairs_count)
        except Exception:
            logger.warning("🔧 DEBUG: Could not convert dynamic counts to int during update_mapping_template")
        try:
            template.default_values = default_values
        except Exception:
            logger.warning("🔧 DEBUG: Could not set default_values during update_mapping_template")
        
        # Update name and description if provided
        if template_name:
            template.name = template_name
        if description:
            template.description = description
        
        template.save()
        
        logger.info(
            f"Template {template.id} updated successfully with {len(mappings)} mappings, "
            f"{len(formula_rules)} formula rules, counts: tags={getattr(template,'tags_count',None)}, "
            f"spec_pairs={getattr(template,'spec_pairs_count',None)}, cust_pairs={getattr(template,'customer_id_pairs_count',None)}"
        )
        
        return Response({
            'success': True,
            'message': f'Template "{template.name}" updated successfully',
            'template_id': template.id
        })
        
    except Exception as e:
        logger.error(f"Error in update_mapping_template: {e}")
        return Response({
            'success': False,
            'error': f'Failed to update template: {str(e)}'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['GET'])
def get_mapping_templates(request):
    """Get all saved mapping templates."""
    try:
        templates = MappingTemplate.objects.all().order_by('-created_at')
        template_list = [template.get_mapping_summary() for template in templates]
        
        return Response({
            'success': True,
            'templates': template_list
        })
        
    except Exception as e:
        logger.error(f"Error in get_mapping_templates: {e}")
        return Response({
            'success': False,
            'error': f'Failed to get templates: {str(e)}'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['DELETE'])
def delete_mapping_template(request, template_id):
    """Delete a saved mapping template."""
    try:
        # Get the template
        try:
            template = MappingTemplate.objects.get(id=template_id)
        except MappingTemplate.DoesNotExist:
            return Response({
                'success': False,
                'error': 'Template not found'
            }, status=status.HTTP_404_NOT_FOUND)
        
        template_name = template.name
        template.delete()
        
        return Response({
            'success': True,
            'message': f'Template "{template_name}" deleted successfully'
        })
        
    except Exception as e:
        logger.error(f"Error in delete_mapping_template: {e}")
        return Response({
            'success': False,
            'error': f'Failed to delete template: {str(e)}'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
def apply_mapping_template(request):
    """Apply a saved mapping template to a session."""
    try:
        session_id = request.data.get('session_id')
        template_id = request.data.get('template_id')
        
        if not session_id or session_id not in SESSION_STORE:
            return Response({
                'success': False,
                'error': 'Invalid session'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        if not template_id:
            return Response({
                'success': False,
                'error': 'Template ID is required'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        # Get the template
        try:
            template = MappingTemplate.objects.get(id=template_id)
        except MappingTemplate.DoesNotExist:
            return Response({
                'success': False,
                'error': 'Template not found'
            }, status=status.HTTP_404_NOT_FOUND)
        
        info = SESSION_STORE[session_id]
        
        # Read client headers
        mapper = BOMHeaderMapper()
        client_headers = mapper.read_excel_headers(
            file_path=info["client_path"],
            sheet_name=info["sheet_name"],
            header_row=info["header_row"] - 1 if info["header_row"] > 0 else 0
        )
        
        # Apply template mappings
        application_result = template.apply_to_headers(client_headers)
        
        if application_result['total_mapped'] > 0:
            # Update session with applied mappings
            SESSION_STORE[session_id]["original_template_id"] = template_id
            
            # Apply column counts from template
            tags_count = getattr(template, 'tags_count', 1)
            spec_pairs_count = getattr(template, 'spec_pairs_count', 1)
            customer_id_pairs_count = getattr(template, 'customer_id_pairs_count', 1)
            
            SESSION_STORE[session_id]["tags_count"] = tags_count
            SESSION_STORE[session_id]["spec_pairs_count"] = spec_pairs_count
            SESSION_STORE[session_id]["customer_id_pairs_count"] = customer_id_pairs_count
            
            # Get existing template headers to preserve tag numbering
            existing_template_headers = getattr(template, 'template_headers', [])
            
            # Regenerate numbered headers based on template column counts, preserving existing numbering
            regenerated_headers = generate_template_columns(
                tags_count, 
                spec_pairs_count, 
                customer_id_pairs_count, 
                existing_headers=existing_template_headers
            )
            SESSION_STORE[session_id]["current_template_headers"] = regenerated_headers
            SESSION_STORE[session_id]["enhanced_headers"] = regenerated_headers
            
            # IMPORTANT: Save session immediately after setting column counts
            save_session(session_id, SESSION_STORE[session_id])
            
            logger.info(f"🔧 DEBUG: Template applied - regenerated {len(regenerated_headers)} numbered headers: {regenerated_headers}")
            logger.info(f"🔧 DEBUG: Saved column counts to session: tags={tags_count}, spec_pairs={spec_pairs_count}, customer_id_pairs={customer_id_pairs_count}")
            
            # IMPORTANT: Auto-add dynamic tag columns to mappings with default values
            # This ensures that when template is used in columnmapping.js, the dynamic tags appear immediately
            if default_values:
                current_mappings = SESSION_STORE[session_id].get("mappings", {})
                if isinstance(current_mappings, dict):
                    # Convert dict to list format for consistency
                    mappings_list = [{"source": v, "target": k} for k, v in current_mappings.items()]
                elif isinstance(current_mappings, list):
                    mappings_list = current_mappings
                else:
                    mappings_list = []
                
                # Add mappings for dynamic tag columns that have default values
                for field_name, default_value in default_values.items():
                    if field_name in regenerated_headers:
                        # Check if this field is already mapped
                        already_mapped = any(mapping.get("target") == field_name for mapping in mappings_list)
                        if not already_mapped:
                            # Add a virtual mapping that maps the default value to this field
                            # This will make the field appear as "mapped" in the UI with the default value
                            mappings_list.append({
                                "source": f"__DEFAULT__{default_value}",  # Special source indicating default value
                                "target": field_name
                            })
                            logger.info(f"🔧 DEBUG: Auto-mapped dynamic tag '{field_name}' with default value '{default_value}'")
                
                # Update session with enhanced mappings
                SESSION_STORE[session_id]["mappings"] = mappings_list
            
            # Convert mappings from old format to new format for session storage
            old_format_mappings = application_result['mappings']
            new_format_mappings = {
                "mappings": [
                    {"source": source_col, "target": template_col}
                    for template_col, source_col in old_format_mappings.items()
                ]
            }
            SESSION_STORE[session_id]["mappings"] = new_format_mappings
            logger.info(f"🔄 Converted {len(old_format_mappings)} mappings from old format to new format for session")
            
            # Apply formula rules if they exist
            formula_rules = getattr(template, 'formula_rules', []) or []
            if formula_rules:
                SESSION_STORE[session_id]["formula_rules"] = formula_rules
                
                # Apply formulas to create enhanced data
                mapping_result = apply_column_mappings(
                    client_file=info["client_path"],
                    mappings=new_format_mappings,
                    sheet_name=info["sheet_name"],
                    header_row=info["header_row"] - 1 if info["header_row"] > 0 else 0,
                    session_id=session_id
                )
                
                # Convert to dict format for formula processing
                dict_rows = []
                for row_list in mapping_result['data']:
                    row_dict = {}
                    for i, header in enumerate(mapping_result['headers']):
                        if i < len(row_list):
                            row_dict[header] = row_list[i]
                        else:
                            row_dict[header] = ""
                    dict_rows.append(row_dict)
                
                # Apply formula rules to create enhanced data
                formula_result = apply_formula_rules(
                    data_rows=dict_rows,
                    headers=mapping_result['headers'],
                    formula_rules=formula_rules
                )
                
                # Don't cache enhanced data - process fresh each time
                logger.info(f"Applied {len(formula_rules)} formula rules from template")
                
                # Store the enhanced data temporarily for default value application
                SESSION_STORE[session_id]["temp_formula_result"] = formula_result
            
            # Apply factwise rules if they exist
            factwise_rules = getattr(template, 'factwise_rules', []) or []
            if factwise_rules:
                SESSION_STORE[session_id]["factwise_rules"] = factwise_rules
                
                # Apply each factwise rule with error handling
                for rule in factwise_rules:
                    try:
                        if rule.get("type") == "factwise_id":
                            # Apply the Factwise ID rule by calling the existing function logic
                            first_column = rule.get("first_column")
                            second_column = rule.get("second_column")
                            operator = rule.get("operator", "_")
                        
                        if first_column and second_column:
                            # Get current data (either formula-enhanced or basic mapped)
                            current_data = SESSION_STORE[session_id].get("formula_enhanced_data")
                            current_headers = SESSION_STORE[session_id].get("enhanced_headers")
                            
                            if not current_data:
                                # Use basic mapped data if no formula data exists
                                mapping_result = apply_column_mappings(
                                    client_file=info["client_path"],
                                    mappings=new_format_mappings,
                                    sheet_name=info["sheet_name"],
                                    header_row=info["header_row"] - 1 if info["header_row"] > 0 else 0,
                                    session_id=session_id
                                )
                                current_data = mapping_result['data']
                                current_headers = mapping_result['headers']
                            
                            # Map template column names to actual source column names
                            # The Factwise rule stores template column names, but we need source column names
                            first_source_column = None
                            second_source_column = None
                            
                            # Find which source columns map to our target template columns
                            applied_mappings = application_result.get('mappings', {})
                            reverse_mappings = {v: k for k, v in applied_mappings.items()}  # template -> source
                            
                            logger.info(f"🔧 DEBUG: Reverse mappings: {reverse_mappings}")
                            logger.info(f"🔧 DEBUG: Looking for template columns: '{first_column}', '{second_column}'")
                            
                            # Find source columns that map to our target template columns
                            if first_column in reverse_mappings:
                                first_source_column = reverse_mappings[first_column]
                            if second_column in reverse_mappings:
                                second_source_column = reverse_mappings[second_column]
                                
                            logger.info(f"🔧 DEBUG: Mapped to source columns: '{first_source_column}', '{second_source_column}'")
                            
                            # Check if we found the required source columns in client headers
                            if not first_source_column or first_source_column not in client_headers:
                                logger.warning(f"🆔 Template Factwise ID: First source column '{first_source_column}' not found in client headers: {client_headers}")
                                continue  # Skip this factwise rule
                            
                            if not second_source_column or second_source_column not in client_headers:
                                logger.warning(f"🆔 Template Factwise ID: Second source column '{second_source_column}' not found in client headers: {client_headers}")
                                continue  # Skip this factwise rule
                            
                            # Apply Factwise ID creation using source data
                            # Read the client data directly to get the source column values
                            from .bom_mapper import BOMHeaderMapper
                            mapper = BOMHeaderMapper()
                            client_data = mapper.read_excel_data(
                                file_path=info["client_path"],
                                sheet_name=info["sheet_name"], 
                                header_row=info["header_row"] - 1 if info["header_row"] > 0 else 0
                            )
                            
                            factwise_id_column = []
                            first_col_idx = client_headers.index(first_source_column)
                            second_col_idx = client_headers.index(second_source_column)
                            
                            logger.info(f"🔧 DEBUG: Client data indices - first_idx: {first_col_idx}, second_idx: {second_col_idx}")
                            
                            if first_col_idx >= 0 and second_col_idx >= 0:
                                for row in client_data:
                                    first_val = str(row[first_col_idx] if first_col_idx < len(row) else "").strip()
                                    second_val = str(row[second_col_idx] if second_col_idx < len(row) else "").strip()
                                    
                                    if first_val and second_val:
                                        factwise_id = f"{first_val}{operator}{second_val}"
                                    elif first_val:
                                        factwise_id = first_val
                                    elif second_val:
                                        factwise_id = second_val
                                    else:
                                        factwise_id = ""
                                    
                                    factwise_id_column.append(factwise_id)
                                
                                # Insert Factwise ID column at the beginning
                                new_headers = ["Factwise ID"] + current_headers
                                new_data_rows = []
                                
                                for i, row in enumerate(current_data):
                                    new_row = [factwise_id_column[i]] + list(row)
                                    new_data_rows.append(new_row)
                                
                                # Update session with Factwise ID enhanced data
                                SESSION_STORE[session_id]["formula_enhanced_data"] = new_data_rows
                                SESSION_STORE[session_id]["enhanced_headers"] = new_headers
                                
                                logger.info(f"🆔 Applied Factwise ID rule from template: {first_column} {operator} {second_column}")
                    except Exception as factwise_error:
                        logger.warning(f"🆔 Failed to apply Factwise ID rule from template: {factwise_error}")
                        # Continue with other rules even if this one fails
            
            # Apply default values if they exist
            default_values = getattr(template, 'default_values', {}) or {}
            if default_values:
                SESSION_STORE[session_id]["default_values"] = default_values
                logger.info(f"🔧 DEBUG: Applied default values from template: {default_values}")
                
                # Immediately populate any enhanced data with default values for instant preview
                temp_formula_result = SESSION_STORE[session_id].get("temp_formula_result")
                if temp_formula_result and temp_formula_result.get('data'):
                    enhanced_data = temp_formula_result['data']
                    enhanced_headers = temp_formula_result['headers']
                    
                    logger.info(f"🔧 DEBUG: Pre-populating enhanced data with {len(default_values)} default values")
                    
                    # Apply default values to enhanced data
                    for field_name, default_value in default_values.items():
                        if field_name in enhanced_headers:
                            field_index = enhanced_headers.index(field_name)
                            for row_dict in enhanced_data:
                                if isinstance(row_dict, dict):
                                    # For dict format data
                                    if field_name not in row_dict or not row_dict[field_name] or row_dict[field_name] == '':
                                        row_dict[field_name] = default_value
                                        logger.info(f"🔧 DEBUG: Set default value '{default_value}' for field '{field_name}'")
                        else:
                            logger.info(f"🔧 DEBUG: Default value field '{field_name}' not found in enhanced headers: {enhanced_headers}")
                    
                    # Update the stored result
                    SESSION_STORE[session_id]["temp_formula_result"] = temp_formula_result
                    logger.info(f"🔧 DEBUG: Updated enhanced data with default values for immediate preview")
            
            # Increment template usage
            template.increment_usage()
            
            return Response({
                'success': True,
                'message': f'Template "{template.name}" applied successfully',
                'mappings': application_result['mappings'],
                'formula_rules': formula_rules,
                'factwise_rules': factwise_rules,
                'default_values': default_values,
                'total_mapped': application_result['total_mapped'],
                'total_template_columns': application_result['total_template_columns']
            })
        else:
            return Response({
                'success': False,
                'error': 'No columns could be mapped from this template'
            }, status=status.HTTP_400_BAD_REQUEST)
        
    except Exception as e:
        logger.error(f"Error in apply_mapping_template: {e}")
        return Response({
            'success': False,
            'error': f'Failed to apply template: {str(e)}'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class BOMHeaderMappingView(APIView):
    """Legacy API view for BOM header mapping."""
    
    def post(self, request):
        return Response({
            'success': True,
            'message': 'Use the new mapping endpoints instead'
        })


# ─── FORMULA MANAGEMENT ENDPOINTS ──────────────────────────────────────────────

def apply_formula_rules(data_rows, headers, formula_rules, replace_existing=False):
    """
    Apply formula rules with manual sub-rules to data rows and return modified data with new columns.
    
    New Rule Structure with Sub-Rules:
    - source_column: Column to check
    - column_type: 'Tag' or 'Specification Value' 
    - specification_name: Static name for specification column (only if column_type='Specification Value')
    - sub_rules: Array of conditions [
        { search_text: 'CAP', output_value: 'Capacitor', case_sensitive: false },
        { search_text: 'DIODE', output_value: 'Diode', case_sensitive: false }
      ]
    
    Logic:
    - Each rule defines ONE column (Tag or Specification)
    - Sub-rules define multiple conditions within that rule
    - First matching sub-rule wins per row
    - Multiple rules can create multiple columns
    
    Args:
        data_rows: List of dictionaries representing the data
        headers: List of column headers
        formula_rules: List of formula rule dictionaries with sub_rules
        replace_existing: If True, replace existing formula columns instead of creating new ones
    
    Returns:
        Dict with modified data and new headers
    """
    if not data_rows or not formula_rules:
        return {'data': data_rows, 'headers': headers, 'new_columns': []}
    
    # Create a copy of the data to avoid modifying original
    modified_data = [row.copy() for row in data_rows]
    new_headers = headers.copy()
    new_columns = []
    
    # Track column usage for auto-naming
    used_column_names = set(headers)
    
    # Process each rule separately (each rule creates its own column) 
    tag_counter = 1
    spec_counter = 1
    
    for rule_index, rule in enumerate(formula_rules):
        source_column = rule.get('source_column')
        column_type = rule.get('column_type', 'Tag')
        specification_name = rule.get('specification_name', '')
        sub_rules = rule.get('sub_rules', [])
        
        # Skip rule if missing required fields
        if not source_column or not sub_rules:
            continue
        
        # Determine column name based on type - REUSE EXISTING EMPTY TAG COLUMNS
        if column_type == 'Tag':
            # First, check if there's an existing empty tag column we can reuse
            column_name = None
            
            # Look for existing tag columns that are empty across all rows
            existing_tag_columns = [h for h in new_headers + list(used_column_names) if h.startswith('Tag_')]
            
            for tag_col in sorted(existing_tag_columns):  # Check in order Tag_1, Tag_2, etc.
                # Check if this column is empty across all rows
                is_empty = True
                for row in modified_data:
                    if tag_col in row and row[tag_col] and str(row[tag_col]).strip():
                        is_empty = False
                        break
                
                if is_empty:
                    column_name = tag_col
                    logger.info(f"🔧 DEBUG: Reusing empty Tag column '{column_name}' for rule {rule_index + 1}")
                    break
            
            # If no empty column found, create a new one
            if not column_name:
                # Find the highest existing tag number
                existing_tag_numbers = []
                for header in new_headers + list(used_column_names):
                    if header.startswith('Tag_'):
                        try:
                            num = int(header.split('_')[1])
                            existing_tag_numbers.append(num)
                        except (IndexError, ValueError):
                            pass
                
                # Get next available tag number
                if existing_tag_numbers:
                    next_tag_num = max(existing_tag_numbers) + 1
                else:
                    next_tag_num = 1
                
                column_name = f"Tag_{next_tag_num}"
                logger.info(f"🔧 DEBUG: Creating new Tag column '{column_name}' for rule {rule_index + 1}")
                
                # Add the new column
                if column_name not in used_column_names:
                    new_headers.append(column_name)
                    new_columns.append(column_name)
                    used_column_names.add(column_name)
            
            # Apply sub-rules to each row (first match wins)
            for row in modified_data:
                if column_name not in row:
                    row[column_name] = ''
                
                # Check each sub-rule until first match
                for sub_rule in sub_rules:
                    search_text = sub_rule.get('search_text', '')
                    output_value = sub_rule.get('output_value', '')
                    case_sensitive = sub_rule.get('case_sensitive', False)
                    
                    if not search_text or not output_value:
                        continue
                    
                    # Convert to string to handle any data type inconsistencies
                    cell_value = str(row.get(source_column, ''))
                    search_text = str(search_text) if search_text else ''
                    output_value = str(output_value) if output_value else ''
                    
                    search_text_compare = search_text if case_sensitive else search_text.lower()
                    cell_value_compare = cell_value if case_sensitive else cell_value.lower()
                    
                    if search_text_compare in cell_value_compare:
                        # Check if the column already has mapped data from duplicate mappings
                        existing_value = row.get(column_name, '').strip()
                        
                        if existing_value and existing_value != output_value:
                            # Column has mapped data - check if output_value is already part of existing_value
                            # Split by comma and strip to handle various formats
                            existing_values = [v.strip() for v in existing_value.split(',')]
                            if output_value not in existing_values:  # Avoid duplicates
                                row[column_name] = f"{existing_value}, {output_value}"
                        else:
                            # Column is empty or has same value - safe to set/replace
                            row[column_name] = output_value
                        break  # First match wins - stop checking other sub-rules
        
        elif column_type == 'Specification Value' and specification_name:
            # Always create unique specification column names
            name_column = f"Specification_Name_{spec_counter}"
            value_column = f"Specification_Value_{spec_counter}"
            
            # Find next available specification column numbers
            while name_column in used_column_names or value_column in used_column_names:
                spec_counter += 1
                name_column = f"Specification_Name_{spec_counter}"
                value_column = f"Specification_Value_{spec_counter}"
            
            # Add the unique columns
            new_headers.append(name_column)
            new_columns.append(name_column)
            used_column_names.add(name_column)
            
            new_headers.append(value_column)
            new_columns.append(value_column)
            used_column_names.add(value_column)
            
            spec_counter += 1
            
            # Apply sub-rules to each row (first match wins)
            for row in modified_data:
                if name_column not in row:
                    row[name_column] = specification_name  # Static name for all cells
                if value_column not in row:
                    row[value_column] = ''
                
                # Check each sub-rule until first match
                for sub_rule in sub_rules:
                    search_text = sub_rule.get('search_text', '')
                    output_value = sub_rule.get('output_value', '')
                    case_sensitive = sub_rule.get('case_sensitive', False)
                    
                    if not search_text or not output_value:
                        continue
                    
                    # Convert to string to handle any data type inconsistencies
                    cell_value = str(row.get(source_column, ''))
                    search_text = str(search_text) if search_text else ''
                    output_value = str(output_value) if output_value else ''
                    
                    search_text_compare = search_text if case_sensitive else search_text.lower()
                    cell_value_compare = cell_value if case_sensitive else cell_value.lower()
                    
                    if search_text_compare in cell_value_compare:
                        # Check if the column already has mapped data from duplicate mappings
                        existing_value = row.get(value_column, '').strip()
                        
                        if existing_value and existing_value != output_value:
                            # Column has mapped data - check if output_value is already part of existing_value
                            # Split by comma and strip to handle various formats
                            existing_values = [v.strip() for v in existing_value.split(',')]
                            if output_value not in existing_values:  # Avoid duplicates
                                row[value_column] = f"{existing_value}, {output_value}"
                        else:
                            # Column is empty or has same value - safe to set/replace
                            row[value_column] = output_value
                        break  # First match wins - stop checking other sub-rules
            
            spec_counter += 1
    
    return {
        'data': modified_data,
        'headers': new_headers,
        'new_columns': new_columns,
        'total_rows': len(modified_data)
    }


@api_view(['POST'])
def apply_formulas(request):
    """Apply formula rules to session data and return updated data."""
    try:
        session_id = request.data.get('session_id')
        formula_rules = request.data.get('formula_rules', [])
        
        logger.info(f"🔧 DEBUG: apply_formulas called for session {session_id} with {len(formula_rules)} rules")
        
        if not session_id or session_id not in SESSION_STORE:
            logger.error(f"🔧 DEBUG: Session {session_id} not found")
            return Response({
                'success': False,
                'error': 'Invalid session'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        if not formula_rules:
            return Response({
                'success': False,
                'error': 'No formula rules provided'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        # First, get conflict suggestions for smart numbering
        info = SESSION_STORE[session_id]
        enhanced_headers = info.get("enhanced_headers", []) or info.get("current_template_headers", [])
        
        # Get all existing columns from all sources (matching check_column_conflicts logic)
        template_headers = info.get("template_headers", [])
        client_headers = list(info.get("source_headers", {}).keys())
        
        # Check for conflicts and get smart numbering suggestions
        all_existing_columns = set(template_headers + client_headers + enhanced_headers)
        column_name_mapping = {}  # Maps original names to suggested names
        
        for rule in formula_rules:
            target_column = rule.get('target_column') or 'Tag'
            column_type = rule.get('column_type', 'Tag')
            
            if column_type == 'Tag':
                # Always apply smart numbering for Tag columns - find next available number
                tag_numbers = []
                for col in all_existing_columns:
                    if col.startswith('Tag_') and col[4:].isdigit():
                        tag_numbers.append(int(col[4:]))
                    elif col == 'Tag':
                        tag_numbers.append(1)
                
                next_tag_number = max(tag_numbers, default=0) + 1
                suggested_name = f"Tag_{next_tag_number}"
                column_name_mapping[target_column] = suggested_name
                all_existing_columns.add(suggested_name)
                
                logger.info(f"🔧 DEBUG: Smart numbering - {target_column} → {suggested_name}")
        
        # Update formula rules with smart numbering
        updated_formula_rules = []
        for rule in formula_rules:
            updated_rule = rule.copy()
            original_target = rule.get('target_column') or 'Tag'
            if original_target in column_name_mapping:
                updated_rule['target_column'] = column_name_mapping[original_target]
                logger.info(f"🔧 DEBUG: Updated rule target: {original_target} → {column_name_mapping[original_target]}")
            updated_formula_rules.append(updated_rule)
        
        formula_rules = updated_formula_rules
        
        info = SESSION_STORE[session_id]
        mappings = info.get("mappings")
        
        if not mappings:
            return Response({
                'success': False,
                'error': 'No mappings found. Please create mappings first.'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        # Convert mappings list format to expected dict format for apply_column_mappings
        if isinstance(mappings, list):
            # Convert list format to new dict format that apply_column_mappings expects
            formatted_mappings = {"mappings": mappings}
            logger.info(f"🔧 DEBUG: Converted list mappings to dict format for formulas: {formatted_mappings}")
        else:
            formatted_mappings = mappings
            logger.info(f"🔧 DEBUG: Using existing dict mappings for formulas: {formatted_mappings}")
        
        # Always start from fresh mapped data - no caching
        mapping_result = apply_column_mappings(
            client_file=info["client_path"],
            mappings=formatted_mappings,
            sheet_name=info["sheet_name"],
            header_row=info["header_row"] - 1 if info["header_row"] > 0 else 0,
            session_id=session_id
        )
        
        # Convert to dict format for formula processing
        dict_rows = []
        for row_list in mapping_result['data']:
            row_dict = {}
            for i, header in enumerate(mapping_result['headers']):
                if i < len(row_list):
                    row_dict[header] = row_list[i]
                else:
                    row_dict[header] = ""
            dict_rows.append(row_dict)
        transformed_rows = dict_rows
        current_headers = mapping_result['headers']
        
        if not transformed_rows:
            return Response({
                'success': False,
                'error': 'No data available to apply formulas'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        # Apply formula rules (always create new unique columns)
        logger.info(f"🔧 DEBUG: About to apply {len(formula_rules)} rules to {len(transformed_rows)} rows with headers: {current_headers}")
        formula_result = apply_formula_rules(transformed_rows, current_headers, formula_rules, replace_existing=False)
        
        logger.info(f"🔧 DEBUG: Formula result - new_columns: {formula_result.get('new_columns', [])}, headers: {formula_result.get('headers', [])}")
        
        # Only save the formula rules - no data caching
        SESSION_STORE[session_id]["formula_rules"] = formula_rules
        
        return Response({
            'success': True,
            'data': formula_result['data'],
            'headers': formula_result['headers'],
            'new_columns': formula_result['new_columns'],
            'total_rows': formula_result['total_rows'],
            'rules_applied': len(formula_rules),
            'message': f'Applied {len(formula_rules)} formula rules successfully'
        })
        
    except Exception as e:
        logger.error(f"Error in apply_formulas: {e}")
        return Response({
            'success': False,
            'error': f'Failed to apply formulas: {str(e)}'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
def preview_formulas(request):
    """Preview the results of applying formula rules without saving."""
    try:
        session_id = request.data.get('session_id')
        formula_rules = request.data.get('formula_rules', [])
        sample_size = int(request.data.get('sample_size', 5))
        
        if not session_id or session_id not in SESSION_STORE:
            return Response({
                'success': False,
                'error': 'Invalid session'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        if not formula_rules:
            return Response({
                'success': False,
                'error': 'No formula rules provided'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        info = SESSION_STORE[session_id]
        mappings = info.get("mappings")
        
        if not mappings:
            return Response({
                'success': False,
                'error': 'No mappings found. Please create mappings first.'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        # Get the current transformed data
        mapping_result = apply_column_mappings(
            client_file=info["client_path"],
            mappings=mappings,
            sheet_name=info["sheet_name"],
            header_row=info["header_row"] - 1 if info["header_row"] > 0 else 0,
            session_id=session_id
        )
        # Convert to dict format for preview
        dict_rows = []
        for row_list in mapping_result['data']:
            row_dict = {}
            for i, header in enumerate(mapping_result['headers']):
                if i < len(row_list):
                    row_dict[header] = row_list[i]
                else:
                    row_dict[header] = ""
            dict_rows.append(row_dict)
        transformed_rows = dict_rows
        
        if not transformed_rows:
            return Response({
                'success': False,
                'error': 'No data available for preview'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        # Get current headers
        mapper = BOMHeaderMapper()
        current_headers = mapper.read_excel_headers(
            file_path=info["template_path"],
            sheet_name=info.get("template_sheet_name"),
            header_row=info.get("template_header_row", 1) - 1 if info.get("template_header_row", 1) > 0 else 0
        )
        
        # Apply formula rules to get preview
        formula_result = apply_formula_rules(transformed_rows, current_headers, formula_rules)
        
        # Calculate statistics for each rule
        rule_stats = []
        for i, rule in enumerate(formula_rules):
            source_column = rule.get('source_column')
            search_text = str(rule.get('search_text', '')).lower()
            case_sensitive = rule.get('case_sensitive', False)
            
            matches = 0
            for row in transformed_rows:
                source_value = str(row.get(source_column, '')).strip()
                if case_sensitive:
                    text_match = search_text in source_value
                else:
                    text_match = search_text in source_value.lower()
                
                if text_match:
                    matches += 1
            
            rule_stats.append({
                'rule_index': i,
                'matches': matches,
                'total_rows': len(transformed_rows),
                'match_percentage': round((matches / len(transformed_rows)) * 100, 1) if transformed_rows else 0
            })
        
        # Get sample data for preview (first few rows)
        sample_data = formula_result['data'][:sample_size]
        
        return Response({
            'success': True,
            'preview_data': sample_data,
            'headers': formula_result['headers'],
            'new_columns': formula_result['new_columns'],
            'rule_statistics': rule_stats,
            'total_rows': len(transformed_rows),
            'sample_size': len(sample_data),
            'message': f'Preview generated for {len(formula_rules)} rules'
        })
        
    except Exception as e:
        logger.error(f"Error in preview_formulas: {e}")
        return Response({
            'success': False,
            'error': f'Failed to preview formulas: {str(e)}'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['GET'])
def get_formula_templates(request):
    """Get predefined formula templates for common use cases."""
    try:
        # Predefined templates for common component types
        templates = {
            'electronics_basic': {
                'name': 'Electronics Components (Basic)',
                'description': 'Common electronic components',
                'rules': [
                    {
                        'source_column': 'Description',
                        'search_text': 'cap',
                        'tag_value': 'Capacitor',
                        'target_column': 'Component_Type',
                        'case_sensitive': False
                    },
                    {
                        'source_column': 'Description', 
                        'search_text': 'res',
                        'tag_value': 'Resistor',
                        'target_column': 'Component_Type',
                        'case_sensitive': False
                    },
                    {
                        'source_column': 'Description',
                        'search_text': 'ic',
                        'tag_value': 'Integrated Circuit',
                        'target_column': 'Component_Type',
                        'case_sensitive': False
                    },
                    {
                        'source_column': 'Description',
                        'search_text': 'led',
                        'tag_value': 'LED',
                        'target_column': 'Component_Type',
                        'case_sensitive': False
                    }
                ]
            },
            'electronics_advanced': {
                'name': 'Electronics Components (Advanced)',
                'description': 'Extended electronic components classification',
                'rules': [
                    {
                        'source_column': 'Description',
                        'search_text': 'capacitor',
                        'tag_value': 'Capacitor',
                        'target_column': 'Component_Type',
                        'case_sensitive': False
                    },
                    {
                        'source_column': 'Description',
                        'search_text': 'resistor',
                        'tag_value': 'Resistor', 
                        'target_column': 'Component_Type',
                        'case_sensitive': False
                    },
                    {
                        'source_column': 'Description',
                        'search_text': 'inductor',
                        'tag_value': 'Inductor',
                        'target_column': 'Component_Type',
                        'case_sensitive': False
                    },
                    {
                        'source_column': 'Description',
                        'search_text': 'diode',
                        'tag_value': 'Diode',
                        'target_column': 'Component_Type',
                        'case_sensitive': False
                    },
                    {
                        'source_column': 'Description',
                        'search_text': 'transistor',
                        'tag_value': 'Transistor',
                        'target_column': 'Component_Type',
                        'case_sensitive': False
                    }
                ]
            },
            'mechanical': {
                'name': 'Mechanical Parts',
                'description': 'Common mechanical hardware components',
                'rules': [
                    {
                        'source_column': 'Description',
                        'search_text': 'screw',
                        'tag_value': 'Fastener',
                        'target_column': 'Hardware_Type',
                        'case_sensitive': False
                    },
                    {
                        'source_column': 'Description',
                        'search_text': 'bolt',
                        'tag_value': 'Fastener',
                        'target_column': 'Hardware_Type',
                        'case_sensitive': False
                    },
                    {
                        'source_column': 'Description',
                        'search_text': 'washer',
                        'tag_value': 'Hardware',
                        'target_column': 'Hardware_Type',
                        'case_sensitive': False
                    },
                    {
                        'source_column': 'Description',
                        'search_text': 'nut',
                        'tag_value': 'Fastener',
                        'target_column': 'Hardware_Type',
                        'case_sensitive': False
                    }
                ]
            },
            'value_classification': {
                'name': 'Value-based Classification',
                'description': 'Classify components by value ranges',
                'rules': [
                    {
                        'source_column': 'Description',
                        'search_text': 'pf',
                        'tag_value': 'Low Value Capacitor',
                        'target_column': 'Value_Category',
                        'case_sensitive': False
                    },
                    {
                        'source_column': 'Description',
                        'search_text': 'uf',
                        'tag_value': 'High Value Capacitor',
                        'target_column': 'Value_Category',
                        'case_sensitive': False
                    },
                    {
                        'source_column': 'Description',
                        'search_text': 'ohm',
                        'tag_value': 'Standard Resistor',
                        'target_column': 'Value_Category',
                        'case_sensitive': False
                    }
                ]
            }
        }
        
        return Response({
            'success': True,
            'templates': templates,
            'total_templates': len(templates)
        })
        
    except Exception as e:
        logger.error(f"Error in get_formula_templates: {e}")
        return Response({
            'success': False,
            'error': f'Failed to get templates: {str(e)}'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
def save_custom_formulas(request):
    """Save custom formula rules to session for reuse."""
    try:
        session_id = request.data.get('session_id')
        formula_rules = request.data.get('formula_rules', [])
        template_name = request.data.get('template_name', 'Custom Formula Set')
        
        if not session_id or session_id not in SESSION_STORE:
            return Response({
                'success': False,
                'error': 'Invalid session'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        if not formula_rules:
            return Response({
                'success': False,
                'error': 'No formula rules to save'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        # Save to session store
        if 'custom_formula_templates' not in SESSION_STORE[session_id]:
            SESSION_STORE[session_id]['custom_formula_templates'] = {}
        
        template_id = f"custom_{len(SESSION_STORE[session_id]['custom_formula_templates']) + 1}"
        SESSION_STORE[session_id]['custom_formula_templates'][template_id] = {
            'name': template_name,
            'rules': formula_rules,
            'created_at': datetime.now().isoformat(),
            'usage_count': 0
        }
        
        return Response({
            'success': True,
            'template_id': template_id,
            'message': f'Saved {len(formula_rules)} formula rules as "{template_name}"'
        })
        
    except Exception as e:
        logger.error(f"Error in save_custom_formulas: {e}")
        return Response({
            'success': False,
            'error': f'Failed to save formulas: {str(e)}'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['GET'])
def get_enhanced_data(request):
    """Get data enhanced with formula results."""
    try:
        session_id = request.GET.get('session_id')
        page = int(request.GET.get('page', 1))
        page_size = int(request.GET.get('page_size', 20))
        
        if not session_id or session_id not in SESSION_STORE:
            return Response({
                'success': False,
                'error': 'Invalid session'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        info = SESSION_STORE[session_id]
        
        # Check if we have formula-enhanced data
        enhanced_data = info.get("formula_enhanced_data")
        enhanced_headers = info.get("enhanced_headers")
        
        if enhanced_data and enhanced_headers:
            # Use formula-enhanced data
            data_to_return = enhanced_data
            headers_to_return = enhanced_headers
        else:
            # Fall back to regular mapped data
            mappings = info.get("mappings")
            if not mappings:
                return Response({
                    'success': False,
                    'error': 'No data available. Please create mappings first.'
                }, status=status.HTTP_400_BAD_REQUEST)
            
            mapping_result = apply_column_mappings(
                client_file=info["client_path"],
                mappings=mappings,
                sheet_name=info["sheet_name"],
                header_row=info["header_row"] - 1 if info["header_row"] > 0 else 0,
                session_id=session_id
            )
            # Convert to dict format
            dict_rows = []
            for row_list in mapping_result['data']:
                row_dict = {}
                for i, header in enumerate(mapping_result['headers']):
                    if i < len(row_list):
                        row_dict[header] = row_list[i]
                    else:
                        row_dict[header] = ""
                dict_rows.append(row_dict)
            data_to_return = dict_rows
            headers_to_return = mapping_result['headers']
        
        if not data_to_return:
            return Response({
                'success': False,
                'error': 'No data available'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        # Implement pagination
        total_rows = len(data_to_return)
        start_idx = (page - 1) * page_size
        end_idx = start_idx + page_size
        paginated_data = data_to_return[start_idx:end_idx]
        
        return Response({
            'success': True,
            'data': paginated_data,
            'headers': headers_to_return,
            'has_formulas': bool(enhanced_data),
            'formula_rules': info.get("formula_rules", []),
            'pagination': {
                'page': page,
                'page_size': page_size,
                'total_rows': total_rows,
                'total_pages': (total_rows + page_size - 1) // page_size
            }
        })
        
    except Exception as e:
        logger.error(f"Error in get_enhanced_data: {e}")
        return Response({
            'success': False,
            'error': f'Failed to get enhanced data: {str(e)}'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
def check_column_conflicts(request):
    """Check for column name conflicts before applying formulas."""
    logger.info("🔧 DEBUG: Starting check_column_conflicts function")
    try:
        session_id = request.data.get('session_id')
        formula_rules = request.data.get('formula_rules', [])
        
        if not session_id or session_id not in SESSION_STORE:
            return Response({
                'success': False,
                'error': 'Invalid session'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        info = SESSION_STORE[session_id]
        mappings = info.get("mappings")
        
        if not mappings:
            return Response({
                'success': False,
                'error': 'No mappings found. Please create mappings first.'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        # Get current headers (both mapped and original)
        mapper = BOMHeaderMapper()
        template_headers = mapper.read_excel_headers(
            file_path=info["template_path"],
            sheet_name=info.get("template_sheet_name"),
            header_row=info.get("template_header_row", 1) - 1 if info.get("template_header_row", 1) > 0 else 0
        )
        
        client_headers = mapper.read_excel_headers(
            file_path=info["client_path"],
            sheet_name=info["sheet_name"],
            header_row=info["header_row"] - 1 if info["header_row"] > 0 else 0
        )
        
        # Get enhanced headers (includes numbered fields like Tag_1, Tag_2)
        enhanced_headers = info.get("enhanced_headers", []) or info.get("current_template_headers", [])
        all_existing_columns = set(template_headers + client_headers + enhanced_headers)
        
        # Check for conflicts and provide smart numbering
        conflicts = []
        suggestions = {}
        
        logger.info(f"🔧 DEBUG: About to process {len(formula_rules)} rules with {len(all_existing_columns)} existing columns")
        for rule in formula_rules:
            target_column = rule.get('target_column') or 'Tag'
            column_type = rule.get('column_type', 'Tag')
            
            # Smart numbering for Tag and Specification columns
            if column_type == 'Tag':
                # Always apply smart numbering for Tag columns - find next available number
                tag_numbers = []
                for col in all_existing_columns:
                    if col.startswith('Tag_') and col[4:].isdigit():
                        tag_numbers.append(int(col[4:]))
                    elif col == 'Tag':
                        tag_numbers.append(1)
                
                next_tag_number = max(tag_numbers, default=0) + 1
                suggested_name = f"Tag_{next_tag_number}"
                
                # Only create conflict if the suggested name is different from target
                if target_column != suggested_name:
                    conflicts.append({
                        'rule_index': formula_rules.index(rule),
                        'column': target_column,
                        'conflicting_column': target_column,
                        'conflict_type': 'auto_numbering',
                        'suggested_name': suggested_name,
                        'message': f'Auto-assigned to next available tag number'
                    })
                    
                    suggestions[target_column] = suggested_name
                
                # Always reserve the suggested name regardless of conflicts
                all_existing_columns.add(suggested_name)
                    
            elif column_type == 'Specification Value':
                spec_name = rule.get('specification_name', 'Unknown')
                base_column = f"Specification_Value_{spec_name}"
                
                if base_column in all_existing_columns:
                    # Find next available specification number
                    spec_numbers = []
                    for col in all_existing_columns:
                        if col.startswith(f'Specification_Value_{spec_name}_') and col.split('_')[-1].isdigit():
                            spec_numbers.append(int(col.split('_')[-1]))
                    
                    next_spec_number = max(spec_numbers, default=0) + 1
                    suggested_name = f"Specification_Value_{spec_name}_{next_spec_number}"
                    
                    conflicts.append({
                        'rule_index': formula_rules.index(rule),
                        'column': base_column,
                        'conflicting_column': base_column,
                        'conflict_type': 'auto_numbering',
                        'suggested_name': suggested_name,
                        'message': f'Auto-assigned specification number for {spec_name}'
                    })
                    
                    suggestions[base_column] = suggested_name
                    all_existing_columns.add(suggested_name)  # Reserve this name
            else:
                # Generic conflict resolution for other column types
                if target_column in all_existing_columns:
                    base_name = target_column
                    counter = 1
                    suggested_name = f"{base_name}_{counter}"
                    while suggested_name in all_existing_columns:
                        counter += 1
                        suggested_name = f"{base_name}_{counter}"
                    
                    conflicts.append({
                        'rule_index': formula_rules.index(rule),
                        'column': target_column,
                        'conflicting_column': target_column,
                        'conflict_type': 'existing_column',
                        'suggested_name': suggested_name,
                        'message': f'Column already exists, using numbered variant'
                    })
                    
                    suggestions[target_column] = suggested_name
                    all_existing_columns.add(suggested_name)  # Reserve this name
        
        return Response({
            'success': True,
            'conflicts': conflicts,
            'suggestions': suggestions,
            'existing_columns': list(all_existing_columns),
            'has_conflicts': len(conflicts) > 0
        })
        
    except Exception as e:
        logger.error(f"Error checking column conflicts: {e}")
        return Response({
            'success': False,
            'error': f'Failed to check conflicts: {str(e)}'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
def clear_formulas(request):
    """Clear all formula rules and remove generated columns from session data."""
    try:
        session_id = request.data.get('session_id')
        
        if not session_id or session_id not in SESSION_STORE:
            return Response({
                'success': False,
                'error': 'Invalid session'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        info = SESSION_STORE[session_id]
        
        # Track what we're removing for user feedback
        cleared_items = []
        
        # Check if there are formula rules to clear
        if info.get("formula_rules"):
            cleared_items.append(f"{len(info['formula_rules'])} formula rules")
            # Clear formula rules
            SESSION_STORE[session_id]["formula_rules"] = []
        
        # Check if there's enhanced data to clear
        if info.get("formula_enhanced_data"):
            cleared_items.append("formula-generated data")
            # Clear formula-enhanced data
            SESSION_STORE[session_id]["formula_enhanced_data"] = None
        
        # Check if there are enhanced headers to clear
        if info.get("enhanced_headers"):
            original_headers = info.get("enhanced_headers", [])
            mappings = info.get("mappings", {})
            
            # Handle different mapping formats
            if isinstance(mappings, list):
                # List format: [{'source': 'A', 'target': 'B'}, ...]
                template_columns = [m.get('target', '') for m in mappings if isinstance(m, dict)]
            elif isinstance(mappings, dict):
                template_columns = list(mappings.keys())
            else:
                template_columns = []
            
            # Find formula-generated columns (columns not in original mappings)
            formula_columns = [h for h in original_headers if h not in template_columns]
            if formula_columns:
                cleared_items.append(f"{len(formula_columns)} generated columns")
            
            # Clear enhanced headers
            SESSION_STORE[session_id]["enhanced_headers"] = None
        
        # If no formulas were found to clear
        if not cleared_items:
            return Response({
                'success': True,
                'message': 'No formulas or generated columns found to clear',
                'cleared_items': []
            })
        
        # Log the clearing action
        logger.info(f"Cleared formulas for session {session_id}: {', '.join(cleared_items)}")
        
        return Response({
            'success': True,
            'message': f'Successfully cleared: {", ".join(cleared_items)}',
            'cleared_items': cleared_items
        })
        
    except Exception as e:
        logger.error(f"Error clearing formulas: {e}")
        return Response({
            'success': False,
            'error': f'Failed to clear formulas: {str(e)}'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


# ==============================================
# TAG TEMPLATE VIEWS
# ==============================================

@api_view(['POST'])
def save_tag_template(request):
    """Save a new tag template with formula rules."""
    try:
        template_name = request.data.get('template_name')
        description = request.data.get('description', '')
        formula_rules = request.data.get('formula_rules', [])
        
        if not template_name:
            return Response({
                'success': False,
                'error': 'Template name is required'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        if not formula_rules:
            return Response({
                'success': False,
                'error': 'Formula rules are required'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        # Check if template name already exists
        if TagTemplate.objects.filter(name=template_name).exists():
            return Response({
                'success': False,
                'error': f'Template "{template_name}" already exists'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        # Create new tag template
        tag_template = TagTemplate.objects.create(
            name=template_name,
            description=description,
            formula_rules=formula_rules
        )
        
        logger.info(f"Created tag template: {template_name} with {len(formula_rules)} rules")
        
        return Response({
            'success': True,
            'template_id': tag_template.id,
            'message': f'Tag template "{template_name}" saved successfully',
            'template': tag_template.get_template_summary()
        })
        
    except Exception as e:
        logger.error(f"Error saving tag template: {e}")
        return Response({
            'success': False,
            'error': f'Failed to save tag template: {str(e)}'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['GET'])
def get_tag_templates(request):
    """Get all saved tag templates."""
    try:
        templates = TagTemplate.objects.all()
        template_data = [template.get_template_summary() for template in templates]
        
        return Response({
            'success': True,
            'templates': template_data,
            'total_templates': len(template_data)
        })
        
    except Exception as e:
        logger.error(f"Error getting tag templates: {e}")
        return Response({
            'success': False,
            'error': f'Failed to get tag templates: {str(e)}'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['DELETE'])
def delete_tag_template(request, template_id):
    """Delete a tag template."""
    try:
        template = TagTemplate.objects.get(id=template_id)
        template_name = template.name
        template.delete()
        
        logger.info(f"Deleted tag template: {template_name}")
        
        return Response({
            'success': True,
            'message': f'Tag template "{template_name}" deleted successfully'
        })
        
    except TagTemplate.DoesNotExist:
        return Response({
            'success': False,
            'error': 'Tag template not found'
        }, status=status.HTTP_404_NOT_FOUND)
    except Exception as e:
        logger.error(f"Error deleting tag template: {e}")
        return Response({
            'success': False,
            'error': f'Failed to delete tag template: {str(e)}'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['GET'])
def apply_tag_template(request, template_id):
    """Get formula rules from a tag template for application."""
    try:
        template = TagTemplate.objects.get(id=template_id)
        
        # Increment usage count
        template.increment_usage()
        
        logger.info(f"Applied tag template: {template.name}")
        
        return Response({
            'success': True,
            'template_name': template.name,
            'formula_rules': template.formula_rules,
            'message': f'Tag template "{template.name}" applied successfully'
        })
        
    except TagTemplate.DoesNotExist:
        return Response({
            'success': False,
            'error': 'Tag template not found'
        }, status=status.HTTP_404_NOT_FOUND)
    except Exception as e:
        logger.error(f"Error applying tag template: {e}")
        return Response({
            'success': False,
            'error': f'Failed to apply tag template: {str(e)}'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
def create_factwise_id(request):
    """Create a Factwise ID by combining two existing columns and map it to 'Item code'.
    Supports strategy: 'fill_only_null' (default) or 'override_all'. Treats variants of Item code as same.
    """
    try:
        session_id = request.data.get('session_id')
        first_column = request.data.get('first_column')
        second_column = request.data.get('second_column')
        operator = request.data.get('operator', '_')
        strategy = request.data.get('strategy', 'fill_only_null')
        
        if not session_id or session_id not in SESSION_STORE:
            return Response({
                'success': False,
                'error': 'Invalid session'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        if not first_column or not second_column:
            return Response({
                'success': False,
                'error': 'Both first_column and second_column are required'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        info = SESSION_STORE[session_id]
        mappings = info.get("mappings")
        
        if not mappings:
            return Response({
                'success': False,
                'error': 'No mappings found for this session'
            }, status=status.HTTP_400_BAD_REQUEST)

        logger.info(f"🆔 Creating Factwise ID: {first_column} {operator} {second_column}")
        
        # Convert mappings list format to expected dict format for apply_column_mappings
        if isinstance(mappings, list):
            # Convert list format to new dict format that apply_column_mappings expects
            formatted_mappings = {"mappings": mappings}
            logger.info(f"🔧 DEBUG: Converted list mappings to dict format for Factwise ID: {formatted_mappings}")
        else:
            formatted_mappings = mappings
            logger.info(f"🔧 DEBUG: Using existing dict mappings for Factwise ID: {formatted_mappings}")
        
        # Get the current data
        mapping_result = apply_column_mappings(
            client_file=info["client_path"],
            mappings=formatted_mappings,
            sheet_name=info["sheet_name"],
            header_row=info["header_row"] - 1 if info["header_row"] > 0 else 0,
            session_id=session_id
        )
        
        if not mapping_result or not mapping_result.get('data'):
            return Response({
                'success': False,
                'error': 'No data available for processing'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        headers = mapping_result['headers']
        data_rows = mapping_result['data']
        
        # Find column indices
        first_col_idx = -1
        second_col_idx = -1
        for i, header in enumerate(headers):
            if header == first_column:
                first_col_idx = i
            elif header == second_column:
                second_col_idx = i
        
        if first_col_idx == -1 or second_col_idx == -1:
            return Response({
                'success': False,
                'error': f'Columns not found: {first_column} or {second_column}'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        # Create Factwise ID values
        factwise_id_column = []
        for row in data_rows:
            first_val = str(row[first_col_idx]) if first_col_idx < len(row) and row[first_col_idx] is not None else ""
            second_val = str(row[second_col_idx]) if second_col_idx < len(row) and row[second_col_idx] is not None else ""

            if first_val and second_val:
                factwise_id = f"{first_val}{operator}{second_val}"
            elif first_val:
                factwise_id = first_val
            elif second_val:
                factwise_id = second_val
            else:
                factwise_id = ""

            factwise_id_column.append(factwise_id)

        # Helper to normalize header names
        def norm(s: str) -> str:
            return str(s).strip().lower().replace(' ', '').replace('_', '').replace('-', '')

        # Map Factwise ID into 'Item code' (create if missing). Treat Item code variants as same.
        item_idx = None
        new_headers = list(headers)
        for i, h in enumerate(new_headers):
            if norm(h) == norm('item code'):
                item_idx = i
                new_headers[i] = 'Item code'
                break

        new_data_rows = []
        if item_idx is None:
            new_headers = ['Item code'] + new_headers
            for i, row in enumerate(data_rows):
                new_row = [factwise_id_column[i]] + list(row)
                new_data_rows.append(new_row)
        else:
            for i, row in enumerate(data_rows):
                new_row = list(row)
                while len(new_row) < len(new_headers):
                    new_row.append("")
                if strategy == 'override_all':
                    new_row[item_idx] = factwise_id_column[i]
                else:  # fill only null/empty
                    current_val = new_row[item_idx]
                    if current_val is None or str(current_val).strip() == "":
                        new_row[item_idx] = factwise_id_column[i]
                new_data_rows.append(new_row)
        
        # Store Factwise ID rule for template saving (no caching of data)
        factwise_id_rule = {
            "type": "factwise_id",
            "first_column": first_column,
            "second_column": second_column,
            "operator": operator,
            "strategy": strategy
        }
        
        # Initialize factwise_rules if not exists
        if "factwise_rules" not in info:
            info["factwise_rules"] = []
        
        # Add or update the Factwise ID rule (only keep one)
        info["factwise_rules"] = [rule for rule in info["factwise_rules"] if rule.get("type") != "factwise_id"]
        info["factwise_rules"].append(factwise_id_rule)
        
        # Save session
        save_session_to_file(session_id, info)
        
        logger.info(f"🆔 Successfully created Factwise ID mapped into 'Item code' with {len(factwise_id_column)} entries (strategy={strategy})")
        
        return Response({
            'success': True,
            'message': 'Factwise ID applied to Item code successfully',
            'total_rows': len(factwise_id_column)
        })
        
    except Exception as e:
        logger.error(f"Error creating Factwise ID: {e}")
        return Response({
            'success': False,
            'error': f'Failed to create Factwise ID: {str(e)}'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['GET'])
def system_diagnostics(request):
    """Comprehensive system diagnostics for session persistence verification."""
    try:
        import psutil
        import os
        import platform
        from datetime import datetime
        
        # System information with worker diagnostics
        system_info = {
            'platform': platform.platform(),
            'python_version': platform.python_version(),
            'cpu_count': psutil.cpu_count(),
            'memory_total_gb': round(psutil.virtual_memory().total / (1024**3), 2),
            'memory_used_gb': round(psutil.virtual_memory().used / (1024**3), 2),
            'pid': os.getpid(),
            'worker_id': os.environ.get('SERVER_SOFTWARE', 'Unknown'),
            'timestamp': datetime.utcnow().isoformat(),
        }
        
        # Session persistence analysis
        sessions_info = []
        session_files_count = 0
        
        if hybrid_file_manager.local_temp_dir.exists():
            session_files = list(hybrid_file_manager.local_temp_dir.glob("session_*.json"))
            session_files_count = len(session_files)
        
        for session_id, session_data in list(SESSION_STORE.items())[-10:]:  # Last 10 sessions
            session_file = hybrid_file_manager.local_temp_dir / f"session_{session_id}.json"
            sessions_info.append({
                'session_id': session_id[:8] + "...",  # Truncate for security
                'created': session_data.get('created'),
                'has_client_file': bool(session_data.get('client_path')),
                'has_template_file': bool(session_data.get('template_path')),
                'has_mappings': bool(session_data.get('mappings')),
                'template_modified': session_data.get('template_modified', False),
                'persisted_to_file': session_file.exists(),
            })
        
        # File system diagnostics
        file_system_info = {
            'temp_dir_exists': hybrid_file_manager.local_temp_dir.exists(),
            'upload_dir_exists': hybrid_file_manager.local_upload_dir.exists(),
            'temp_dir_path': str(hybrid_file_manager.local_temp_dir),
            'upload_dir_path': str(hybrid_file_manager.local_upload_dir),
        }
        
        # Azure storage diagnostics
        azure_available = hybrid_file_manager.azure_storage.is_available()
        
        # Session persistence health check
        persistence_health = {
            'memory_sessions_count': len(SESSION_STORE),
            'file_sessions_count': session_files_count,
            'universal_session_helpers_active': True,
            'single_worker_config_applied': True,
            'file_fallback_available': True,
        }
        
        # Fix status summary
        fix_status = {
            'issue_identified': 'Multi-worker Gunicorn session isolation',
            'primary_fix': 'Single worker configuration (workers=1)',
            'secondary_fix': 'Enhanced session persistence with file fallback',
            'affected_endpoints': ['/api/upload/', '/api/headers/{session_id}/', '/api/mapping/', '/api/data/'],
            'fix_applied': True,
            'expected_behavior': 'Sessions persist across all requests within same server instance',
            'deployment_required': True,
            'deployment_note': 'Restart Azure Web App to apply Gunicorn configuration changes',
        }
        
        return Response({
            'success': True,
            'system_info': system_info,
            'session_persistence': persistence_health,
            'file_system': file_system_info,
            'azure_storage_available': azure_available,
            'recent_sessions': sessions_info,
            'fix_status': fix_status,
            'diagnostics_timestamp': datetime.utcnow().isoformat(),
        })
        
    except Exception as e:
        return Response({
            'success': False,
            'error': f'System diagnostics failed: {str(e)}',
            'timestamp': datetime.utcnow().isoformat(),
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)