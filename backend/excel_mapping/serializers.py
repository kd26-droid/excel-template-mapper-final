from rest_framework import serializers
from .models import UploadSession, ColumnMapping, ProcessedData


class ColumnMappingSerializer(serializers.ModelSerializer):
    class Meta:
        model = ColumnMapping
        fields = ['id', 'template_column', 'user_column', 'confidence_score', 'is_manual']


class UploadSessionSerializer(serializers.ModelSerializer):
    mappings = ColumnMappingSerializer(many=True, read_only=True)
    
    class Meta:
        model = UploadSession
        fields = ['id', 'session_id', 'template_name', 'user_file_name', 'template_file_name', 
                 'upload_date', 'rows_processed', 'status', 'mappings']
        read_only_fields = ['id', 'upload_date']


class ProcessedDataSerializer(serializers.ModelSerializer):
    class Meta:
        model = ProcessedData
        fields = ['id', 'row_index', 'column_name', 'original_value', 'edited_value']


class FileUploadSerializer(serializers.Serializer):
    """Serializer for file upload endpoint"""
    user_file = serializers.FileField()
    template_file = serializers.FileField()
    
    def validate_user_file(self, value):
        if not value.name.endswith(('.xlsx', '.xls')):
            raise serializers.ValidationError("User file must be an Excel file (.xlsx or .xls)")
        return value
    
    def validate_template_file(self, value):
        if not value.name.endswith(('.xlsx', '.xls')):
            raise serializers.ValidationError("Template file must be an Excel file (.xlsx or .xls)")
        return value


class ColumnMappingRequestSerializer(serializers.Serializer):
    """Serializer for column mapping requests"""
    session_id = serializers.CharField(max_length=100)
    mappings = serializers.ListField(
        child=serializers.DictField(child=serializers.CharField()),
        allow_empty=True
    )


class EditedDataSerializer(serializers.Serializer):
    """Serializer for edited spreadsheet data"""
    session_id = serializers.CharField(max_length=100)
    data = serializers.ListField(
        child=serializers.DictField(),
        allow_empty=True
    )