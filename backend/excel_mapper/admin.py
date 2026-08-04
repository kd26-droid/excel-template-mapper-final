from django.contrib import admin
from django.utils.html import format_html
from .models import MappingTemplate, GlobalMpnCache, ProviderCredential, IntermediateArtifact, BomWorkflowTemplate, ProcessingTemplate

@admin.register(MappingTemplate)
class MappingTemplateAdmin(admin.ModelAdmin):
    list_display = ('name', 'session_id', 'usage_count', 'created_at', 'updated_at')
    list_filter = ('created_at', 'updated_at')
    search_fields = ('name', 'description', 'session_id')
    readonly_fields = ('created_at', 'updated_at', 'session_id')
    ordering = ('-created_at',)


@admin.register(GlobalMpnCache)
class GlobalMpnCacheAdmin(admin.ModelAdmin):
    list_display = ('mpn_normalized', 'is_valid_display', 'status', 'dkpn', 'access_count', 'last_accessed', 'created_at')
    list_filter = ('is_valid', 'status', 'end_of_life', 'discontinued', 'site', 'created_at', 'last_accessed')
    search_fields = ('mpn_normalized', 'canonical_mpn', 'dkpn')
    readonly_fields = ('created_at', 'updated_at', 'last_accessed', 'access_count', 'validation_data')
    ordering = ('-last_accessed',)

    actions = ['cleanup_old_entries', 'cleanup_invalid_entries']

    def is_valid_display(self, obj):
        if obj.is_valid:
            return format_html('<span style="color: green;">✓ Valid</span>')
        else:
            return format_html('<span style="color: red;">✗ Invalid</span>')
    is_valid_display.short_description = 'Valid'
    is_valid_display.admin_order_field = 'is_valid'

    def cleanup_old_entries(self, request, queryset):
        count = GlobalMpnCache.cleanup_old_entries(days_old=365)
        self.message_user(request, f"Cleaned up {count} old cache entries (>365 days).")
    cleanup_old_entries.short_description = "Clean up old cache entries (>1 year)"

    def cleanup_invalid_entries(self, request, queryset):
        count = GlobalMpnCache.cleanup_invalid_entries(days_old=30)
        self.message_user(request, f"Cleaned up {count} invalid cache entries (>30 days).")
    cleanup_invalid_entries.short_description = "Clean up old invalid entries (>30 days)"

    fieldsets = (
        ('MPN Information', {
            'fields': ('mpn_normalized', 'manufacturer_id', 'canonical_mpn', 'all_canonical_mpns')
        }),
        ('Validation Results', {
            'fields': ('is_valid', 'dkpn', 'status', 'end_of_life', 'discontinued')
        }),
        ('Locale Settings', {
            'fields': ('site', 'lang', 'currency'),
            'classes': ('collapse',)
        }),
        ('Cache Statistics', {
            'fields': ('access_count', 'created_at', 'updated_at', 'last_accessed')
        }),
        ('Raw Data', {
            'fields': ('validation_data',),
            'classes': ('collapse',)
        })
    )


@admin.register(ProviderCredential)
class ProviderCredentialAdmin(admin.ModelAdmin):
    list_display = ('scope_id', 'provider', 'configured', 'last_test_success', 'updated_at')
    list_filter = ('provider', 'configured', 'last_test_success', 'updated_at')
    search_fields = ('scope_id', 'provider')
    readonly_fields = ('created_at', 'updated_at', 'encrypted_credentials')
    ordering = ('scope_id', 'provider')


@admin.register(IntermediateArtifact)
class IntermediateArtifactAdmin(admin.ModelAdmin):
    list_display = ('session_id', 'artifact_type', 'label', 'file_format', 'row_count', 'column_count', 'created_at')
    list_filter = ('artifact_type', 'file_format', 'created_at')
    search_fields = ('session_id', 'artifact_type', 'label', 'file_path')
    readonly_fields = ('created_at', 'file_path', 'metadata')
    ordering = ('-created_at',)


@admin.register(BomWorkflowTemplate)
class BomWorkflowTemplateAdmin(admin.ModelAdmin):
    list_display = ('name', 'usage_count', 'created_at', 'updated_at')
    search_fields = ('name', 'description')
    readonly_fields = ('created_at', 'updated_at', 'usage_count')
    ordering = ('-updated_at',)


@admin.register(ProcessingTemplate)
class ProcessingTemplateAdmin(admin.ModelAdmin):
    list_display = ('name', 'status', 'version', 'usage_count', 'created_at', 'updated_at')
    list_filter = ('status', 'created_at', 'updated_at')
    search_fields = ('name', 'description')
    readonly_fields = ('created_at', 'updated_at', 'usage_count')
    ordering = ('-updated_at',)
