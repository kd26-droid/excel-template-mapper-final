from django.contrib import admin
from .models import MappingTemplate

@admin.register(MappingTemplate)
class MappingTemplateAdmin(admin.ModelAdmin):
    list_display = ('name', 'session_id', 'usage_count', 'created_at', 'updated_at')
    list_filter = ('created_at', 'updated_at')
    search_fields = ('name', 'description', 'session_id')
    readonly_fields = ('created_at', 'updated_at', 'session_id')
    ordering = ('-created_at',)
