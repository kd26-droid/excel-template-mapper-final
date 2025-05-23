from django.urls import path
from . import views

urlpatterns = [
    # File upload endpoint
    path('upload/', views.upload_files, name='upload_files'),
    
    # Column mapping endpoints
    path('mapping/', views.get_column_mapping, name='get_column_mapping'),
    path('mapping/save/', views.save_column_mapping, name='save_column_mapping'),
    
    # Data processing endpoints
    path('data/', views.get_mapped_data, name='get_mapped_data'),
    path('data/save/', views.save_edited_data, name='save_edited_data'),
    
    # Dashboard endpoints
    path('dashboard/', views.get_upload_dashboard, name='get_upload_dashboard'),
    path('download/', views.download_processed_file, name='download_processed_file'),
    
    # Health check
    path('health/', views.health_check, name='health_check'),
]