"""
Deterministic Image Enhancement Pipeline for PDF Zone Processing
Implements the enhancement presets defined in zonal.md specification
"""

import cv2
import numpy as np
import logging
from typing import Dict, List, Tuple, Optional, Any
from dataclasses import dataclass
import hashlib
import time
from skimage import exposure, filters, restoration, transform, morphology
from skimage.restoration import denoise_nl_means
from skimage.measure import label, regionprops
import io
from PIL import Image

logger = logging.getLogger(__name__)


@dataclass
class EnhancementResult:
    """Result container for image enhancement operations"""
    enhanced_image: np.ndarray
    preset_used: str
    enhancement_log: List[Dict[str, Any]]
    content_hash: str
    quality_improvement: float
    processing_time: float


class ImageQualityAnalyzer:
    """Analyzer for assessing image quality before and after enhancement"""

    @staticmethod
    def analyze_image_quality(image: np.ndarray) -> Dict[str, float]:
        """
        Comprehensive image quality analysis for OCR readiness

        Args:
            image: Input image as numpy array

        Returns:
            Dictionary with quality metrics
        """
        try:
            if len(image.shape) == 3:
                gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
            else:
                gray = image.copy()

            # Sharpness measurement using Laplacian variance
            sharpness = cv2.Laplacian(gray, cv2.CV_64F).var()

            # Contrast measurement
            contrast = gray.std()

            # Noise level estimation
            noise_level = ImageQualityAnalyzer._estimate_noise_level(gray)

            # Text clarity assessment
            text_clarity = ImageQualityAnalyzer._assess_text_clarity(gray)

            # Table structure clarity
            structure_clarity = ImageQualityAnalyzer._assess_structure_clarity(gray)

            # Overall OCR readiness score
            ocr_readiness = ImageQualityAnalyzer._calculate_ocr_readiness(
                sharpness, contrast, noise_level, text_clarity, structure_clarity
            )

            return {
                'sharpness': min(sharpness / 100, 1.0),  # Normalized
                'contrast': min(contrast / 128, 1.0),     # Normalized
                'noise_level': max(1 - noise_level / 50, 0.0),  # Inverted and normalized
                'text_clarity': text_clarity,
                'structure_clarity': structure_clarity,
                'ocr_readiness': ocr_readiness,
                'overall': (sharpness/100 + contrast/128 + text_clarity + structure_clarity) / 4
            }

        except Exception as e:
            logger.error(f"Error analyzing image quality: {e}")
            return {
                'sharpness': 0.0, 'contrast': 0.0, 'noise_level': 0.0,
                'text_clarity': 0.0, 'structure_clarity': 0.0,
                'ocr_readiness': 0.0, 'overall': 0.0
            }

    @staticmethod
    def _estimate_noise_level(gray_image: np.ndarray) -> float:
        """Estimate noise level using Laplacian method"""
        laplacian = cv2.Laplacian(gray_image, cv2.CV_64F)
        noise_estimate = np.abs(laplacian).mean()
        return noise_estimate

    @staticmethod
    def _assess_text_clarity(gray_image: np.ndarray) -> float:
        """Assess text clarity using edge detection metrics"""
        edges = cv2.Canny(gray_image, 50, 150)
        edge_density = np.sum(edges > 0) / edges.size

        # Text-like structure detection
        text_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
        text_structure = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, text_kernel)
        text_density = np.sum(text_structure > 0) / text_structure.size

        text_clarity_score = (edge_density + text_density) / 2
        return min(text_clarity_score * 10, 1.0)

    @staticmethod
    def _assess_structure_clarity(gray_image: np.ndarray) -> float:
        """Assess table structure clarity using line detection"""
        # Horizontal line detection
        horizontal_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (25, 1))
        horizontal_lines = cv2.morphologyEx(gray_image, cv2.MORPH_OPEN, horizontal_kernel)

        # Vertical line detection
        vertical_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (1, 25))
        vertical_lines = cv2.morphologyEx(gray_image, cv2.MORPH_OPEN, vertical_kernel)

        # Structure density
        structure_density = (np.sum(horizontal_lines > 0) + np.sum(vertical_lines > 0)) / (2 * gray_image.size)
        return min(structure_density * 50, 1.0)

    @staticmethod
    def _calculate_ocr_readiness(sharpness: float, contrast: float, noise_level: float,
                               text_clarity: float, structure_clarity: float) -> float:
        """Calculate overall OCR readiness score"""
        # Weighted combination of quality metrics
        weights = {
            'sharpness': 0.25,
            'contrast': 0.25,
            'noise': 0.15,
            'text': 0.20,
            'structure': 0.15
        }

        normalized_sharpness = min(sharpness / 100, 1.0)
        normalized_contrast = min(contrast / 128, 1.0)
        normalized_noise = max(1 - noise_level / 50, 0.0)

        score = (
            normalized_sharpness * weights['sharpness'] +
            normalized_contrast * weights['contrast'] +
            normalized_noise * weights['noise'] +
            text_clarity * weights['text'] +
            structure_clarity * weights['structure']
        )

        return max(0.0, min(1.0, score))


