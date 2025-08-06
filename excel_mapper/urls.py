# urls.py - Working version for Excel Template Mapper

from django.urls import path
from .views import (
    # Basic functionality views
    health_check,
    debug_session,
    upload_files,
    get_headers,
    mapping_suggestions,
    BOMHeaderMappingView,
    save_mappings,
    get_existing_mappings,
    dashboard_view,
    data_view,
    save_data,
    download_file,
    download_original_file,
    download_grid_excel,
    
    # Unified Template + Formula views (MappingTemplate based)
    save_mapping_template,
    get_mapping_templates,
    delete_mapping_template,
    apply_mapping_template,
    update_mapping_template,
    apply_formulas,
    preview_formulas,
    check_column_conflicts,
    clear_formulas,
    
    # Tag Template views
    save_tag_template,
    get_tag_templates,
    delete_tag_template,
    apply_tag_template,
    
    # Factwise ID creation
    create_factwise_id,
)

urlpatterns = [
    # Health check
    path('health/', health_check, name='health-check'),
    
    # Debug session
    path('debug-session/', debug_session, name='debug-session'),

    # File upload
    path('upload/', upload_files, name='upload-files'),

    # Headers and mapping
    path('headers/<str:session_id>/', get_headers, name='get-headers'),
    path('mapping/', mapping_suggestions, name='mapping-suggestions'),
    path('mapping/save/', save_mappings, name='mapping-save'),
    path('mapping/existing/<str:session_id>/', get_existing_mappings, name='get-existing-mappings'),
    path('map-headers/', BOMHeaderMappingView.as_view(), name='map-headers'),

    # Data management
    path('data/', data_view, name='get-mapped-data'),
    path('data/save/', save_data, name='save-edited-data'),

    # Download endpoints
    path('download/', download_file, name='download-file'),
    path('download/original/', download_original_file, name='download-original-file'),
    path('download/grid-excel/', download_grid_excel, name='download-grid-excel'),

    # Dashboard
    path('dashboard/', dashboard_view, name='dashboard'),

    # Unified Templates (Column Mappings + Formulas)
    path('templates/save/', save_mapping_template, name='save-mapping-template'),
    path('templates/', get_mapping_templates, name='get-mapping-templates'),
    path('templates/<int:template_id>/', delete_mapping_template, name='delete-mapping-template'),
    path('templates/apply/', apply_mapping_template, name='apply-mapping-template'),
    path('templates/update/', update_mapping_template, name='update-mapping-template'),
    
    # Formula Management (integrated with templates)
    path('formulas/apply/', apply_formulas, name='apply-formulas'),
    path('formulas/preview/', preview_formulas, name='preview-formulas'),
    path('formulas/conflicts/', check_column_conflicts, name='check-column-conflicts'),
    path('formulas/clear/', clear_formulas, name='clear-formulas'),
    
    # Tag Templates (Smart Tag Rules Templates)
    path('tag-templates/save/', save_tag_template, name='save-tag-template'),
    path('tag-templates/', get_tag_templates, name='get-tag-templates'),
    path('tag-templates/<int:template_id>/', delete_tag_template, name='delete-tag-template'),
    path('tag-templates/<int:template_id>/apply/', apply_tag_template, name='apply-tag-template'),
    
    # Factwise ID Creation
    path('create-factwise-id/', create_factwise_id, name='create-factwise-id'),
]

