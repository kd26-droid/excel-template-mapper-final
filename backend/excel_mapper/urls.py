# urls.py - Working version for Excel Template Mapper

from django.urls import path
from .views import (
    # Basic functionality views
    health_check,
    get_session_snapshot,
    debug_session,
    system_diagnostics,
    session_status,
    rebuild_template,
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
    download_template_file,
    download_grid_excel,

    # Unified Template + Formula views (MappingTemplate based)
    save_mapping_template,
    get_mapping_templates,
    delete_mapping_template,
    apply_mapping_template,
    update_mapping_template,
    update_column_counts,
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

    # MPN Cache management
    mpn_cache_stats,
    mpn_cache_cleanup,
)

# PDF processing views
from .pdf_views import (
    upload_pdf,
    process_pdf_ocr,
    get_pdf_session_status,
    cleanup_pdf_session,
    get_page_image,
)
from .mpn_views import (
    mpn_auth_status,
    mpn_auth_start,
    mpn_auth_callback,
    mpn_validate,
    mpn_admin_exchange_code,
    mpn_batch_validate_eol,
    mpn_restore_from_cache,
)

urlpatterns = [
    # Health check
    path('health/', health_check, name='health-check'),
    
    # Session snapshot
    path('session/<str:session_id>/snapshot/', get_session_snapshot, name='get-session-snapshot'),
    
    # Session status
    path('session/<str:session_id>/status/', session_status, name='session-status'),
    
    # Template rebuild
    path('rebuild-template/', rebuild_template, name='rebuild-template'),
    
    # Debug session
    path('debug-session/', debug_session, name='debug-session'),
    path('system-diagnostics/', system_diagnostics, name='system-diagnostics'),

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
    path('download/<str:session_id>/converted/', download_file, name='download-converted-file'),
    path('download/<str:session_id>/original/', download_original_file, name='download-original-file'),
    path('download/<str:session_id>/template/', download_template_file, name='download-template-file'),
    path('download/original/', download_original_file, name='download-original-file-legacy'),
    path('download/grid-excel/', download_grid_excel, name='download-grid-excel'),

    # Dashboard
    path('dashboard/', dashboard_view, name='dashboard'),

    # Unified Templates (Column Mappings + Formulas)
    path('templates/save/', save_mapping_template, name='save-mapping-template'),
    path('templates/', get_mapping_templates, name='get-mapping-templates'),
    path('templates/<int:template_id>/', delete_mapping_template, name='delete-mapping-template'),
    path('templates/apply/', apply_mapping_template, name='apply-mapping-template'),
    path('templates/update/', update_mapping_template, name='update-mapping-template'),
    path('column-counts/update/', update_column_counts, name='update-column-counts'),
    
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

    # PDF Processing endpoints
    path('pdf/upload/', upload_pdf, name='upload-pdf'),
    path('pdf/process/', process_pdf_ocr, name='process-pdf-ocr'),
    path('pdf/status/<str:session_id>/', get_pdf_session_status, name='get-pdf-session-status'),
    path('pdf/cleanup/', cleanup_pdf_session, name='cleanup-pdf-session'),
    path('pdf/page/<str:session_id>/<int:page_number>/', get_page_image, name='get-page-image'),

    # MPN Validation + OAuth
    path('mpn/auth/status/', mpn_auth_status, name='mpn-auth-status'),
    path('mpn/auth/start/', mpn_auth_start, name='mpn-auth-start'),
    path('mpn/auth/callback', mpn_auth_callback, name='mpn-auth-callback'),
    path('mpn/validate/', mpn_validate, name='mpn-validate'),
    path('mpn/restore-from-cache/', mpn_restore_from_cache, name='mpn-restore-from-cache'),
    path('mpn/admin/exchange-code/', mpn_admin_exchange_code, name='mpn-admin-exchange-code'),
    path('mpn/batch-validate-eol/', mpn_batch_validate_eol, name='mpn-batch-validate-eol'),

    # MPN Cache Management
    path('mpn/cache/stats/', mpn_cache_stats, name='mpn-cache-stats'),
    path('mpn/cache/cleanup/', mpn_cache_cleanup, name='mpn-cache-cleanup'),
]
