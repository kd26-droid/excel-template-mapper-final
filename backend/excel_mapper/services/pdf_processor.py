"""
PDF processing service for converting PDFs to images and extracting data
"""
import os
import uuid
import tempfile
import logging
from typing import List, Dict, Tuple, Optional
from pathlib import Path

from PIL import Image
from pdf2image import convert_from_path
from django.conf import settings

logger = logging.getLogger(__name__)


class PDFProcessor:
    """Service for handling PDF to image conversion and basic processing"""

    def __init__(self):
        self.temp_dir = Path(tempfile.gettempdir()) / "excel_mapper_pdf"
        self.temp_dir.mkdir(exist_ok=True)

        # PDF processing configuration
        self.config = getattr(settings, 'PDF_CONFIG', {
            'max_file_size_mb': 50,
            'max_pages': 50,
            'image_dpi': 200,
            'supported_formats': ['.pdf'],
            'processing_timeout_seconds': 300,
        })

    def validate_pdf_file(self, file_path: str, file_size: int = None) -> Dict[str, any]:
        """
        Validate PDF file before processing

        Args:
            file_path: Path to PDF file
            file_size: File size in bytes (optional)

        Returns:
            Dict with validation results
        """
        try:
            if not os.path.exists(file_path):
                return {'valid': False, 'error': 'File does not exist'}

            # Check file extension
            if not file_path.lower().endswith('.pdf'):
                return {'valid': False, 'error': 'File must be a PDF'}

            # Check file size if provided
            if file_size is None:
                file_size = os.path.getsize(file_path)

            max_size_bytes = self.config['max_file_size_mb'] * 1024 * 1024
            if file_size > max_size_bytes:
                return {
                    'valid': False,
                    'error': f'File size ({file_size / 1024 / 1024:.1f}MB) exceeds maximum ({self.config["max_file_size_mb"]}MB)'
                }

            # Try to get page count
            try:
                from pdf2image.exceptions import PDFInfoNotInstalledError, PDFPageCountError
                page_count = self._get_page_count(file_path)

                if page_count > self.config['max_pages']:
                    return {
                        'valid': False,
                        'error': f'PDF has {page_count} pages, maximum allowed is {self.config["max_pages"]}'
                    }

                return {
                    'valid': True,
                    'page_count': page_count,
                    'file_size': file_size
                }

            except Exception as e:
                logger.error(f"Error checking PDF page count: {e}")
                return {'valid': False, 'error': 'Invalid or corrupted PDF file'}

        except Exception as e:
            logger.error(f"Error validating PDF file: {e}")
            return {'valid': False, 'error': f'File validation error: {str(e)}'}

    def _get_page_count(self, file_path: str) -> int:
        """Get number of pages in PDF file"""
        try:
            # Use pdf2image's built-in page counting
            from pdf2image.exceptions import PDFInfoNotInstalledError
            import subprocess

            # Try using pdfinfo first (more efficient)
            try:
                result = subprocess.run(['pdfinfo', file_path], capture_output=True, text=True, timeout=10)
                if result.returncode == 0:
                    for line in result.stdout.split('\n'):
                        if line.startswith('Pages:'):
                            return int(line.split(':')[1].strip())
            except (subprocess.TimeoutExpired, subprocess.CalledProcessError, FileNotFoundError):
                pass

            # Fallback: convert first page only to count pages
            try:
                pages = convert_from_path(file_path, dpi=50, first_page=1, last_page=1)
                # This is a workaround - we'll need to do a full conversion to get accurate count
                # For now, do a quick conversion with low DPI to get page count
                all_pages = convert_from_path(file_path, dpi=50)
                return len(all_pages)
            except Exception:
                # If all else fails, assume 1 page and let the main conversion handle errors
                return 1

        except Exception as e:
            logger.error(f"Error getting page count: {e}")
            raise

    def convert_to_images(self, file_path: str, session_id: str) -> List[Dict[str, any]]:
        """
        Convert PDF pages to high-resolution images

        Args:
            file_path: Path to PDF file
            session_id: Unique session identifier

        Returns:
            List of dictionaries with page information
        """
        try:
            logger.info(f"Converting PDF to images: {file_path}")

            # Create session directory
            session_dir = self.temp_dir / session_id
            session_dir.mkdir(exist_ok=True)

            # Convert PDF to images
            dpi = self.config['image_dpi']
            images = convert_from_path(
                file_path,
                dpi=dpi,
                fmt='PNG',
                thread_count=2,  # Limit threads to avoid memory issues
                timeout=self.config['processing_timeout_seconds']
            )

            if len(images) > self.config['max_pages']:
                raise ValueError(f"PDF has {len(images)} pages, maximum allowed is {self.config['max_pages']}")

            page_info = []

            for page_num, image in enumerate(images, 1):
                # Save image
                image_filename = f"page_{page_num:03d}.png"
                image_path = session_dir / image_filename

                # Optimize image for web viewing while preserving OCR quality
                image = self._optimize_image_for_ocr(image)
                image.save(image_path, 'PNG', optimize=True)

                page_info.append({
                    'page_number': page_num,
                    'image_path': str(image_path),
                    'width': image.width,
                    'height': image.height,
                    'file_size': os.path.getsize(image_path)
                })

                logger.debug(f"Converted page {page_num}: {image.width}x{image.height}")

            logger.info(f"Successfully converted {len(images)} pages to images")
            return page_info

        except Exception as e:
            logger.error(f"Error converting PDF to images: {e}")
            raise

    def _optimize_image_for_ocr(self, image: Image.Image) -> Image.Image:
        """
        Optimize image for better OCR results

        Args:
            image: PIL Image object

        Returns:
            Optimized PIL Image
        """
        try:
            # Convert to RGB if necessary
            if image.mode not in ('RGB', 'L'):
                image = image.convert('RGB')

            # Ensure minimum resolution for OCR
            min_width, min_height = 1200, 1600  # Minimum dimensions for good OCR
            if image.width < min_width or image.height < min_height:
                scale_factor = max(min_width / image.width, min_height / image.height)
                new_width = int(image.width * scale_factor)
                new_height = int(image.height * scale_factor)
                image = image.resize((new_width, new_height), Image.Resampling.LANCZOS)

            # Limit maximum resolution to control file size
            max_width, max_height = 3000, 4000
            if image.width > max_width or image.height > max_height:
                scale_factor = min(max_width / image.width, max_height / image.height)
                new_width = int(image.width * scale_factor)
                new_height = int(image.height * scale_factor)
                image = image.resize((new_width, new_height), Image.Resampling.LANCZOS)

            return image

        except Exception as e:
            logger.error(f"Error optimizing image: {e}")
            return image  # Return original if optimization fails

    def cleanup_session_files(self, session_id: str) -> bool:
        """
        Clean up temporary files for a session

        Args:
            session_id: Session identifier

        Returns:
            True if cleanup successful
        """
        try:
            session_dir = self.temp_dir / session_id
            if session_dir.exists():
                import shutil
                shutil.rmtree(session_dir)
                logger.info(f"Cleaned up session files: {session_id}")
            return True
        except Exception as e:
            logger.error(f"Error cleaning up session files: {e}")
            return False

    def get_page_image_path(self, session_id: str, page_number: int) -> Optional[str]:
        """
        Get the path to a specific page image

        Args:
            session_id: Session identifier
            page_number: Page number (1-based)

        Returns:
            Path to image file or None if not found
        """
        try:
            session_dir = self.temp_dir / session_id
            image_path = session_dir / f"page_{page_number:03d}.png"

            if image_path.exists():
                return str(image_path)
            return None

        except Exception as e:
            logger.error(f"Error getting page image path: {e}")
            return None

    def detect_table_regions(self, image_path: str) -> List[Dict[str, any]]:
        """
        Auto-detect potential table regions in a page image
        This is a basic implementation - can be enhanced with ML models

        Args:
            image_path: Path to page image

        Returns:
            List of detected regions with coordinates
        """
        try:
            # For now, return the full page as a single region
            # This can be enhanced with computer vision algorithms later
            image = Image.open(image_path)

            return [{
                'id': 'full_page',
                'confidence': 0.8,
                'coordinates': {
                    'x': 0,
                    'y': 0,
                    'width': image.width,
                    'height': image.height
                },
                'type': 'table_candidate'
            }]

        except Exception as e:
            logger.error(f"Error detecting table regions: {e}")
            return []