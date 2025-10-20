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

    def crop_zone_from_image(self, image_path: str, coordinates: Dict[str, int]) -> Image.Image:
        """
        Crop a specific zone from a page image

        Args:
            image_path: Path to page image
            coordinates: Dict with x, y, width, height in pixels

        Returns:
            PIL Image of the cropped zone
        """
        try:
            image = Image.open(image_path)

            # Extract coordinates
            x = coordinates.get('x', 0)
            y = coordinates.get('y', 0)
            width = coordinates.get('width', image.width)
            height = coordinates.get('height', image.height)

            # Calculate crop box (left, top, right, bottom)
            left = x
            top = y
            right = x + width
            bottom = y + height

            # Ensure coordinates are within image bounds
            left = max(0, min(left, image.width))
            top = max(0, min(top, image.height))
            right = max(0, min(right, image.width))
            bottom = max(0, min(bottom, image.height))

            # Crop the image
            cropped = image.crop((left, top, right, bottom))

            logger.debug(f"Cropped zone: ({left}, {top}, {right}, {bottom}) from {image.width}x{image.height}")

            return cropped

        except Exception as e:
            logger.error(f"Error cropping zone from image: {e}")
            raise

    def enhance_zone_image(self, image: Image.Image, preset: str = 'adaptive') -> Image.Image:
        """
        Enhance a cropped zone image to improve OCR/table detection.

        Presets:
        - 'none': return original image
        - 'basic': grayscale + CLAHE + light sharpen
        - 'adaptive' (default): grayscale + CLAHE + adaptive threshold + morphology + de-noise + sharpen

        Args:
            image: PIL Image for the zone
            preset: enhancement preset name

        Returns:
            Enhanced PIL Image (8-bit single channel or 3-channel)
        """
        try:
            if image is None:
                return image

            import numpy as np
            import cv2

            # Convert PIL -> OpenCV (BGR)
            img = np.array(image)
            if img.ndim == 2:
                gray = img
            else:
                gray = cv2.cvtColor(img, cv2.COLOR_RGB2GRAY)

            # Auto-select best preset if requested or unspecified
            if preset is None or preset == 'auto':
                preset = self._choose_enhancement_preset(gray)

            # Contrast Limited Adaptive Histogram Equalization (CLAHE)
            clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
            eq = clahe.apply(gray)

            if preset == 'basic':
                # Light unsharp masking
                blur = cv2.GaussianBlur(eq, (0, 0), sigmaX=1.0)
                sharp = cv2.addWeighted(eq, 1.5, blur, -0.5, 0)
                return Image.fromarray(sharp)

            # 'adaptive' preset
            # Adaptive threshold to clean background and enhance text/lines
            th = cv2.adaptiveThreshold(eq, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                                       cv2.THRESH_BINARY, 31, 10)

            # Morphology to strengthen grid lines and separate text
            # Use small kernels to avoid over-connecting characters
            kernel_h = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 1))
            kernel_v = cv2.getStructuringElement(cv2.MORPH_RECT, (1, 3))
            morph_h = cv2.morphologyEx(th, cv2.MORPH_CLOSE, kernel_h, iterations=1)
            morph_v = cv2.morphologyEx(th, cv2.MORPH_CLOSE, kernel_v, iterations=1)
            morph = cv2.bitwise_or(morph_h, morph_v)

            # Denoise small speckles
            morph = cv2.medianBlur(morph, 3)

            # Optional slight sharpening on inverted text for clarity
            inv = 255 - morph
            blur = cv2.GaussianBlur(inv, (0, 0), sigmaX=1.0)
            sharp_inv = cv2.addWeighted(inv, 1.4, blur, -0.4, 0)
            enhanced = 255 - sharp_inv

            return Image.fromarray(enhanced)

        except Exception as e:
            logger.error(f"Error enhancing zone image (preset={preset}): {e}")
            # Fail-safe: return original
            return image

    def _choose_enhancement_preset(self, gray_img) -> str:
        """
        Heuristically select an enhancement preset based on image quality metrics.

        Metrics:
        - Sharpness: variance of Laplacian
        - Contrast: stddev of intensities
        - Dynamic range: P95 - P5 percentiles
        """
        import numpy as np
        import cv2

        try:
            # Ensure uint8 grayscale
            if gray_img.dtype != np.uint8:
                gray = cv2.normalize(gray_img, None, 0, 255, cv2.NORM_MINMAX).astype(np.uint8)
            else:
                gray = gray_img

            # Sharpness via Laplacian variance
            var_lap = cv2.Laplacian(gray, cv2.CV_64F).var()

            # Contrast via stddev and percentile range
            stddev = float(np.std(gray))
            p5, p95 = np.percentile(gray, [5, 95])
            dyn_range = float(p95 - p5)

            # Simple rules of thumb (tuned conservatively)
            # Low sharpness OR low contrast -> adaptive
            if var_lap < 80 or stddev < 25 or dyn_range < 35:
                logger.info(f"🧮 Enhance:auto -> adaptive | varLap={var_lap:.1f} std={stddev:.1f} dyn={dyn_range:.1f}")
                return 'adaptive'

            # Good sharpness and contrast -> basic
            if var_lap >= 150 and stddev >= 35 and dyn_range >= 45:
                logger.info(f"🧮 Enhance:auto -> basic | varLap={var_lap:.1f} std={stddev:.1f} dyn={dyn_range:.1f}")
                return 'basic'

            # Mid-case -> basic (safer than none)
            logger.info(f"🧮 Enhance:auto -> basic(mid) | varLap={var_lap:.1f} std={stddev:.1f} dyn={dyn_range:.1f}")
            return 'basic'
        except Exception:
            # On failure, default to adaptive
            logger.info("🧮 Enhance:auto -> adaptive (metrics error)")
            return 'adaptive'