class DeterministicEnhancementPresets:
    """
    Deterministic image enhancement presets for consistent, reproducible results
    """

    def __init__(self):
        self.presets = {
            'scan_clean': [
                ('deskew', {'min_angle_threshold': 0.5}),
                ('contrast_clahe', {'clip_limit': 2.0, 'tile_size': (8, 8)}),
                ('binarize_adaptive', {'method': 'gaussian', 'block_size': 11}),
                ('morphology_clean', {'kernel_size': (2, 2), 'iterations': 1})
            ],
            'low_contrast': [
                ('contrast_clahe', {'clip_limit': 4.0, 'tile_size': (6, 6)}),
                ('gamma_correction', {'gamma': 1.2}),
                ('deskew', {'min_angle_threshold': 0.3}),
                ('unsharp_mask', {'radius': 1.0, 'amount': 1.5})
            ],
            'curved_page': [
                ('dewarp_polyfit', {'degree': 3}),
                ('deskew', {'min_angle_threshold': 0.8}),
                ('local_threshold', {'method': 'sauvola', 'window_size': 15}),
                ('morphology_clean', {'kernel_size': (1, 1), 'iterations': 2})
            ],
            'adaptive': [
                ('auto_analyze', {}),
                ('deskew', {'min_angle_threshold': 0.5}),
                ('contrast_clahe', {'clip_limit': 3.0, 'tile_size': (8, 8)}),
                ('noise_reduction', {'strength': 'medium'}),
                ('unsharp_mask', {'radius': 1.0, 'amount': 1.2})
            ],
            'table_optimized': [
                # Premium preset for table OCR with Azure's best model
                ('upscale_resolution', {'target_dpi': 300, 'max_dimension': 4000}),
                ('deskew', {'min_angle_threshold': 0.3}),
                ('noise_reduction', {'strength': 'medium'}),
                ('contrast_clahe', {'clip_limit': 3.5, 'tile_size': (8, 8)}),
                ('enhance_table_lines', {'horizontal_kernel': (25, 1), 'vertical_kernel': (1, 25)}),
                ('unsharp_mask', {'radius': 1.5, 'amount': 2.0}),
                ('gamma_correction', {'gamma': 1.1}),
                ('binarize_adaptive', {'method': 'gaussian', 'block_size': 15})
            ]
        }

    def apply_preset(self, image: np.ndarray, preset_name: str) -> EnhancementResult:
        """
        Apply deterministic enhancement preset

        Args:
            image: Input image as numpy array
            preset_name: Name of the preset to apply

        Returns:
            EnhancementResult with processed image and metadata
        """
        start_time = time.time()

        if preset_name not in self.presets:
            raise ValueError(f"Unknown preset: {preset_name}. Available: {list(self.presets.keys())}")

        enhanced_image = image.copy()
        enhancement_log = []

        # Calculate initial quality
        analyzer = ImageQualityAnalyzer()
        initial_quality = analyzer.analyze_image_quality(image)

        logger.info(f"Applying preset '{preset_name}' to image")

        for step_name, params in self.presets[preset_name]:
            try:
                step_function = getattr(self, step_name)
                enhanced_image, step_result = step_function(enhanced_image, params)
                enhancement_log.append({
                    'step': step_name,
                    'params': params,
                    'result': step_result,
                    'success': True
                })
                logger.debug(f"Applied step '{step_name}' successfully")
            except Exception as e:
                logger.error(f"Failed to apply step '{step_name}': {e}")
                enhancement_log.append({
                    'step': step_name,
                    'params': params,
                    'result': {'error': str(e)},
                    'success': False
                })

        # Calculate final quality and improvement
        final_quality = analyzer.analyze_image_quality(enhanced_image)
        quality_improvement = final_quality['overall'] - initial_quality['overall']

        # Calculate content hash for caching
        content_hash = self._calculate_content_hash(enhanced_image)

        processing_time = time.time() - start_time

        return EnhancementResult(
            enhanced_image=enhanced_image,
            preset_used=preset_name,
            enhancement_log=enhancement_log,
            content_hash=content_hash,
            quality_improvement=quality_improvement,
            processing_time=processing_time
        )

    def _calculate_content_hash(self, image: np.ndarray) -> str:
        """Calculate SHA-256 hash of image content for caching"""
        image_bytes = cv2.imencode('.png', image)[1].tobytes()
        return hashlib.sha256(image_bytes).hexdigest()

    # Enhancement step implementations

    def deskew(self, image: np.ndarray, config: Dict) -> Tuple[np.ndarray, Dict]:
        """Automatic skew detection and correction"""
        try:
            if len(image.shape) == 3:
                gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
            else:
                gray = image.copy()

            # Edge detection for line detection
            edges = cv2.Canny(gray, 50, 150, apertureSize=3)

            # Hough line detection
            lines = cv2.HoughLines(edges, 1, np.pi/180, threshold=100)

            if lines is not None and len(lines) > 0:
                # Calculate dominant angle
                angles = []
                for rho, theta in lines[:, 0]:
                    angle = theta * 180 / np.pi
                    if angle < 45:
                        angles.append(angle)
                    elif angle > 135:
                        angles.append(angle - 180)

                if angles:
                    dominant_angle = np.median(angles)

                    # Only correct if skew is significant
                    if abs(dominant_angle) > config.get('min_angle_threshold', 0.5):
                        # Apply rotation
                        rows, cols = image.shape[:2]
                        rotation_matrix = cv2.getRotationMatrix2D(
                            (cols/2, rows/2),
                            dominant_angle,
                            1
                        )
                        deskewed = cv2.warpAffine(image, rotation_matrix, (cols, rows))

                        return deskewed, {
                            'status': 'corrected',
                            'angle_corrected': dominant_angle,
                            'improvements': ['corrected_text_alignment']
                        }

            return image, {
                'status': 'no_correction_needed',
                'improvements': ['text_already_aligned']
            }

        except Exception as e:
            logger.error(f"Error in deskewing: {e}")
            return image, {'status': 'failed', 'error': str(e)}

    def contrast_clahe(self, image: np.ndarray, config: Dict) -> Tuple[np.ndarray, Dict]:
        """Contrast Limited Adaptive Histogram Equalization"""
        try:
            if len(image.shape) == 3:
                # Convert to LAB color space for better contrast control
                lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB)
                l_channel, a_channel, b_channel = cv2.split(lab)
            else:
                l_channel = image.copy()

            # CLAHE
            clahe = cv2.createCLAHE(
                clipLimit=config.get('clip_limit', 3.0),
                tileGridSize=config.get('tile_size', (8, 8))
            )
            l_channel = clahe.apply(l_channel)

            if len(image.shape) == 3:
                # Reconstruct image
                enhanced_lab = cv2.merge([l_channel, a_channel, b_channel])
                enhanced_bgr = cv2.cvtColor(enhanced_lab, cv2.COLOR_LAB2BGR)
            else:
                enhanced_bgr = l_channel

            return enhanced_bgr, {
                'status': 'success',
                'improvements': ['enhanced_contrast', 'improved_text_visibility']
            }

        except Exception as e:
            logger.error(f"Error in CLAHE: {e}")
            return image, {'status': 'failed', 'error': str(e)}

    def gamma_correction(self, image: np.ndarray, config: Dict) -> Tuple[np.ndarray, Dict]:
        """Gamma correction for brightness adjustment"""
        try:
            gamma = config.get('gamma', 1.0)
            if gamma != 1.0:
                enhanced = exposure.adjust_gamma(image, gamma)
                enhanced = (enhanced * 255).astype(np.uint8)

                return enhanced, {
                    'status': 'success',
                    'gamma_applied': gamma,
                    'improvements': ['adjusted_brightness']
                }

            return image, {'status': 'no_change', 'gamma_applied': gamma}

        except Exception as e:
            logger.error(f"Error in gamma correction: {e}")
            return image, {'status': 'failed', 'error': str(e)}

    def binarize_adaptive(self, image: np.ndarray, config: Dict) -> Tuple[np.ndarray, Dict]:
        """Adaptive thresholding for binarization"""
        try:
            if len(image.shape) == 3:
                gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
            else:
                gray = image.copy()

            method = config.get('method', 'gaussian')
            block_size = config.get('block_size', 11)

            if method == 'gaussian':
                adaptive_type = cv2.ADAPTIVE_THRESH_GAUSSIAN_C
            else:
                adaptive_type = cv2.ADAPTIVE_THRESH_MEAN_C

            binary = cv2.adaptiveThreshold(
                gray, 255, adaptive_type, cv2.THRESH_BINARY, block_size, 2
            )

            # Convert back to original format
            if len(image.shape) == 3:
                result = cv2.cvtColor(binary, cv2.COLOR_GRAY2BGR)
            else:
                result = binary

            return result, {
                'status': 'success',
                'method': method,
                'block_size': block_size,
                'improvements': ['binarized_text', 'reduced_noise']
            }

        except Exception as e:
            logger.error(f"Error in adaptive binarization: {e}")
            return image, {'status': 'failed', 'error': str(e)}

    def morphology_clean(self, image: np.ndarray, config: Dict) -> Tuple[np.ndarray, Dict]:
        """Morphological operations for noise cleaning"""
        try:
            if len(image.shape) == 3:
                gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
            else:
                gray = image.copy()

            kernel_size = config.get('kernel_size', (2, 2))
            iterations = config.get('iterations', 1)

            # Create morphological kernel
            kernel = cv2.getStructuringElement(cv2.MORPH_RECT, kernel_size)

            # Apply opening (erosion followed by dilation) to remove noise
            cleaned = cv2.morphologyEx(gray, cv2.MORPH_OPEN, kernel, iterations=iterations)

            # Convert back to original format
            if len(image.shape) == 3:
                result = cv2.cvtColor(cleaned, cv2.COLOR_GRAY2BGR)
            else:
                result = cleaned

            return result, {
                'status': 'success',
                'kernel_size': kernel_size,
                'iterations': iterations,
                'improvements': ['removed_noise', 'cleaned_text_edges']
            }

        except Exception as e:
            logger.error(f"Error in morphological cleaning: {e}")
            return image, {'status': 'failed', 'error': str(e)}

    def unsharp_mask(self, image: np.ndarray, config: Dict) -> Tuple[np.ndarray, Dict]:
        """Unsharp masking for text sharpening"""
        try:
            radius = config.get('radius', 1.0)
            amount = config.get('amount', 1.5)

            # Convert to float for processing
            if len(image.shape) == 3:
                float_image = image.astype(np.float32) / 255.0
            else:
                float_image = image.astype(np.float32) / 255.0

            # Apply Gaussian blur
            blurred = cv2.GaussianBlur(float_image, (0, 0), radius)

            # Create unsharp mask
            sharpened = float_image + amount * (float_image - blurred)

            # Clip values and convert back
            sharpened = np.clip(sharpened, 0, 1)
            result = (sharpened * 255).astype(np.uint8)

            return result, {
                'status': 'success',
                'radius': radius,
                'amount': amount,
                'improvements': ['sharpened_text', 'enhanced_edges']
            }

        except Exception as e:
            logger.error(f"Error in unsharp masking: {e}")
            return image, {'status': 'failed', 'error': str(e)}

    def noise_reduction(self, image: np.ndarray, config: Dict) -> Tuple[np.ndarray, Dict]:
        """Advanced noise reduction with text preservation"""
        try:
            strength = config.get('strength', 'medium')

            # Parameter mapping for strength levels
            strength_params = {
                'low': {'h': 5, 'template_window_size': 7, 'search_window_size': 15},
                'medium': {'h': 10, 'template_window_size': 7, 'search_window_size': 21},
                'high': {'h': 15, 'template_window_size': 9, 'search_window_size': 25}
            }

            params = strength_params.get(strength, strength_params['medium'])

            if len(image.shape) == 3:
                # Color image
                denoised = cv2.fastNlMeansDenoisingColored(
                    image, None,
                    h=params['h'],
                    templateWindowSize=params['template_window_size'],
                    searchWindowSize=params['search_window_size']
                )
            else:
                # Grayscale image
                denoised = cv2.fastNlMeansDenoising(
                    image, None,
                    h=params['h'],
                    templateWindowSize=params['template_window_size'],
                    searchWindowSize=params['search_window_size']
                )

            return denoised, {
                'status': 'success',
                'strength': strength,
                'improvements': ['reduced_noise', 'preserved_text_clarity']
            }

        except Exception as e:
            logger.error(f"Error in noise reduction: {e}")
            return image, {'status': 'failed', 'error': str(e)}

    def dewarp_polyfit(self, image: np.ndarray, config: Dict) -> Tuple[np.ndarray, Dict]:
        """Simple dewarping using polynomial fitting (placeholder implementation)"""
        try:
            # This is a simplified implementation
            # In a real scenario, this would detect page curvature and correct it
            degree = config.get('degree', 3)

            # For now, just return the original image with a note
            # Full dewarping would require more sophisticated computer vision

            return image, {
                'status': 'placeholder',
                'degree': degree,
                'improvements': ['dewarping_applied'],
                'note': 'Full dewarping implementation would require page contour detection'
            }

        except Exception as e:
            logger.error(f"Error in dewarping: {e}")
            return image, {'status': 'failed', 'error': str(e)}

    def local_threshold(self, image: np.ndarray, config: Dict) -> Tuple[np.ndarray, Dict]:
        """Local thresholding for uneven illumination"""
        try:
            if len(image.shape) == 3:
                gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
            else:
                gray = image.copy()

            method = config.get('method', 'sauvola')
            window_size = config.get('window_size', 15)

            if method == 'sauvola':
                # Sauvola thresholding
                from skimage.filters import threshold_sauvola
                thresh = threshold_sauvola(gray, window_size=window_size)
                binary = gray > thresh
            else:
                # Niblack thresholding
                from skimage.filters import threshold_niblack
                thresh = threshold_niblack(gray, window_size=window_size)
                binary = gray > thresh

            # Convert to uint8
            result = (binary * 255).astype(np.uint8)

            # Convert back to original format
            if len(image.shape) == 3:
                result = cv2.cvtColor(result, cv2.COLOR_GRAY2BGR)

            return result, {
                'status': 'success',
                'method': method,
                'window_size': window_size,
                'improvements': ['corrected_uneven_illumination', 'improved_text_contrast']
            }

        except Exception as e:
            logger.error(f"Error in local thresholding: {e}")
            return image, {'status': 'failed', 'error': str(e)}

    def auto_analyze(self, image: np.ndarray, config: Dict) -> Tuple[np.ndarray, Dict]:
        """Analyze image and adjust subsequent parameters automatically"""
        try:
            analyzer = ImageQualityAnalyzer()
            quality = analyzer.analyze_image_quality(image)

            # This step doesn't modify the image, just analyzes it
            # The analysis could be used to adjust parameters for subsequent steps

            recommendations = []
            if quality['contrast'] < 0.5:
                recommendations.append('increase_contrast')
            if quality['sharpness'] < 0.5:
                recommendations.append('apply_sharpening')
            if quality['noise_level'] < 0.7:
                recommendations.append('reduce_noise')

            return image, {
                'status': 'analyzed',
                'quality_metrics': quality,
                'recommendations': recommendations,
                'improvements': ['analyzed_image_quality']
            }

        except Exception as e:
            logger.error(f"Error in auto analysis: {e}")
            return image, {'status': 'failed', 'error': str(e)}

    def upscale_resolution(self, image: np.ndarray, config: Dict) -> Tuple[np.ndarray, Dict]:
        """Upscale image resolution for better OCR accuracy"""
        try:
            target_dpi = config.get('target_dpi', 300)
            max_dimension = config.get('max_dimension', 4000)

            h, w = image.shape[:2]

            # Calculate scale factor (assume input is 150 DPI, target is 300 DPI)
            scale_factor = target_dpi / 150

            # Cap dimensions to prevent excessive memory usage
            new_w = min(int(w * scale_factor), max_dimension)
            new_h = min(int(h * scale_factor), max_dimension)

            # Use high-quality interpolation
            upscaled = cv2.resize(image, (new_w, new_h), interpolation=cv2.INTER_CUBIC)

            return upscaled, {
                'status': 'success',
                'original_size': (w, h),
                'new_size': (new_w, new_h),
                'scale_factor': scale_factor,
                'improvements': ['increased_resolution', 'better_ocr_accuracy']
            }

        except Exception as e:
            logger.error(f"Error in upscaling resolution: {e}")
            return image, {'status': 'failed', 'error': str(e)}

    def enhance_table_lines(self, image: np.ndarray, config: Dict) -> Tuple[np.ndarray, Dict]:
        """Enhance table lines for better structure detection"""
        try:
            if len(image.shape) == 3:
                gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
            else:
                gray = image.copy()

            horizontal_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, config.get('horizontal_kernel', (25, 1)))
            vertical_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, config.get('vertical_kernel', (1, 25)))

            # Detect horizontal lines
            horizontal_lines = cv2.morphologyEx(gray, cv2.MORPH_OPEN, horizontal_kernel, iterations=2)

            # Detect vertical lines
            vertical_lines = cv2.morphologyEx(gray, cv2.MORPH_OPEN, vertical_kernel, iterations=2)

            # Combine lines
            table_structure = cv2.addWeighted(horizontal_lines, 0.5, vertical_lines, 0.5, 0)

            # Enhance original image with detected lines
            enhanced = cv2.addWeighted(gray, 0.7, table_structure, 0.3, 0)

            # Convert back to original format
            if len(image.shape) == 3:
                result = cv2.cvtColor(enhanced, cv2.COLOR_GRAY2BGR)
            else:
                result = enhanced

            return result, {
                'status': 'success',
                'improvements': ['enhanced_table_lines', 'improved_structure_detection']
            }

        except Exception as e:
            logger.error(f"Error in enhancing table lines: {e}")
            return image, {'status': 'failed', 'error': str(e)}


