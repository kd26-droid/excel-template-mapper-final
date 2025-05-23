from django.db import models
from django.utils import timezone


class UploadSession(models.Model):
    """Model to track file upload sessions"""
    session_id = models.CharField(max_length=100, unique=True)
    template_name = models.CharField(max_length=255)
    user_file_name = models.CharField(max_length=255)
    template_file_name = models.CharField(max_length=255)
    upload_date = models.DateTimeField(default=timezone.now)
    rows_processed = models.IntegerField(default=0)
    status = models.CharField(max_length=50, default='uploaded')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.template_name} - {self.upload_date}"


class ColumnMapping(models.Model):
    """Model to store column mappings between template and user file"""
    upload_session = models.ForeignKey(UploadSession, on_delete=models.CASCADE, related_name='mappings')
    template_column = models.CharField(max_length=255)
    user_column = models.CharField(max_length=255, null=True, blank=True)
    confidence_score = models.FloatField(default=0.0)
    is_manual = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.template_column} -> {self.user_column}"


class ProcessedData(models.Model):
    """Model to store processed/edited data"""
    upload_session = models.ForeignKey(UploadSession, on_delete=models.CASCADE, related_name='processed_data')
    row_index = models.IntegerField()
    column_name = models.CharField(max_length=255)
    original_value = models.TextField(null=True, blank=True)
    edited_value = models.TextField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ['upload_session', 'row_index', 'column_name']

    def __str__(self):
        return f"Row {self.row_index} - {self.column_name}"
