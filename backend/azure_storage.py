"""
Azure Blob Storage service for Excel Template Mapper.
Handles file uploads, downloads, and temporary storage.
"""
import os
import logging
from typing import Optional, Tuple
from pathlib import Path
from io import BytesIO

from azure.storage.blob import BlobServiceClient, BlobClient
from azure.core.exceptions import AzureError
from django.conf import settings

logger = logging.getLogger(__name__)

class AzureBlobStorageService:
    """Service for managing files in Azure Blob Storage."""
    
    def __init__(self):
        self.connection_string = os.getenv('AZURE_STORAGE_CONNECTION_STRING')
        self.container_name = os.getenv('AZURE_STORAGE_CONTAINER_NAME', 'excel-files')
        
        if not self.connection_string:
            logger.warning("Azure Storage connection string not found, falling back to local storage")
            self.blob_service_client = None
        else:
            try:
                self.blob_service_client = BlobServiceClient.from_connection_string(self.connection_string)
                self._ensure_container_exists()
            except Exception as e:
                logger.error(f"Failed to initialize Azure Blob Storage: {e}")
                self.blob_service_client = None
    
    def _ensure_container_exists(self):
        """Ensure the blob container exists."""
        try:
            container_client = self.blob_service_client.get_container_client(self.container_name)
            if not container_client.exists():
                container_client.create_container()
                logger.info(f"Created container: {self.container_name}")
        except Exception as e:
            logger.error(f"Failed to ensure container exists: {e}")
    
    def is_available(self) -> bool:
        """Check if Azure Blob Storage is available."""
        return self.blob_service_client is not None
    
    def upload_file(self, file_content: bytes, blob_name: str) -> Optional[str]:
        """
        Upload file content to Azure Blob Storage.
        Returns the blob URL on success, None on failure.
        """
        if not self.is_available():
            return None
        
        try:
            blob_client = self.blob_service_client.get_blob_client(
                container=self.container_name,
                blob=blob_name
            )
            
            # Upload the file
            blob_client.upload_blob(file_content, overwrite=True)
            
            # Return the blob URL
            blob_url = blob_client.url
            logger.info(f"Successfully uploaded file to Azure Blob: {blob_name}")
            return blob_url
            
        except AzureError as e:
            logger.error(f"Failed to upload file to Azure Blob Storage: {e}")
            return None
    
    def download_file(self, blob_name: str) -> Optional[bytes]:
        """
        Download file content from Azure Blob Storage.
        Returns file content as bytes on success, None on failure.
        """
        if not self.is_available():
            return None
        
        try:
            blob_client = self.blob_service_client.get_blob_client(
                container=self.container_name,
                blob=blob_name
            )
            
            # Download the file
            download_stream = blob_client.download_blob()
            content = download_stream.readall()
            
            logger.info(f"Successfully downloaded file from Azure Blob: {blob_name}")
            return content
            
        except AzureError as e:
            logger.error(f"Failed to download file from Azure Blob Storage: {e}")
            return None
    
    def delete_file(self, blob_name: str) -> bool:
        """
        Delete file from Azure Blob Storage.
        Returns True on success, False on failure.
        """
        if not self.is_available():
            return False
        
        try:
            blob_client = self.blob_service_client.get_blob_client(
                container=self.container_name,
                blob=blob_name
            )
            
            blob_client.delete_blob()
            logger.info(f"Successfully deleted file from Azure Blob: {blob_name}")
            return True
            
        except AzureError as e:
            logger.error(f"Failed to delete file from Azure Blob Storage: {e}")
            return False
    
    def list_files(self, prefix: str = "") -> list:
        """
        List files in Azure Blob Storage with optional prefix filter.
        Returns list of blob names.
        """
        if not self.is_available():
            return []
        
        try:
            container_client = self.blob_service_client.get_container_client(self.container_name)
            blob_list = container_client.list_blobs(name_starts_with=prefix)
            
            return [blob.name for blob in blob_list]
            
        except AzureError as e:
            logger.error(f"Failed to list files in Azure Blob Storage: {e}")
            return []


# Global instance
azure_storage = AzureBlobStorageService()


class HybridFileManager:
    """
    Hybrid file manager that uses Azure Blob Storage when available,
    falls back to local storage for development and when Azure is unavailable.
    """
    
    def __init__(self):
        self.azure_storage = azure_storage
        # Local storage paths
        self.local_upload_dir = Path(settings.BASE_DIR) / 'uploaded_files'
        self.local_temp_dir = Path(settings.BASE_DIR) / 'temp_downloads'
        self._ensure_local_directories()
    
    def _ensure_local_directories(self):
        """Ensure local directories exist for fallback."""
        self.local_upload_dir.mkdir(parents=True, exist_ok=True)
        self.local_temp_dir.mkdir(parents=True, exist_ok=True)
    
    def save_upload_file(self, file, prefix="upload") -> Tuple[str, str]:
        """
        Save uploaded file. Uses Azure Blob Storage when available,
        falls back to local storage.
        
        Returns: (file_path_or_url, original_filename)
        """
        import uuid
        
        file_extension = Path(file.name).suffix
        unique_filename = f"{uuid.uuid4()}_{prefix}{file_extension}"
        
        # Try Azure Blob Storage first
        if self.azure_storage.is_available():
            try:
                # Read file content
                file_content = file.read()
                file.seek(0)  # Reset file pointer
                
                # Upload to Azure
                blob_url = self.azure_storage.upload_file(file_content, unique_filename)
                if blob_url:
                    logger.info(f"File saved to Azure Blob Storage: {unique_filename}")
                    return blob_url, file.name
                
            except Exception as e:
                logger.warning(f"Failed to save to Azure Blob Storage, falling back to local: {e}")
        
        # Fallback to local storage
        local_file_path = self.local_upload_dir / unique_filename
        
        with open(local_file_path, 'wb+') as destination:
            for chunk in file.chunks():
                destination.write(chunk)
        
        logger.info(f"File saved to local storage: {local_file_path}")
        return str(local_file_path), file.name
    
    def get_file_path(self, file_identifier: str) -> str:
        """
        Get local file path for processing.
        Downloads from Azure Blob Storage if needed.
        """
        # If it's already a local path, return it
        if file_identifier.startswith('/') or file_identifier.startswith('./'):
            return file_identifier
        
        # If it's an Azure Blob URL, extract blob name and download
        if 'blob.core.windows.net' in file_identifier:
            try:
                blob_name = file_identifier.split('/')[-1]
                return self._download_and_cache(blob_name)
            except Exception as e:
                logger.error(f"Failed to extract blob name from URL: {file_identifier}, error: {e}")
                return file_identifier
        
        # If it's just a blob name, download it
        if self.azure_storage.is_available():
            return self._download_and_cache(file_identifier)
        
        # Fallback: assume it's a local filename in upload directory
        return str(self.local_upload_dir / file_identifier)
    
    def _download_and_cache(self, blob_name: str) -> str:
        """Download file from Azure and cache locally for processing."""
        cached_file_path = self.local_temp_dir / blob_name
        
        # Check if already cached
        if cached_file_path.exists():
            return str(cached_file_path)
        
        # Download from Azure
        file_content = self.azure_storage.download_file(blob_name)
        if file_content:
            with open(cached_file_path, 'wb') as f:
                f.write(file_content)
            logger.info(f"Downloaded and cached file: {blob_name}")
            return str(cached_file_path)
        
        logger.error(f"Failed to download file from Azure: {blob_name}")
        return blob_name  # Return original identifier as fallback


# Global hybrid file manager instance
hybrid_file_manager = HybridFileManager()