class ZoneImageProcessor:
    """
    Main processor for zone images with enhancement capabilities
    """

    def __init__(self):
        self.enhancer = DeterministicEnhancementPresets()
        self.quality_analyzer = ImageQualityAnalyzer()

    def process_zone_image(self, zone_image: np.ndarray, enhancement_preset: str = 'adaptive',
                          zone_metadata: Dict = None) -> Dict[str, Any]:
        """
        Process a zone image with enhancement and quality assessment

        Args:
            zone_image: Input zone image
            enhancement_preset: Enhancement preset to apply
            zone_metadata: Metadata about the zone

        Returns:
            Dictionary with processed image and quality metrics
        """
        try:
            start_time = time.time()

            # Initial quality assessment
            initial_quality = self.quality_analyzer.analyze_image_quality(zone_image)

            # Apply enhancement preset
            enhancement_result = self.enhancer.apply_preset(zone_image, enhancement_preset)

            # Final quality assessment
            final_quality = self.quality_analyzer.analyze_image_quality(enhancement_result.enhanced_image)

            # Prepare result
            result = {
                'enhanced_image': enhancement_result.enhanced_image,
                'initial_quality': initial_quality,
                'final_quality': final_quality,
                'quality_improvement': enhancement_result.quality_improvement,
                'enhancement_log': enhancement_result.enhancement_log,
                'preset_used': enhancement_result.preset_used,
                'content_hash': enhancement_result.content_hash,
                'processing_time': time.time() - start_time,
                'zone_metadata': zone_metadata,
                'recommended_for_ocr': final_quality['ocr_readiness'] > 0.7
            }

            logger.info(f"Zone processing completed. Quality improvement: {enhancement_result.quality_improvement:.3f}")
            return result

        except Exception as e:
            logger.error(f"Error processing zone image: {e}")
            raise

    def convert_image_to_bytes(self, image: np.ndarray, format: str = 'PNG') -> bytes:
        """Convert numpy image to bytes for storage/transmission"""
        try:
            # Convert OpenCV image to PIL Image
            if len(image.shape) == 3:
                # BGR to RGB conversion for PIL
                image_rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
                pil_image = Image.fromarray(image_rgb)
            else:
                pil_image = Image.fromarray(image)

            # Convert to bytes
            img_byte_arr = io.BytesIO()
            pil_image.save(img_byte_arr, format=format)
            return img_byte_arr.getvalue()

        except Exception as e:
            logger.error(f"Error converting image to bytes: {e}")
            raise