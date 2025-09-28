# Advanced Zonal Mapping Specification
## Enhanced PDF OCR with Header-First Selection & Image Enhancement

### Document Overview
This specification details an advanced zonal mapping system for PDF OCR integration that prioritizes user experience and OCR accuracy through header-first selection, intelligent multi-page handling, and comprehensive image enhancement pipelines.

---

## Table of Contents
1. [Enhanced User Experience Flow](#enhanced-user-experience-flow)
2. [Header-First Selection Strategy](#header-first-selection-strategy)
3. [Multi-Page Continuation Intelligence](#multi-page-continuation-intelligence)
4. [Image Enhancement Pipeline](#image-enhancement-pipeline)
5. [Post-Zonal Content Enhancement Model](#post-zonal-content-enhancement-model)
6. [Zone Data Model & Versioning](#zone-data-model--versioning)
7. [API Specification & Concurrency](#api-specification--concurrency)
8. [Technical Implementation](#technical-implementation)
9. [Quality Assurance System](#quality-assurance-system)
10. [Performance Optimization](#performance-optimization)
11. [Acceptance Criteria & Migration Plan](#acceptance-criteria--migration-plan)

---

## Enhanced User Experience Flow

### Complete User Journey
```
PDF Upload → Page Preview → Header Selection → Table Boundary Detection →
Multi-Page Linking → Image Enhancement → OCR Processing →
Content Enhancement → Header Validation → Column Mapping
```

### Phase 1: PDF Upload & Page Preview
**User Experience**:
- Drag & drop PDF upload with instant preview
- Page thumbnails with zoom controls
- Page navigation with keyboard shortcuts
- Quality assessment notification (resolution, scan quality)

**Smart Features**:
- Automatic page orientation detection
- Quality warnings for low-resolution pages
- Suggested DPI enhancement for scanned documents

### Phase 2: Header Selection (NEW APPROACH)
**User Experience**:
- **Header-First Strategy**: Select headers before table boundaries
- **Multi-row header grouping**: Drag-to-merge header cells for complex headers
- **Keyboard shortcuts**: `G` to group cells, `M` to merge, `P` to promote row to header
- **Selection ergonomics**: Snap-to-lines + magnetism to detected borders
- **Advanced selection**: Marquee multi-select, nudge zones with arrow keys (Shift=10px)
- **Visual enhancements**: Hover ghost lines, high-contrast selection outlines
- **Undo/Redo**: Lightweight history stack per page with Ctrl+Z/Ctrl+Y
- **Autosave**: Global autosave with session recovery on reload
- **Sample preview**: Live 3-5 row preview per zone with column alignment overlay
- **Preview modes**: Toggle between "raw" vs "normalized" text display
- **Accessibility**: Keyboard-only controls, screen-reader labels, large hit targets

**Interface Elements**:
```javascript
// Header Selection Interface
const HeaderSelector = () => {
  return (
    <div className="header-selection-interface">
      <HeaderDrawingCanvas />
      <HeaderPreview />
      <CrossPageConsistency />
      <SmartSuggestions />
    </div>
  );
};
```

### Phase 3: Table Boundary Detection
**User Experience**:
- Automatic table boundary suggestions based on headers
- Smart column alignment detection
- Adjustable table boundaries with snap-to-grid
- Data preview for validation

### Phase 4: Multi-Page Continuation
**User Experience**:
- **Visual chains**: Page linking visualization (Page 3 → 4 → 5) with connection indicators
- **Per-link confidence**: Individual confidence scores for each page connection
- **Reflow preview**: Live preview showing concatenated table from linked zones
- **Gap detection**: Automatic detection and warnings for missing pages in chains
- **Column drift handling**: Allow slight width variations with elastic mapping
- **Continuation tokens**: Detection of "cont.", "continued" indicators in tables

### Phase 5: Image Enhancement Preview
**User Experience**:
- Before/after enhancement preview
- Enhancement strength controls
- Quality improvement indicators
- Manual fine-tuning options

---

## Header-First Selection Strategy

### Why Header-First Approach?

**Traditional Approach Problems**:
- Users select entire table zones without context
- Headers mixed with data confuse OCR
- Column alignment issues
- Inconsistent header detection

**Header-First Benefits**:
- Headers guide table structure understanding
- Better column boundary detection
- Improved OCR accuracy for headers vs data
- Cleaner data extraction

### Implementation Strategy

#### Phase 1: Header Zone Selection
```javascript
const HeaderSelectionPhase = {
  objective: "Identify and extract table headers",
  tools: [
    "Smart header region detection",
    "Multi-row header support",
    "Cross-page header validation",
    "Header text confidence preview"
  ],
  validation: [
    "Header consistency across pages",
    "Column count validation",
    "Header text quality check"
  ]
};
```

#### Phase 2: Table Boundary Detection
```javascript
const TableBoundaryPhase = {
  objective: "Define data extraction zones based on headers",
  automation: [
    "Column-aligned boundary suggestions",
    "Data row detection",
    "Table end detection",
    "Multi-column span handling"
  ],
  userControl: [
    "Boundary adjustment tools",
    "Manual override capabilities",
    "Zone preview functionality"
  ]
};
```

### Header Selection Interface

#### Smart Header Detection
```python
class SmartHeaderDetector:
    def detect_header_regions(self, page_image):
        """
        Intelligent header region detection using:
        - Text density analysis
        - Font size detection
        - Horizontal line detection
        - Position-based heuristics
        """
        candidates = []

        # Font size analysis - headers typically larger
        large_text_regions = self.detect_large_text(page_image)

        # Position analysis - headers at top of tables
        top_regions = self.detect_top_positioned_text(page_image)

        # Line detection - headers often have underlines/borders
        bordered_regions = self.detect_bordered_text(page_image)

        # Combine and score candidates
        return self.score_header_candidates(candidates)

    def validate_header_consistency(self, headers_across_pages):
        """
        Validate header consistency across multiple pages
        """
        consistency_score = self.calculate_header_similarity(headers_across_pages)
        return {
            'score': consistency_score,
            'issues': self.identify_inconsistencies(headers_across_pages),
            'suggestions': self.suggest_corrections(headers_across_pages)
        }
```

#### Header Selection Components

**HeaderCanvas.js**
```javascript
const HeaderCanvas = ({ pageImage, onHeaderSelect }) => {
  const [headerZones, setHeaderZones] = useState([]);
  const [suggestionMode, setSuggestionMode] = useState(true);

  const handleHeaderDraw = (coordinates) => {
    const headerZone = {
      id: generateUniqueId(),
      coordinates,
      confidence: 0,
      extractedText: '',
      validated: false
    };

    // Immediate text extraction for preview
    extractHeaderPreview(headerZone);
    setHeaderZones([...headerZones, headerZone]);
  };

  return (
    <div className="header-canvas-container">
      <Canvas
        image={pageImage}
        onRectangleDraw={handleHeaderDraw}
        suggestions={suggestionMode}
        snapToGrid={true}
      />
      <HeaderPreviewPanel zones={headerZones} />
    </div>
  );
};
```

---

## Multi-Page Continuation Intelligence

### Smart Continuation Detection

#### Automatic Page Linking Strategy
```python
class MultiPageContinuationDetector:
    def __init__(self):
        self.column_structure_analyzer = ColumnStructureAnalyzer()
        self.header_consistency_validator = HeaderConsistencyValidator()

    def detect_table_continuations(self, pages_data):
        """
        Intelligent detection of table continuations across pages
        """
        continuations = []

        for i in range(len(pages_data) - 1):
            current_page = pages_data[i]
            next_page = pages_data[i + 1]

            # Header consistency check
            header_match = self.compare_headers(
                current_page['headers'],
                next_page['headers']
            )

            # Column structure alignment
            column_alignment = self.analyze_column_alignment(
                current_page['columns'],
                next_page['columns']
            )

            # Data pattern consistency
            data_pattern_match = self.analyze_data_patterns(
                current_page['sample_data'],
                next_page['sample_data']
            )

            continuation_confidence = self.calculate_continuation_confidence(
                header_match, column_alignment, data_pattern_match
            )

            if continuation_confidence > 0.7:
                continuations.append({
                    'from_page': i,
                    'to_page': i + 1,
                    'confidence': continuation_confidence,
                    'linking_strategy': self.determine_linking_strategy(
                        current_page, next_page
                    )
                })

        return continuations

    def compare_headers(self, headers1, headers2):
        """
        Compare headers between pages for consistency
        """
        if len(headers1) != len(headers2):
            return 0.0

        similarity_scores = []
        for h1, h2 in zip(headers1, headers2):
            similarity = self.calculate_text_similarity(h1, h2)
            similarity_scores.append(similarity)

        return np.mean(similarity_scores)

    def analyze_column_alignment(self, columns1, columns2):
        """
        Analyze column structure alignment between pages
        """
        if len(columns1) != len(columns2):
            return 0.0

        alignment_scores = []
        for c1, c2 in zip(columns1, columns2):
            # Check width similarity
            width_similarity = 1 - abs(c1['width'] - c2['width']) / max(c1['width'], c2['width'])

            # Check position similarity
            position_similarity = 1 - abs(c1['x'] - c2['x']) / max(c1['x'], c2['x'])

            alignment_scores.append((width_similarity + position_similarity) / 2)

        return np.mean(alignment_scores)
```

### Multi-Page User Interface

#### Page Linking Interface
```javascript
const MultiPageLinker = ({ pages, detectedContinuations }) => {
  const [manualLinks, setManualLinks] = useState([]);
  const [autoLinks, setAutoLinks] = useState(detectedContinuations);

  const renderPageConnection = (linkData) => {
    return (
      <div className="page-connection">
        <PageThumbnail page={linkData.from_page} />
        <ConnectionIndicator
          confidence={linkData.confidence}
          type={linkData.type}
        />
        <PageThumbnail page={linkData.to_page} />
        <ConfidenceScore score={linkData.confidence} />
      </div>
    );
  };

  return (
    <div className="multi-page-linker">
      <div className="auto-detected-links">
        <h3>Detected Continuations</h3>
        {autoLinks.map(renderPageConnection)}
      </div>

      <div className="manual-linking-tools">
        <PageGrid
          pages={pages}
          onManualLink={handleManualLink}
        />
      </div>
    </div>
  );
};
```

### Continuation Validation System

#### Cross-Page Validation
```python
class ContinuationValidator:
    def validate_continuation_quality(self, linked_pages):
        """
        Comprehensive validation of page continuations
        """
        validation_results = {
            'header_consistency': self.validate_headers(linked_pages),
            'column_alignment': self.validate_columns(linked_pages),
            'data_flow_continuity': self.validate_data_flow(linked_pages),
            'overall_quality': 0.0
        }

        # Calculate overall quality score
        validation_results['overall_quality'] = np.mean([
            validation_results['header_consistency']['score'],
            validation_results['column_alignment']['score'],
            validation_results['data_flow_continuity']['score']
        ])

        return validation_results

    def suggest_continuation_fixes(self, validation_results):
        """
        Provide actionable suggestions for improving continuation quality
        """
        suggestions = []

        if validation_results['header_consistency']['score'] < 0.8:
            suggestions.append({
                'type': 'header_alignment',
                'message': 'Headers appear misaligned across pages',
                'action': 'Review header selections on linked pages',
                'priority': 'high'
            })

        if validation_results['column_alignment']['score'] < 0.7:
            suggestions.append({
                'type': 'column_adjustment',
                'message': 'Column boundaries need adjustment',
                'action': 'Realign column boundaries for consistency',
                'priority': 'medium'
            })

        return suggestions
```

---

## Image Enhancement Pipeline

### Deterministic Enhancement Presets

Instead of adaptive enhancement, use fixed, reproducible preset pipelines for consistent results.

#### Enhancement Preset Architecture
```python
class DeterministicEnhancementPresets:
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
            ]
        }

    def apply_preset(self, image: np.ndarray, preset_name: str) -> EnhancementResult:
        """
        Apply deterministic enhancement preset
        """
        if preset_name not in self.presets:
            raise ValueError(f"Unknown preset: {preset_name}")

        enhanced_image = image.copy()
        enhancement_log = []

        for step_name, params in self.presets[preset_name]:
            step_function = getattr(self, step_name)
            enhanced_image, step_result = step_function(enhanced_image, params)
            enhancement_log.append({
                'step': step_name,
                'params': params,
                'result': step_result
            })

        return EnhancementResult(
            enhanced_image=enhanced_image,
            preset_used=preset_name,
            enhancement_log=enhancement_log,
            content_hash=self.calculate_content_hash(enhanced_image)
        )
```

#### Client-Side Enhancement with WebAssembly
```javascript
// Move enhancement to client-side for responsive previews
class ClientSideEnhancer {
  constructor() {
    this.wasmModule = null;
    this.worker = new Worker('/js/enhancement-worker.js');
  }

  async initializeWasm() {
    // Load OpenCV.js WebAssembly module
    this.wasmModule = await cv.ready;
  }

  async enhanceZonePreview(imageData, preset, onProgress) {
    return new Promise((resolve, reject) => {
      const enhancementTask = {
        id: generateTaskId(),
        imageData: imageData,
        preset: preset,
        timestamp: Date.now()
      };

      this.worker.postMessage({
        type: 'ENHANCE_ZONE',
        task: enhancementTask
      });

      this.worker.onmessage = (event) => {
        const { type, taskId, result, progress } = event.data;

        if (taskId !== enhancementTask.id) return;

        switch (type) {
          case 'ENHANCEMENT_PROGRESS':
            onProgress(progress);
            break;
          case 'ENHANCEMENT_COMPLETE':
            resolve(result);
            break;
          case 'ENHANCEMENT_ERROR':
            reject(new Error(result.error));
            break;
        }
      };
    });
  }

  // Cache enhanced images with content hash
  async cacheEnhancedImage(zoneId, enhancement) {
    const cacheKey = `enhanced_${zoneId}_${enhancement.content_hash}`;
    await this.imageCache.set(cacheKey, enhancement.enhanced_image);
  }
}
```

### Pre-OCR Enhancement Strategy

The image enhancement pipeline is critical for maximizing OCR accuracy. This multi-stage process transforms raw PDF zones into OCR-optimized images using deterministic presets.

#### Enhancement Pipeline Architecture
```python
class AdvancedImageEnhancer:
    def __init__(self):
        self.enhancement_pipeline = [
            self.noise_reduction,
            self.contrast_optimization,
            self.deskewing,
            self.border_cleanup,
            self.table_line_enhancement,
            self.text_sharpening,
            self.background_normalization
        ]

    def enhance_zone_for_ocr(self, zone_image, enhancement_strength='adaptive'):
        """
        Comprehensive image enhancement for optimal OCR results
        """
        enhanced_image = zone_image.copy()
        enhancement_log = []

        # Pre-enhancement analysis
        quality_metrics = self.analyze_image_quality(enhanced_image)

        # Adaptive enhancement based on image quality
        if enhancement_strength == 'adaptive':
            enhancement_config = self.determine_enhancement_config(quality_metrics)
        else:
            enhancement_config = self.get_preset_config(enhancement_strength)

        # Apply enhancement pipeline
        for enhancement_step in self.enhancement_pipeline:
            try:
                enhanced_image, step_log = enhancement_step(
                    enhanced_image,
                    enhancement_config
                )
                enhancement_log.append(step_log)
            except Exception as e:
                enhancement_log.append({
                    'step': enhancement_step.__name__,
                    'status': 'failed',
                    'error': str(e)
                })

        # Post-enhancement quality assessment
        final_quality = self.analyze_image_quality(enhanced_image)

        return {
            'enhanced_image': enhanced_image,
            'quality_improvement': final_quality['overall'] - quality_metrics['overall'],
            'enhancement_log': enhancement_log,
            'recommended_for_ocr': final_quality['ocr_readiness'] > 0.8
        }

    def noise_reduction(self, image, config):
        """
        Advanced noise reduction with preservation of text clarity
        """
        from skimage import restoration, filters
        import cv2

        # Convert to grayscale for processing
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

        # Non-local means denoising - excellent for text preservation
        denoised = cv2.fastNlMeansDenoising(
            gray,
            None,
            h=config.get('noise_reduction_strength', 10),
            templateWindowSize=7,
            searchWindowSize=21
        )

        # Gaussian filtering for fine noise
        gaussian_filtered = filters.gaussian(
            denoised,
            sigma=config.get('gaussian_sigma', 0.5)
        )

        # Convert back to BGR
        result = cv2.cvtColor(gaussian_filtered.astype(np.uint8), cv2.COLOR_GRAY2BGR)

        return result, {
            'step': 'noise_reduction',
            'status': 'success',
            'improvements': ['reduced_background_noise', 'preserved_text_edges']
        }

    def contrast_optimization(self, image, config):
        """
        Intelligent contrast enhancement for table content
        """
        import cv2
        from skimage import exposure

        # Convert to LAB color space for better contrast control
        lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB)
        l_channel, a_channel, b_channel = cv2.split(lab)

        # CLAHE (Contrast Limited Adaptive Histogram Equalization)
        clahe = cv2.createCLAHE(
            clipLimit=config.get('clahe_clip_limit', 3.0),
            tileGridSize=config.get('clahe_tile_size', (8, 8))
        )
        l_channel = clahe.apply(l_channel)

        # Reconstruct image
        enhanced_lab = cv2.merge([l_channel, a_channel, b_channel])
        enhanced_bgr = cv2.cvtColor(enhanced_lab, cv2.COLOR_LAB2BGR)

        # Additional gamma correction if needed
        gamma = config.get('gamma_correction', 1.0)
        if gamma != 1.0:
            enhanced_bgr = exposure.adjust_gamma(enhanced_bgr, gamma)

        return enhanced_bgr, {
            'step': 'contrast_optimization',
            'status': 'success',
            'improvements': ['enhanced_text_contrast', 'balanced_background']
        }

    def deskewing(self, image, config):
        """
        Automatic skew detection and correction
        """
        import cv2
        from skimage import transform

        # Convert to grayscale
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

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
                if abs(dominant_angle) > config.get('min_skew_threshold', 0.5):
                    # Apply rotation
                    rows, cols = image.shape[:2]
                    rotation_matrix = cv2.getRotationMatrix2D(
                        (cols/2, rows/2),
                        dominant_angle,
                        1
                    )
                    deskewed = cv2.warpAffine(image, rotation_matrix, (cols, rows))

                    return deskewed, {
                        'step': 'deskewing',
                        'status': 'success',
                        'angle_corrected': dominant_angle,
                        'improvements': ['corrected_text_alignment']
                    }

        return image, {
            'step': 'deskewing',
            'status': 'no_correction_needed',
            'improvements': ['text_already_aligned']
        }

    def table_line_enhancement(self, image, config):
        """
        Enhance table lines and borders for better structure detection
        """
        import cv2

        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

        # Horizontal line detection and enhancement
        horizontal_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (25, 1))
        horizontal_lines = cv2.morphologyEx(gray, cv2.MORPH_OPEN, horizontal_kernel)

        # Vertical line detection and enhancement
        vertical_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (1, 25))
        vertical_lines = cv2.morphologyEx(gray, cv2.MORPH_OPEN, vertical_kernel)

        # Combine line detections
        table_structure = cv2.addWeighted(horizontal_lines, 0.5, vertical_lines, 0.5, 0)

        # Enhance the original image with detected structure
        enhanced = cv2.addWeighted(gray, 0.8, table_structure, 0.2, 0)

        # Convert back to BGR
        result = cv2.cvtColor(enhanced, cv2.COLOR_GRAY2BGR)

        return result, {
            'step': 'table_line_enhancement',
            'status': 'success',
            'improvements': ['enhanced_table_structure', 'clearer_cell_boundaries']
        }

    def text_sharpening(self, image, config):
        """
        Sharpen text while preserving overall image quality
        """
        import cv2

        # Unsharp masking for text enhancement
        gaussian_blurred = cv2.GaussianBlur(image, (0, 0), 2.0)
        sharpened = cv2.addWeighted(image, 1.5, gaussian_blurred, -0.5, 0)

        return sharpened, {
            'step': 'text_sharpening',
            'status': 'success',
            'improvements': ['enhanced_text_clarity', 'improved_character_definition']
        }
```

### Enhancement Quality Assessment

#### Image Quality Analyzer
```python
class ImageQualityAnalyzer:
    def analyze_image_quality(self, image):
        """
        Comprehensive image quality analysis for OCR readiness
        """
        import cv2
        from skimage import measure, filters

        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

        # Sharpness measurement using Laplacian variance
        sharpness = cv2.Laplacian(gray, cv2.CV_64F).var()

        # Contrast measurement
        contrast = gray.std()

        # Noise level estimation
        noise_level = self.estimate_noise_level(gray)

        # Text clarity assessment
        text_clarity = self.assess_text_clarity(gray)

        # Table structure clarity
        structure_clarity = self.assess_structure_clarity(gray)

        # Overall OCR readiness score
        ocr_readiness = self.calculate_ocr_readiness(
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

    def estimate_noise_level(self, gray_image):
        """
        Estimate noise level in the image
        """
        # Use Laplacian to detect high-frequency noise
        laplacian = cv2.Laplacian(gray_image, cv2.CV_64F)
        noise_estimate = np.abs(laplacian).mean()
        return noise_estimate

    def assess_text_clarity(self, gray_image):
        """
        Assess text clarity using edge detection and text detection metrics
        """
        # Edge detection for text assessment
        edges = cv2.Canny(gray_image, 50, 150)
        edge_density = np.sum(edges > 0) / edges.size

        # Text-like structure detection using morphological operations
        text_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
        text_structure = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, text_kernel)
        text_density = np.sum(text_structure > 0) / text_structure.size

        # Combine metrics
        text_clarity_score = (edge_density + text_density) / 2
        return min(text_clarity_score * 10, 1.0)  # Normalize to 0-1
```

---

## Zone Data Model & Versioning

### Normalized Zone Schema

#### Core Zone Data Structure
```typescript
interface Zone {
  id: string;
  page_number: number;
  type: 'header' | 'table' | 'footer';

  // Coordinate systems for reproducibility
  pdf_coords: {
    x: number; y: number; width: number; height: number;
  };
  img_coords: {
    x: number; y: number; width: number; height: number;
  };
  transform: {
    scale: number;
    rotation_deg: number;
    skew: number;
  };

  // Zone properties
  header_rows: number;
  col_count: number;
  enhance_preset: 'scan_clean' | 'low_contrast' | 'curved_page';

  // Continuation linking
  sources: string[]; // IDs of zones this continues from
  continuation_of?: string; // Parent zone ID

  // Versioning
  zone_version: number;
  enhance_version: number;
  ocr_model_version: string;

  // Metadata
  created_at: string;
  updated_at: string;
}
```

#### Integrity Validation
```python
class ZoneIntegrityValidator:
    def validate_zone_collection(self, zones: List[Zone]) -> ValidationResult:
        """
        Comprehensive zone validation with integrity checks
        """
        issues = []

        # Prevent overlapping header zones
        header_zones = [z for z in zones if z.type == 'header']
        overlaps = self.detect_zone_overlaps(header_zones)
        if overlaps:
            issues.append({
                'type': 'header_overlap',
                'severity': 'error',
                'zones': overlaps,
                'message': 'Header zones cannot overlap'
            })

        # Flag gaps in table coverage
        coverage_gaps = self.detect_coverage_gaps(zones)
        if coverage_gaps:
            issues.append({
                'type': 'coverage_gap',
                'severity': 'warning',
                'gaps': coverage_gaps,
                'message': 'Potential table content not covered by zones'
            })

        # Detect duplicate columns across pages
        duplicate_columns = self.detect_duplicate_columns(zones)
        if duplicate_columns:
            issues.append({
                'type': 'duplicate_columns',
                'severity': 'warning',
                'duplicates': duplicate_columns,
                'message': 'Same headers detected across multiple pages'
            })

        return ValidationResult(issues=issues, valid=len([i for i in issues if i['severity'] == 'error']) == 0)
```

### Versioning & Change Tracking

#### Version Management
```python
class ZoneVersionManager:
    def create_zone_version(self, zone: Zone, changes: Dict) -> Zone:
        """
        Create new version of zone with change tracking
        """
        new_version = zone.copy()
        new_version.zone_version += 1
        new_version.updated_at = datetime.utcnow().isoformat()

        # Store change metadata
        change_record = {
            'zone_id': zone.id,
            'from_version': zone.zone_version,
            'to_version': new_version.zone_version,
            'changes': changes,
            'timestamp': new_version.updated_at
        }

        self.store_change_record(change_record)
        return new_version

    def get_zone_history(self, zone_id: str) -> List[ChangeRecord]:
        """
        Retrieve complete change history for a zone
        """
        return self.change_store.get_changes(zone_id)
```

---

## API Specification & Concurrency

### RESTful Zone Management API

#### Zone CRUD Operations
```python
# POST /pdf/zones/:sessionId
# Create or update zones with optimistic locking
@api_view(['POST'])
def create_or_update_zones(request, session_id):
    """
    Idempotent zone creation/update with concurrency control
    """
    zones_data = request.data.get('zones', [])
    if_unmodified_since = request.headers.get('If-Unmodified-Since')

    try:
        with transaction.atomic():
            session = PDFSession.objects.select_for_update().get(session_id=session_id)

            # Concurrency check
            if if_unmodified_since and session.updated_at > parse_datetime(if_unmodified_since):
                return Response({
                    'error': 'Concurrent modification detected',
                    'current_version': session.updated_at.isoformat(),
                    'conflict_type': 'session_modified'
                }, status=409)

            # Process zones with version checking
            results = []
            for zone_data in zones_data:
                try:
                    zone = self.process_zone_with_versioning(zone_data, session)
                    results.append({
                        'zone_id': zone.id,
                        'status': 'success',
                        'version': zone.zone_version
                    })
                except ConcurrentModificationError as e:
                    return Response({
                        'error': f'Zone {zone_data["id"]} was modified by another process',
                        'zone_id': zone_data['id'],
                        'expected_version': zone_data.get('zone_version'),
                        'current_version': e.current_version
                    }, status=409)

            session.updated_at = timezone.now()
            session.save()

            return Response({
                'zones': results,
                'session_version': session.updated_at.isoformat()
            }, status=200)

    except PDFSession.DoesNotExist:
        return Response({'error': 'Session not found'}, status=404)

# POST /pdf/zones/:sessionId/process
# Process selected zones with enhancement
@api_view(['POST'])
def process_zones(request, session_id):
    """
    Process zones with enhancement pipeline
    Accepts partial zone lists for incremental processing
    """
    zone_ids = request.data.get('zone_ids', [])
    enhance_preset = request.data.get('enhance_preset', 'adaptive')

    # Start async processing
    task_id = process_zones_async.delay(
        session_id=session_id,
        zone_ids=zone_ids,
        enhance_preset=enhance_preset
    )

    return Response({
        'task_id': task_id,
        'status': 'processing',
        'estimated_completion': estimate_processing_time(len(zone_ids))
    }, status=202)

# GET /pdf/zones/:sessionId
# Retrieve zones with ETag support
@api_view(['GET'])
def get_zones(request, session_id):
    """
    Get zones with ETag caching and derived metrics
    """
    try:
        session = PDFSession.objects.get(session_id=session_id)
        zones = PDFZone.objects.filter(pdf_session=session).select_related()

        # Generate ETag based on session and zone versions
        etag = generate_etag(session, zones)

        # Check If-None-Match header
        if request.headers.get('If-None-Match') == etag:
            return Response(status=304)

        zones_data = {
            'zones': [serialize_zone(zone) for zone in zones],
            'derived_metrics': calculate_zone_metrics(zones),
            'session_version': session.updated_at.isoformat(),
            'coverage_analysis': analyze_page_coverage(zones)
        }

        response = Response(zones_data)
        response['ETag'] = etag
        response['Last-Modified'] = session.updated_at.strftime('%a, %d %b %Y %H:%M:%S GMT')

        return response

    except PDFSession.DoesNotExist:
        return Response({'error': 'Session not found'}, status=404)

# POST /pdf/continuations/:sessionId/link
# Link/unlink zone chains
@api_view(['POST'])
def manage_zone_links(request, session_id):
    """
    Create or modify zone continuation links
    """
    action = request.data.get('action')  # 'link' or 'unlink'
    zone_chain = request.data.get('zone_chain', [])  # Array of zone IDs

    if action == 'link':
        result = create_zone_continuation(session_id, zone_chain)
    elif action == 'unlink':
        result = remove_zone_continuation(session_id, zone_chain)
    else:
        return Response({'error': 'Invalid action'}, status=400)

    return Response({
        'action': action,
        'zone_chain': zone_chain,
        'result': result,
        'chain_quality': validate_continuation_quality(result)
    })
```

### Concurrency & Data Integrity

#### Optimistic Locking Implementation
```python
class ConcurrentZoneManager:
    def update_zone_with_versioning(self, zone_id: str, updates: Dict, expected_version: int) -> Zone:
        """
        Update zone with optimistic locking
        """
        with transaction.atomic():
            zone = PDFZone.objects.select_for_update().get(id=zone_id)

            if zone.zone_version != expected_version:
                raise ConcurrentModificationError(
                    f"Zone version conflict. Expected {expected_version}, got {zone.zone_version}",
                    current_version=zone.zone_version
                )

            # Apply updates
            for field, value in updates.items():
                setattr(zone, field, value)

            zone.zone_version += 1
            zone.updated_at = timezone.now()
            zone.save()

            return zone

class ConcurrentModificationError(Exception):
    def __init__(self, message: str, current_version: int):
        super().__init__(message)
        self.current_version = current_version
```

---

## Post-Zonal Content Enhancement Model

### AI-Powered Table Structure Enhancement

After OCR extraction, an AI model analyzes and enhances the extracted content to ensure maximum accuracy and structure consistency.

#### Content Enhancement Architecture
```python
class PostOCRContentEnhancer:
    def __init__(self):
        self.structure_analyzer = TableStructureAnalyzer()
        self.data_validator = DataConsistencyValidator()
        self.header_aligner = HeaderDataAligner()
        self.missing_data_detector = MissingDataDetector()

    def enhance_extracted_content(self, ocr_results, zone_metadata):
        """
        Comprehensive post-OCR content enhancement
        """
        enhancement_results = {
            'original_data': ocr_results,
            'enhanced_data': None,
            'improvements': [],
            'confidence_scores': {},
            'structure_fixes': []
        }

        # Phase 1: Structure Analysis and Correction
        structure_analysis = self.analyze_table_structure(ocr_results)
        corrected_structure = self.correct_structure_issues(
            ocr_results,
            structure_analysis
        )

        # Phase 2: Header-Data Alignment
        aligned_data = self.align_headers_with_data(
            corrected_structure,
            zone_metadata
        )

        # Phase 3: Data Type Inference and Validation
        typed_data = self.infer_and_validate_data_types(aligned_data)

        # Phase 4: Missing Data Detection and Handling
        completed_data = self.handle_missing_data(typed_data)

        # Phase 5: Quality Scoring
        quality_scores = self.calculate_enhancement_quality(
            ocr_results,
            completed_data
        )

        enhancement_results.update({
            'enhanced_data': completed_data,
            'confidence_scores': quality_scores,
            'structure_fixes': self.get_applied_fixes()
        })

        return enhancement_results

    def analyze_table_structure(self, ocr_data):
        """
        Deep analysis of extracted table structure
        """
        analysis = {
            'column_consistency': self.check_column_consistency(ocr_data),
            'row_completeness': self.check_row_completeness(ocr_data),
            'header_detection': self.validate_header_detection(ocr_data),
            'data_alignment': self.check_data_alignment(ocr_data),
            'cell_boundaries': self.validate_cell_boundaries(ocr_data)
        }

        # Identify structural issues
        issues = []
        if analysis['column_consistency']['score'] < 0.8:
            issues.append({
                'type': 'column_inconsistency',
                'severity': 'high',
                'details': analysis['column_consistency']['issues']
            })

        if analysis['row_completeness']['score'] < 0.9:
            issues.append({
                'type': 'incomplete_rows',
                'severity': 'medium',
                'details': analysis['row_completeness']['missing_cells']
            })

        analysis['identified_issues'] = issues
        return analysis

    def correct_structure_issues(self, ocr_data, analysis):
        """
        Apply intelligent corrections to structural issues
        """
        corrected_data = copy.deepcopy(ocr_data)

        for issue in analysis['identified_issues']:
            if issue['type'] == 'column_inconsistency':
                corrected_data = self.fix_column_inconsistencies(
                    corrected_data,
                    issue['details']
                )
            elif issue['type'] == 'incomplete_rows':
                corrected_data = self.fix_incomplete_rows(
                    corrected_data,
                    issue['details']
                )

        return corrected_data

    def align_headers_with_data(self, structured_data, zone_metadata):
        """
        Ensure perfect alignment between headers and data columns
        """
        headers = structured_data.get('headers', [])
        data_rows = structured_data.get('data', [])

        # Analyze header-data alignment
        alignment_analysis = self.analyze_header_data_alignment(headers, data_rows)

        if alignment_analysis['requires_correction']:
            # Apply alignment corrections
            aligned_headers, aligned_data = self.correct_header_data_alignment(
                headers,
                data_rows,
                alignment_analysis['correction_strategy']
            )

            return {
                'headers': aligned_headers,
                'data': aligned_data,
                'alignment_corrections': alignment_analysis['corrections_applied']
            }

        return structured_data

    def infer_and_validate_data_types(self, aligned_data):
        """
        Intelligent data type inference with validation
        """
        headers = aligned_data['headers']
        data_rows = aligned_data['data']

        # Infer data types for each column
        column_types = {}
        type_confidence = {}

        for col_idx, header in enumerate(headers):
            column_data = [row[col_idx] if col_idx < len(row) else ''
                          for row in data_rows]

            # Data type inference
            inferred_type, confidence = self.infer_column_type(
                column_data,
                header
            )

            column_types[header] = inferred_type
            type_confidence[header] = confidence

            # Apply type-specific cleaning
            if inferred_type == 'numeric':
                column_data = self.clean_numeric_data(column_data)
            elif inferred_type == 'date':
                column_data = self.clean_date_data(column_data)
            elif inferred_type == 'text':
                column_data = self.clean_text_data(column_data)

            # Update data with cleaned values
            for row_idx, cleaned_value in enumerate(column_data):
                if row_idx < len(data_rows) and col_idx < len(data_rows[row_idx]):
                    data_rows[row_idx][col_idx] = cleaned_value

        return {
            'headers': headers,
            'data': data_rows,
            'column_types': column_types,
            'type_confidence': type_confidence
        }

    def handle_missing_data(self, typed_data):
        """
        Intelligent missing data detection and handling
        """
        headers = typed_data['headers']
        data_rows = typed_data['data']
        column_types = typed_data['column_types']

        # Detect missing data patterns
        missing_data_analysis = self.analyze_missing_data_patterns(
            data_rows,
            column_types
        )

        # Apply missing data strategies
        completed_data = []
        for row_idx, row in enumerate(data_rows):
            completed_row = []
            for col_idx, cell_value in enumerate(row):
                if self.is_missing_data(cell_value):
                    # Apply appropriate missing data strategy
                    filled_value = self.fill_missing_data(
                        cell_value,
                        headers[col_idx],
                        column_types[headers[col_idx]],
                        missing_data_analysis,
                        row_idx,
                        col_idx
                    )
                    completed_row.append(filled_value)
                else:
                    completed_row.append(cell_value)
            completed_data.append(completed_row)

        return {
            'headers': headers,
            'data': completed_data,
            'column_types': column_types,
            'missing_data_report': missing_data_analysis
        }
```

### Advanced Data Type Inference
```python
class DataTypeInferenceEngine:
    def __init__(self):
        self.numeric_patterns = [
            r'^\d+\.?\d*$',  # Numbers
            r'^\$\d+\.?\d*$',  # Currency
            r'^\d+%$',  # Percentages
        ]

        self.date_patterns = [
            r'\d{1,2}/\d{1,2}/\d{4}',  # MM/DD/YYYY
            r'\d{4}-\d{2}-\d{2}',      # YYYY-MM-DD
            r'\d{1,2}-\w{3}-\d{4}',    # DD-MMM-YYYY
        ]

        self.id_patterns = [
            r'^[A-Z]\d+$',             # Product codes
            r'^\d{10,}$',              # Long numeric IDs
            r'^[A-Z]{2,}\d+$',         # Alpha-numeric codes
        ]

    def infer_column_type(self, column_data, header_name):
        """
        Advanced data type inference using multiple signals
        """
        # Remove empty/null values for analysis
        clean_data = [str(val).strip() for val in column_data if val and str(val).strip()]

        if not clean_data:
            return 'text', 0.0

        # Header name analysis
        header_signals = self.analyze_header_signals(header_name.lower())

        # Data pattern analysis
        pattern_scores = {
            'numeric': self.score_numeric_pattern(clean_data),
            'date': self.score_date_pattern(clean_data),
            'id_code': self.score_id_pattern(clean_data),
            'text': self.score_text_pattern(clean_data)
        }

        # Combine header signals with pattern scores
        final_scores = {}
        for data_type, pattern_score in pattern_scores.items():
            header_boost = header_signals.get(data_type, 0)
            final_scores[data_type] = pattern_score + (header_boost * 0.3)

        # Determine best type
        best_type = max(final_scores, key=final_scores.get)
        confidence = final_scores[best_type]

        return best_type, min(confidence, 1.0)

    def analyze_header_signals(self, header_name):
        """
        Analyze header name for type hints
        """
        signals = {}

        # Numeric indicators
        numeric_keywords = ['price', 'cost', 'amount', 'quantity', 'qty', 'total', 'sum']
        if any(keyword in header_name for keyword in numeric_keywords):
            signals['numeric'] = 0.4

        # Date indicators
        date_keywords = ['date', 'time', 'created', 'updated', 'expired']
        if any(keyword in header_name for keyword in date_keywords):
            signals['date'] = 0.4

        # ID indicators
        id_keywords = ['id', 'code', 'sku', 'part', 'number', 'ref']
        if any(keyword in header_name for keyword in id_keywords):
            signals['id_code'] = 0.4

        return signals

    def score_numeric_pattern(self, data_sample):
        """
        Score how well data matches numeric patterns
        """
        numeric_matches = 0
        for value in data_sample:
            if any(re.match(pattern, value) for pattern in self.numeric_patterns):
                numeric_matches += 1

        return numeric_matches / len(data_sample)
```

### Missing Data Intelligence
```python
class MissingDataHandler:
    def __init__(self):
        self.strategies = {
            'numeric': self.handle_missing_numeric,
            'date': self.handle_missing_date,
            'text': self.handle_missing_text,
            'id_code': self.handle_missing_id
        }

    def analyze_missing_data_patterns(self, data_rows, column_types):
        """
        Analyze patterns in missing data to determine best handling strategy
        """
        analysis = {}

        for col_idx, column_type in enumerate(column_types.values()):
            column_data = [row[col_idx] if col_idx < len(row) else ''
                          for row in data_rows]

            missing_count = sum(1 for val in column_data if self.is_missing_data(val))
            missing_percentage = missing_count / len(column_data)

            # Analyze missing data distribution
            missing_positions = [i for i, val in enumerate(column_data)
                               if self.is_missing_data(val)]

            # Determine pattern type
            if missing_percentage < 0.1:
                pattern_type = 'sparse'
            elif missing_percentage < 0.3:
                pattern_type = 'moderate'
            else:
                pattern_type = 'extensive'

            analysis[col_idx] = {
                'missing_count': missing_count,
                'missing_percentage': missing_percentage,
                'pattern_type': pattern_type,
                'missing_positions': missing_positions,
                'recommended_strategy': self.recommend_strategy(
                    column_type,
                    pattern_type,
                    missing_percentage
                )
            }

        return analysis

    def fill_missing_data(self, cell_value, column_name, column_type,
                         analysis, row_idx, col_idx):
        """
        Apply intelligent missing data filling
        """
        strategy = analysis[col_idx]['recommended_strategy']

        if strategy == 'interpolate':
            return self.interpolate_missing_value(
                cell_value, column_type, analysis, row_idx, col_idx
            )
        elif strategy == 'forward_fill':
            return self.forward_fill_value(
                cell_value, analysis, row_idx, col_idx
            )
        elif strategy == 'pattern_based':
            return self.pattern_based_fill(
                cell_value, column_type, analysis, row_idx, col_idx
            )
        elif strategy == 'leave_empty':
            return '[MISSING]'
        else:
            return cell_value

    def recommend_strategy(self, column_type, pattern_type, missing_percentage):
        """
        Recommend best strategy for handling missing data
        """
        if missing_percentage > 0.5:
            return 'leave_empty'  # Too much missing data

        if column_type == 'numeric':
            if pattern_type == 'sparse':
                return 'interpolate'
            else:
                return 'forward_fill'
        elif column_type == 'date':
            return 'pattern_based'
        elif column_type == 'id_code':
            return 'leave_empty'  # Cannot guess IDs
        else:
            return 'forward_fill'
```

---

## Technical Implementation

### Frontend Architecture

#### Enhanced Component Structure
```
frontend/src/
├── components/
│   ├── PDFProcessor/
│   │   ├── HeaderFirstSelector.js      # NEW: Header-first selection
│   │   ├── TableBoundaryDetector.js    # NEW: Smart boundary detection
│   │   ├── MultiPageLinker.js          # NEW: Page continuation interface
│   │   ├── ImageEnhancementPreview.js  # NEW: Enhancement preview
│   │   └── QualityIndicators.js        # NEW: Quality assessment UI
│   ├── EnhancementPipeline/
│   │   ├── EnhancementControls.js      # NEW: User enhancement controls
│   │   ├── BeforeAfterPreview.js       # NEW: Enhancement comparison
│   │   └── QualityMetrics.js           # NEW: Quality metrics display
│   └── ContentEnhancement/
│       ├── StructureValidator.js       # NEW: Structure validation UI
│       ├── DataTypeIndicators.js       # NEW: Data type visualization
│       └── MissingDataHandler.js       # NEW: Missing data interface
├── services/
│   ├── enhancementService.js           # NEW: Image enhancement API
│   ├── contentEnhancementService.js    # NEW: Post-OCR enhancement API
│   └── qualityAssessmentService.js     # NEW: Quality assessment API
└── utils/
    ├── imageProcessingUtils.js         # NEW: Client-side image utilities
    ├── dataTypeUtils.js                # NEW: Data type inference helpers
    └── qualityUtils.js                 # NEW: Quality calculation utilities
```

#### Header-First Selection Component
```javascript
const HeaderFirstSelector = ({ pageImage, onHeadersSelected, onTableBoundariesSelected }) => {
  const [selectionPhase, setSelectionPhase] = useState('headers');
  const [headerZones, setHeaderZones] = useState([]);
  const [tableBoundaries, setTableBoundaries] = useState([]);
  const [smartSuggestions, setSmartSuggestions] = useState([]);

  useEffect(() => {
    // Generate smart suggestions for headers
    generateHeaderSuggestions(pageImage).then(setSmartSuggestions);
  }, [pageImage]);

  const handleHeaderSelection = (zones) => {
    setHeaderZones(zones);

    // Automatically suggest table boundaries based on headers
    const suggestedBoundaries = generateTableBoundariesFromHeaders(zones);
    setSmartSuggestions(suggestedBoundaries);

    // Move to table boundary selection phase
    setSelectionPhase('table_boundaries');
    onHeadersSelected(zones);
  };

  const handleTableBoundarySelection = (boundaries) => {
    setTableBoundaries(boundaries);
    onTableBoundariesSelected({
      headers: headerZones,
      boundaries: boundaries
    });
  };

  return (
    <div className="header-first-selector">
      <SelectionPhaseIndicator currentPhase={selectionPhase} />

      {selectionPhase === 'headers' && (
        <HeaderSelectionInterface
          pageImage={pageImage}
          smartSuggestions={smartSuggestions}
          onSelectionComplete={handleHeaderSelection}
        />
      )}

      {selectionPhase === 'table_boundaries' && (
        <TableBoundaryInterface
          pageImage={pageImage}
          headerZones={headerZones}
          smartSuggestions={smartSuggestions}
          onSelectionComplete={handleTableBoundarySelection}
        />
      )}
    </div>
  );
};
```

### Backend Enhancement Services

#### Image Enhancement Service
```python
# backend/excel_mapper/services/enhanced_image_processor.py

class EnhancedImageProcessor:
    def __init__(self):
        self.enhancer = AdvancedImageEnhancer()
        self.quality_analyzer = ImageQualityAnalyzer()
        self.redis_client = redis.Redis(host='localhost', port=6379, db=0)

    async def process_zone_with_enhancement(self, zone_data, enhancement_config):
        """
        Complete zone processing with enhancement pipeline
        """
        zone_id = zone_data['zone_id']

        try:
            # Step 1: Extract zone from PDF page
            zone_image = self.extract_zone_from_pdf(
                zone_data['pdf_path'],
                zone_data['page_number'],
                zone_data['coordinates']
            )

            # Step 2: Pre-enhancement quality assessment
            initial_quality = self.quality_analyzer.analyze_image_quality(zone_image)

            # Step 3: Apply enhancement pipeline
            enhancement_result = self.enhancer.enhance_zone_for_ocr(
                zone_image,
                enhancement_config.get('strength', 'adaptive')
            )

            # Step 4: Post-enhancement quality assessment
            final_quality = self.quality_analyzer.analyze_image_quality(
                enhancement_result['enhanced_image']
            )

            # Step 5: Cache enhanced image for OCR processing
            enhanced_image_path = self.cache_enhanced_image(
                zone_id,
                enhancement_result['enhanced_image']
            )

            # Step 6: Update processing status
            await self.update_zone_status(zone_id, 'enhanced', {
                'enhancement_log': enhancement_result['enhancement_log'],
                'quality_improvement': enhancement_result['quality_improvement'],
                'initial_quality': initial_quality,
                'final_quality': final_quality,
                'enhanced_image_path': enhanced_image_path
            })

            return {
                'zone_id': zone_id,
                'status': 'enhanced',
                'enhanced_image_path': enhanced_image_path,
                'quality_metrics': {
                    'initial': initial_quality,
                    'final': final_quality,
                    'improvement': enhancement_result['quality_improvement']
                },
                'ready_for_ocr': enhancement_result['recommended_for_ocr']
            }

        except Exception as e:
            await self.update_zone_status(zone_id, 'enhancement_failed', {
                'error': str(e)
            })
            raise

    def cache_enhanced_image(self, zone_id, enhanced_image):
        """
        Cache enhanced image for OCR processing
        """
        cache_path = f"/tmp/enhanced_zones/{zone_id}.png"
        cv2.imwrite(cache_path, enhanced_image)

        # Also cache in Redis for quick access
        _, buffer = cv2.imencode('.png', enhanced_image)
        self.redis_client.setex(
            f"enhanced_zone:{zone_id}",
            3600,  # 1 hour expiry
            buffer.tobytes()
        )

        return cache_path
```

---

## Quality Assurance System

### Comprehensive Quality Metrics

#### Quality Assessment Framework
```python
class ComprehensiveQualityAssessment:
    def __init__(self):
        self.image_quality_analyzer = ImageQualityAnalyzer()
        self.structure_validator = StructureValidator()
        self.data_quality_analyzer = DataQualityAnalyzer()

    def assess_complete_pipeline_quality(self, pipeline_data):
        """
        End-to-end quality assessment of the entire pipeline
        """
        assessment = {
            'image_quality': self.assess_image_enhancement_quality(
                pipeline_data['original_images'],
                pipeline_data['enhanced_images']
            ),
            'ocr_quality': self.assess_ocr_extraction_quality(
                pipeline_data['ocr_results']
            ),
            'structure_quality': self.assess_structure_quality(
                pipeline_data['extracted_tables']
            ),
            'data_quality': self.assess_data_consistency_quality(
                pipeline_data['final_data']
            ),
            'overall_pipeline_score': 0.0
        }

        # Calculate weighted overall score
        weights = {
            'image_quality': 0.2,
            'ocr_quality': 0.3,
            'structure_quality': 0.25,
            'data_quality': 0.25
        }

        assessment['overall_pipeline_score'] = sum(
            assessment[metric]['score'] * weights[metric]
            for metric in weights.keys()
        )

        # Generate improvement recommendations
        assessment['recommendations'] = self.generate_quality_recommendations(
            assessment
        )

        return assessment

    def assess_image_enhancement_quality(self, original_images, enhanced_images):
        """
        Assess quality improvement from image enhancement
        """
        improvements = []

        for orig_img, enh_img in zip(original_images, enhanced_images):
            orig_quality = self.image_quality_analyzer.analyze_image_quality(orig_img)
            enh_quality = self.image_quality_analyzer.analyze_image_quality(enh_img)

            improvement = {
                'sharpness_improvement': enh_quality['sharpness'] - orig_quality['sharpness'],
                'contrast_improvement': enh_quality['contrast'] - orig_quality['contrast'],
                'noise_reduction': orig_quality['noise_level'] - enh_quality['noise_level'],
                'overall_improvement': enh_quality['overall'] - orig_quality['overall']
            }
            improvements.append(improvement)

        avg_improvement = {
            metric: np.mean([imp[metric] for imp in improvements])
            for metric in improvements[0].keys()
        }

        return {
            'score': max(avg_improvement['overall_improvement'], 0) / 1.0,  # Normalize
            'improvements': avg_improvement,
            'individual_zones': improvements
        }

    def generate_quality_recommendations(self, assessment):
        """
        Generate actionable recommendations for quality improvement
        """
        recommendations = []

        # Image quality recommendations
        if assessment['image_quality']['score'] < 0.7:
            recommendations.append({
                'category': 'image_enhancement',
                'priority': 'high',
                'message': 'Image enhancement pipeline needs optimization',
                'actions': [
                    'Increase enhancement strength',
                    'Apply additional noise reduction',
                    'Check original PDF quality'
                ]
            })

        # OCR quality recommendations
        if assessment['ocr_quality']['score'] < 0.8:
            recommendations.append({
                'category': 'ocr_processing',
                'priority': 'high',
                'message': 'OCR extraction accuracy is below optimal',
                'actions': [
                    'Review zone selections',
                    'Apply stronger image enhancement',
                    'Consider manual header correction'
                ]
            })

        # Structure quality recommendations
        if assessment['structure_quality']['score'] < 0.8:
            recommendations.append({
                'category': 'table_structure',
                'priority': 'medium',
                'message': 'Table structure detection needs improvement',
                'actions': [
                    'Refine zone boundaries',
                    'Check header-data alignment',
                    'Validate column consistency'
                ]
            })

        return recommendations
```

### Real-time Quality Monitoring

#### Quality Dashboard Component
```javascript
const QualityDashboard = ({ pipelineData, onQualityImprovement }) => {
  const [qualityMetrics, setQualityMetrics] = useState(null);
  const [recommendations, setRecommendations] = useState([]);

  useEffect(() => {
    // Real-time quality assessment
    assessPipelineQuality(pipelineData).then(results => {
      setQualityMetrics(results.metrics);
      setRecommendations(results.recommendations);
    });
  }, [pipelineData]);

  const renderQualityIndicator = (metric, score) => {
    const getColor = (score) => {
      if (score >= 0.8) return 'green';
      if (score >= 0.6) return 'yellow';
      return 'red';
    };

    return (
      <div className="quality-indicator">
        <div className="metric-name">{metric}</div>
        <div className={`score-bar ${getColor(score)}`}>
          <div
            className="score-fill"
            style={{ width: `${score * 100}%` }}
          />
        </div>
        <div className="score-value">{(score * 100).toFixed(1)}%</div>
      </div>
    );
  };

  return (
    <div className="quality-dashboard">
      <div className="quality-metrics">
        <h3>Pipeline Quality Assessment</h3>

        {qualityMetrics && Object.entries(qualityMetrics).map(([metric, data]) => (
          <div key={metric} className="metric-section">
            {renderQualityIndicator(metric, data.score)}

            {data.score < 0.7 && (
              <div className="improvement-suggestions">
                <button
                  onClick={() => onQualityImprovement(metric)}
                  className="improve-button"
                >
                  Improve {metric}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="recommendations-panel">
        <h3>Quality Recommendations</h3>
        {recommendations.map((rec, index) => (
          <div key={index} className={`recommendation ${rec.priority}`}>
            <div className="rec-message">{rec.message}</div>
            <div className="rec-actions">
              {rec.actions.map((action, i) => (
                <button
                  key={i}
                  onClick={() => executeQualityAction(action)}
                  className="action-button"
                >
                  {action}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
```

---

## Performance Optimization

### Asynchronous Processing Pipeline

#### Parallel Enhancement Processing
```python
import asyncio
from concurrent.futures import ThreadPoolExecutor
import multiprocessing as mp

class ParallelEnhancementProcessor:
    def __init__(self, max_workers=None):
        self.max_workers = max_workers or mp.cpu_count()
        self.executor = ThreadPoolExecutor(max_workers=self.max_workers)

    async def process_multiple_zones_parallel(self, zones_data, enhancement_config):
        """
        Process multiple zones in parallel for maximum efficiency
        """
        # Create processing tasks
        tasks = []
        for zone_data in zones_data:
            task = self.process_single_zone_async(zone_data, enhancement_config)
            tasks.append(task)

        # Execute all tasks in parallel
        results = await asyncio.gather(*tasks, return_exceptions=True)

        # Process results and handle exceptions
        processed_results = []
        failed_zones = []

        for i, result in enumerate(results):
            if isinstance(result, Exception):
                failed_zones.append({
                    'zone_id': zones_data[i]['zone_id'],
                    'error': str(result)
                })
            else:
                processed_results.append(result)

        return {
            'successful_zones': processed_results,
            'failed_zones': failed_zones,
            'total_processed': len(processed_results),
            'total_failed': len(failed_zones)
        }

    async def process_single_zone_async(self, zone_data, enhancement_config):
        """
        Asynchronous processing of a single zone
        """
        loop = asyncio.get_event_loop()

        # CPU-intensive operations run in thread pool
        enhanced_result = await loop.run_in_executor(
            self.executor,
            self.enhance_zone_sync,
            zone_data,
            enhancement_config
        )

        # OCR processing (I/O intensive) can be awaited directly
        ocr_result = await self.process_ocr_async(enhanced_result)

        # Content enhancement (CPU intensive) back to thread pool
        final_result = await loop.run_in_executor(
            self.executor,
            self.enhance_content_sync,
            ocr_result
        )

        return final_result
```

### Caching Strategy

#### Multi-Level Caching System
```python
class MultiLevelCacheSystem:
    def __init__(self):
        self.memory_cache = {}  # In-memory cache for frequent access
        self.redis_client = redis.Redis()  # Redis for session-based caching
        self.disk_cache_path = "/tmp/pdf_processing_cache"  # Disk cache for large images

    async def get_cached_enhancement(self, zone_id, enhancement_config):
        """
        Multi-level cache retrieval for enhanced images
        """
        cache_key = f"{zone_id}:{hash(str(enhancement_config))}"

        # Level 1: Memory cache (fastest)
        if cache_key in self.memory_cache:
            return self.memory_cache[cache_key]

        # Level 2: Redis cache (fast)
        redis_data = self.redis_client.get(f"enhanced:{cache_key}")
        if redis_data:
            enhanced_data = pickle.loads(redis_data)
            # Store in memory cache for next access
            self.memory_cache[cache_key] = enhanced_data
            return enhanced_data

        # Level 3: Disk cache (slower but persistent)
        disk_path = os.path.join(self.disk_cache_path, f"{cache_key}.pkl")
        if os.path.exists(disk_path):
            with open(disk_path, 'rb') as f:
                enhanced_data = pickle.load(f)

            # Store in higher-level caches
            self.redis_client.setex(f"enhanced:{cache_key}", 3600, pickle.dumps(enhanced_data))
            self.memory_cache[cache_key] = enhanced_data
            return enhanced_data

        return None

    async def cache_enhancement_result(self, zone_id, enhancement_config, result):
        """
        Store enhancement result in all cache levels
        """
        cache_key = f"{zone_id}:{hash(str(enhancement_config))}"

        # Memory cache
        self.memory_cache[cache_key] = result

        # Redis cache (with expiration)
        self.redis_client.setex(
            f"enhanced:{cache_key}",
            3600,  # 1 hour
            pickle.dumps(result)
        )

        # Disk cache (for persistence)
        disk_path = os.path.join(self.disk_cache_path, f"{cache_key}.pkl")
        os.makedirs(os.path.dirname(disk_path), exist_ok=True)
        with open(disk_path, 'wb') as f:
            pickle.dump(result, f)
```

---

## Acceptance Criteria & Migration Plan

### Acceptance Criteria

#### Functional Requirements
- ✅ **Header Detection Accuracy**: Headers detected within ±5% bounding accuracy for good quality PDFs
- ✅ **Continuation Rendering**: Multi-page continuations render as single consolidated table with >95% accuracy
- ✅ **Enhancement Impact**: Changing enhancement preset improves OCR confidence by ≥15% for low-contrast samples
- ✅ **Undo/Redo Persistence**: History stack persists across page navigation and browser refresh
- ✅ **Keyboard Navigation**: All zone selection operations possible via keyboard-only controls
- ✅ **Processing Performance**: Single-page processing completes within 30 seconds
- ✅ **Reliability**: <1% processing failure rate under normal operating conditions

#### Quality Metrics
- ✅ **OCR Accuracy**: >95% correct data extraction for high-quality PDFs
- ✅ **Structure Preservation**: Table structure maintained across page continuations
- ✅ **Header Consistency**: Cross-page header matching with >90% confidence
- ✅ **Integration Compatibility**: Zero impact on existing Excel/CSV workflows

#### User Experience Standards
- ✅ **Intuitive Workflow**: Users complete PDF processing without documentation
- ✅ **Error Recovery**: Clear error messages with actionable recovery steps
- ✅ **Accessibility**: WCAG 2.1 AA compliance for keyboard and screen reader access
- ✅ **Performance**: UI remains responsive during background processing

### Migration Plan

#### Phase 1: Core Implementation (Weeks 1-4)
**Scope**: Basic PDF processing infrastructure
- ✅ PDF upload and page conversion
- ✅ Header-first selection interface
- ✅ Single-zone processing with basic enhancement
- ✅ Integration with existing column mapping

**Deliverables**:
- HeaderFirstSelector component
- Basic zone data model
- Single enhancement preset (scan_clean)
- API endpoints for zone CRUD operations

**Success Criteria**:
- Users can select headers and process single-page PDFs
- Headers flow correctly into existing mapping interface
- No regression in Excel/CSV functionality

#### Phase 2: Advanced Selection & Enhancement (Weeks 5-8)
**Scope**: Enhanced user interface and image processing
- ✅ Multi-row header grouping and keyboard shortcuts
- ✅ Snap-to-grid and magnetic selection
- ✅ Undo/redo with autosave
- ✅ All three enhancement presets (scan_clean, low_contrast, curved_page)
- ✅ Client-side enhancement previews

**Deliverables**:
- Advanced selection tools
- Deterministic enhancement presets
- WebAssembly enhancement worker
- Zone versioning system

**Success Criteria**:
- Complex header structures handled correctly
- Enhancement presets show measurable OCR improvement
- Real-time preview performance acceptable

#### Phase 3: Multi-Page Intelligence (Weeks 9-12)
**Scope**: Cross-page processing and linking
- ✅ Automatic continuation detection
- ✅ Visual chain linking interface
- ✅ Column drift handling
- ✅ Gap detection and warnings
- ✅ Confidence scoring for continuations

**Deliverables**:
- MultiPageLinker component
- Continuation detection algorithms
- Chain validation system
- API endpoints for link management

**Success Criteria**:
- Multi-page tables process as single consolidated output
- Continuation detection >80% accuracy
- Manual override capabilities work reliably

#### Phase 4: Quality & Polish (Weeks 13-16)
**Scope**: Quality assurance and enterprise features
- ✅ Comprehensive quality dashboard
- ✅ Real-time processing status
- ✅ Error handling and recovery
- ✅ Performance optimization
- ✅ Accessibility compliance
- ✅ Telemetry and monitoring

**Deliverables**:
- QualityDashboard component
- Comprehensive error handling
- Performance monitoring
- Accessibility audit results
- Production deployment scripts

**Success Criteria**:
- All acceptance criteria met
- Performance benchmarks achieved
- Error handling validates with edge cases
- Accessibility compliance verified

### Testing Strategy

#### Test PDF Library
**Golden PDFs**: Curated set of PDFs with known expected outputs
- **Simple single-page**: Basic table with clear headers
- **Multi-page continuation**: Table spanning 3+ pages
- **Complex headers**: Multi-row, merged cell headers
- **Low quality scan**: Degraded image quality
- **Curved/skewed pages**: Document scanning artifacts
- **Mixed content**: Tables with surrounding text

#### Automated Testing
```python
# Snapshot testing for header detection
class TestHeaderDetection(TestCase):
    def test_golden_pdf_header_extraction(self):
        for pdf_file in GOLDEN_PDF_SET:
            with self.subTest(pdf=pdf_file.name):
                zones = extract_header_zones(pdf_file)
                expected_headers = pdf_file.expected_headers

                # Assert header count matches
                self.assertEqual(len(zones), len(expected_headers))

                # Assert bounding box accuracy within 5%
                for zone, expected in zip(zones, expected_headers):
                    accuracy = calculate_bbox_accuracy(zone.coordinates, expected.coordinates)
                    self.assertGreaterEqual(accuracy, 0.95)
```

#### Performance Benchmarks
```python
# Performance regression testing
class TestProcessingPerformance(TestCase):
    def test_single_page_processing_time(self):
        start_time = time.time()
        result = process_pdf_page(STANDARD_TEST_PDF)
        processing_time = time.time() - start_time

        self.assertLess(processing_time, 30.0, "Single page processing exceeded 30 seconds")
        self.assertTrue(result.success, "Processing failed")
```

### Documentation Requirements

#### User Documentation
- **Quick Start Guide**: 5-minute tutorial for basic PDF processing
- **Advanced Features**: Comprehensive guide for multi-page and complex tables
- **Troubleshooting**: Common issues and solutions
- **Accessibility Guide**: Keyboard shortcuts and screen reader support

#### Developer Documentation
- **API Reference**: Complete endpoint documentation with examples
- **Architecture Overview**: System design and component interaction
- **Enhancement Guide**: How to add new enhancement presets
- **Integration Guide**: Connecting with existing workflows

#### Operational Documentation
- **Deployment Guide**: Production setup and configuration
- **Monitoring Setup**: Telemetry and alerting configuration
- **Performance Tuning**: Optimization recommendations
- **Security Guidelines**: Best practices for PDF processing

---

This comprehensive zonal mapping specification provides a complete, implementation-ready framework for advanced PDF OCR with header-first selection, intelligent multi-page handling, sophisticated image enhancement, and AI-powered content enhancement. The system prioritizes user experience while maximizing OCR accuracy through multiple layers of intelligent processing, robust error handling, and comprehensive quality assurance.