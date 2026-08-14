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
    apply_sheet_join,
    cleanup_rows,
    get_headers,
    mapping_suggestions,
    BOMHeaderMappingView,
    save_mappings,
    get_existing_mappings,
    dashboard_view,
    delete_upload,
    delete_all_uploads,
    data_view,
    save_data,
    download_file,
    download_original_file,
    download_template_file,
    download_grid_excel,
    update_session_data,
    expand_column_groups,
    split_column_into_columns,
    split_column_into_rows,
    fill_or_create_column,
    copy_column_values,
    set_column_default,
    fill_missing_values,
    carry_forward_group,
    stack_mapped_alternates,
    fill_required_defaults,
    required_field_report,
    resolve_item_code,
    column_source_map,
    source_columns_preview,
    cleanup_grid_rows,
    delete_rows_conditional,
    download_demo_bom_sheet,
    generate_bom_sheet,
    bom_tree,
    bom_revision_handoff,
    download_bom_sheet,
    validate_bom_sheet,
    demo_bom_tree,
    expand_alternate_columns,

    # Unified Template + Formula views (MappingTemplate based)
    save_mapping_template,
    get_mapping_templates,
    delete_mapping_template,
    apply_mapping_template,
    update_mapping_template,
    export_mapping_template,
    import_mapping_template,
    import_edited_sheet,
    update_column_counts,
    apply_formulas,
    preview_formulas,
    check_column_conflicts,
    clear_formulas,

    # Saved column rules
    column_rules,
    column_rule_detail,

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

    # Project management
    project_list_create,
)

# PDF processing views
from .pdf_views import (
    upload_pdf,
    process_pdf_ocr,
    process_pdf_compare,
    get_pdf_session_status,
    cleanup_pdf_session,
    get_page_image,
    get_pdf_session,
    get_pdf_file,
    analyze_pdf_complexity_endpoint,
)

# Zone management views (enabled with safe stubs)
from .zone_views import (
    create_or_update_zones,
    get_zones,
    process_zones,
    process_column_zones,
    get_zone_processing_status,
    manage_zone_links,
)
from .mpn_views import (
    mpn_auth_status,
    mpn_validation_summary,
    mpn_auth_start,
    mpn_auth_callback,
    mpn_validate,
    mpn_validate_warm,
    mpn_admin_exchange_code,
    mpn_batch_validate_eol,
    mpn_restore_from_cache,
    mpn_validate_parser_specs,
    mpn_parse_producer_column,
    mpn_split_cells,
    analyze_mpn_pairing,
)
from .manufacturer_views import (
    manufacturer_directory,
    manufacturer_search,
)
from .provider_credentials import (
    provider_credentials,
    provider_credential_detail,
    provider_credential_test,
)
from .editor_defaults import (
    editor_default_settings,
    editor_default_apply_preview,
)
from .intermediate_artifacts import (
    intermediate_artifacts,
    save_intermediate_artifact,
    download_intermediate_artifact,
    delete_intermediate_artifact,
)
from .bom_workflow_templates import (
    bom_workflow_templates,
    bom_workflow_template_detail,
)
from .processing_templates import (
    processing_templates,
    processing_template_detail,
    processing_template_validate,
    processing_template_editor_session,
)

# Column Parser views
from .parser_views import (
    parser_analyze_column,
    parser_preview,
    parser_apply,
    parser_get_columns,
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

    # File upload & cleanup
    path('upload/', upload_files, name='upload-files'),
    path('sheet-join/apply/', apply_sheet_join, name='apply-sheet-join'),
    path('cleanup-rows/', cleanup_rows, name='cleanup-rows'),

    # Headers and mapping
    path('headers/<str:session_id>/', get_headers, name='get-headers'),
    path('mapping/', mapping_suggestions, name='mapping-suggestions'),
    path('mapping/save/', save_mappings, name='mapping-save'),
    path('mapping/existing/<str:session_id>/', get_existing_mappings, name='get-existing-mappings'),
    path('map-headers/', BOMHeaderMappingView.as_view(), name='map-headers'),

    # Data management
    path('data/', data_view, name='get-mapped-data'),
    path('data/save/', save_data, name='save-edited-data'),
    path('update-session-data/', update_session_data, name='update-session-data'),
    path('transforms/expand-column-groups/', expand_column_groups, name='expand-column-groups'),
    path('transforms/split-into-columns/', split_column_into_columns, name='split-column-into-columns'),
    path('transforms/split-into-rows/', split_column_into_rows, name='split-column-into-rows'),
    path('transforms/fill-or-create-column/', fill_or_create_column, name='fill-or-create-column'),
    path('transforms/copy-column/', copy_column_values, name='copy-column-values'),
    path('transforms/set-column-default/', set_column_default, name='set-column-default'),
    path('transforms/fill-missing-values/', fill_missing_values, name='fill-missing-values'),
    path('transforms/carry-forward-group/', carry_forward_group, name='carry-forward-group'),
    path('transforms/stack-alternates/', stack_mapped_alternates, name='stack-mapped-alternates'),
    path('transforms/fill-required-defaults/', fill_required_defaults, name='fill-required-defaults'),
    path('transforms/required-field-report/', required_field_report, name='required-field-report'),
    path('transforms/resolve-item-code/', resolve_item_code, name='resolve-item-code'),
    path('transforms/column-source-map/<str:session_id>/', column_source_map, name='column-source-map'),
    path('transforms/source-columns-preview/<str:session_id>/', source_columns_preview, name='source-columns-preview'),
    path('transforms/cleanup-grid-rows/', cleanup_grid_rows, name='cleanup-grid-rows'),
    path('transforms/delete-rows/', delete_rows_conditional, name='delete-rows-conditional'),
    path('transforms/expand-alternate-columns/', expand_alternate_columns, name='expand-alternate-columns'),

    # Download endpoints
    path('download/', download_file, name='download-file'),
    path('download/<str:session_id>/converted/', download_file, name='download-converted-file'),
    path('download/<str:session_id>/original/', download_original_file, name='download-original-file'),
    path('download/<str:session_id>/template/', download_template_file, name='download-template-file'),
    path('download/original/', download_original_file, name='download-original-file-legacy'),
    path('download/grid-excel/', download_grid_excel, name='download-grid-excel'),
    path('download/demo-bom/<str:session_id>/', download_demo_bom_sheet, name='download-demo-bom-sheet'),
    path('demo/bom-tree/<str:session_id>/', demo_bom_tree, name='demo-bom-tree'),
    path('import/<str:session_id>/', import_edited_sheet, name='import-edited-sheet'),
    path('bom/generate/<str:session_id>/', generate_bom_sheet, name='generate-bom-sheet'),
    path('bom/tree/<str:session_id>/', bom_tree, name='bom-tree'),
    # GET: what a caller needs to finish a revision this session started.
    # POST: the browser handing back the bulk-import result.
    path('bom/revision-handoff/<str:session_id>/', bom_revision_handoff,
         name='bom-revision-handoff'),
    path('bom/download/<str:session_id>/', download_bom_sheet, name='download-bom-sheet'),
    path('bom/validate/<str:session_id>/', validate_bom_sheet, name='validate-bom-sheet'),

    # Dashboard
    path('dashboard/', dashboard_view, name='dashboard'),
    path('dashboard/uploads/<str:session_id>/', delete_upload, name='delete-upload'),
    path('dashboard/uploads/', delete_all_uploads, name='delete-all-uploads'),

    # Unified Templates (Column Mappings + Formulas)
    path('templates/save/', save_mapping_template, name='save-mapping-template'),
    path('templates/import/', import_mapping_template, name='import-mapping-template'),
    path('templates/', get_mapping_templates, name='get-mapping-templates'),
    path('templates/<int:template_id>/export/', export_mapping_template, name='export-mapping-template'),
    path('templates/<int:template_id>/', delete_mapping_template, name='delete-mapping-template'),
    path('templates/apply/', apply_mapping_template, name='apply-mapping-template'),
    path('templates/update/', update_mapping_template, name='update-mapping-template'),
    path('column-counts/update/', update_column_counts, name='update-column-counts'),
    
    # Formula Management (integrated with templates)
    path('formulas/apply/', apply_formulas, name='apply-formulas'),
    path('formulas/preview/', preview_formulas, name='preview-formulas'),
    path('formulas/conflicts/', check_column_conflicts, name='check-column-conflicts'),
    path('formulas/clear/', clear_formulas, name='clear-formulas'),
    
    # Saved column rules (named fill/create-column operations)
    path('column-rules/', column_rules, name='column-rules'),
    path('column-rules/<int:rule_id>/', column_rule_detail, name='column-rule-detail'),

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
    path('pdf/process-compare/', process_pdf_compare, name='process-pdf-compare'),
    path('pdf/analyze-complexity/', analyze_pdf_complexity_endpoint, name='analyze-pdf-complexity'),
    path('pdf/status/<str:session_id>/', get_pdf_session_status, name='get-pdf-session-status'),
    path('pdf/cleanup/', cleanup_pdf_session, name='cleanup-pdf-session'),
    path('pdf/page/<str:session_id>/<int:page_number>/', get_page_image, name='get-page-image'),
    path('pdf/sessions/<str:session_id>/', get_pdf_session, name='get-pdf-session'),
    path('pdf/sessions/<str:session_id>/file/', get_pdf_file, name='get-pdf-file'),

    # PDF Zone Management endpoints (stubbed OK)
    path('pdf/zones/<str:session_id>/', get_zones, name='zones-handler'),
    path('pdf/zones/<str:session_id>/process/', process_zones, name='process-zones'),
    path('pdf/zones/<str:session_id>/process-columns/', process_column_zones, name='process-column-zones'),
    path('pdf/zones/<str:session_id>/status/', get_zone_processing_status, name='get-zone-processing-status'),
    path('pdf/continuations/<str:session_id>/link/', manage_zone_links, name='manage-zone-links'),

    # MPN Validation + OAuth
    path('manufacturers/', manufacturer_directory, name='manufacturer-directory'),
    path('manufacturers/search/', manufacturer_search, name='manufacturer-search'),
    path('settings/provider-credentials/', provider_credentials, name='provider-credentials'),
    path('settings/provider-credentials/<str:provider>/test/', provider_credential_test, name='provider-credential-test'),
    path('settings/provider-credentials/<str:provider>/', provider_credential_detail, name='provider-credential-detail'),
    path('settings/editor-defaults/', editor_default_settings, name='editor-default-settings'),
    path('settings/editor-defaults/apply-preview/', editor_default_apply_preview, name='editor-default-apply-preview'),
    path('intermediate-artifacts/', intermediate_artifacts, name='intermediate-artifacts'),
    path('intermediate-artifacts/save/', save_intermediate_artifact, name='save-intermediate-artifact'),
    path('intermediate-artifacts/<int:artifact_id>/download/', download_intermediate_artifact, name='download-intermediate-artifact'),
    path('intermediate-artifacts/<int:artifact_id>/', delete_intermediate_artifact, name='delete-intermediate-artifact'),
    path('bom-workflow-templates/', bom_workflow_templates, name='bom-workflow-templates'),
    path('bom-workflow-templates/<int:template_id>/', bom_workflow_template_detail, name='bom-workflow-template-detail'),
    path('processing-templates/', processing_templates, name='processing-templates'),
    path('processing-templates/editor-session/', processing_template_editor_session, name='processing-template-editor-session'),
    path('processing-templates/<int:template_id>/', processing_template_detail, name='processing-template-detail'),
    path('processing-templates/<int:template_id>/validate/', processing_template_validate, name='processing-template-validate'),

    # MPN Validation + OAuth
    path('mpn/auth/status/', mpn_auth_status, name='mpn-auth-status'),
    path('mpn/summary/<str:session_id>/', mpn_validation_summary, name='mpn-validation-summary'),
    path('mpn/auth/start/', mpn_auth_start, name='mpn-auth-start'),
    path('mpn/auth/callback', mpn_auth_callback, name='mpn-auth-callback'),
    path('mpn/validate/', mpn_validate, name='mpn-validate'),
    path('mpn/validate-warm/', mpn_validate_warm, name='mpn-validate-warm'),
    path('mpn/split-cells/', mpn_split_cells, name='mpn-split-cells'),
    path('mpn/analyze-pairing/', analyze_mpn_pairing, name='mpn-analyze-pairing'),
    path('mpn/parse-producer/', mpn_parse_producer_column, name='mpn-parse-producer'),
    path('mpn/restore-from-cache/', mpn_restore_from_cache, name='mpn-restore-from-cache'),
    path('mpn/admin/exchange-code/', mpn_admin_exchange_code, name='mpn-admin-exchange-code'),
    path('mpn/batch-validate-eol/', mpn_batch_validate_eol, name='mpn-batch-validate-eol'),
    path('mpn/validate-parser-specs/', mpn_validate_parser_specs, name='mpn-validate-parser-specs'),

    # MPN Cache Management
    path('mpn/cache/stats/', mpn_cache_stats, name='mpn-cache-stats'),
    path('mpn/cache/cleanup/', mpn_cache_cleanup, name='mpn-cache-cleanup'),

    # Project Management
    path('projects/', project_list_create, name='project-list-create'),

    # Column Parser endpoints
    path('parser/columns/<str:session_id>/', parser_get_columns, name='parser-get-columns'),
    path('parser/analyze/', parser_analyze_column, name='parser-analyze-column'),
    path('parser/preview/', parser_preview, name='parser-preview'),
    path('parser/apply/', parser_apply, name='parser-apply'),
]
