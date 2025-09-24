# models.py

from django.db import models
import json
import uuid
from rapidfuzz import fuzz

class MappingTemplate(models.Model):
    name = models.CharField(max_length=200, unique=True)
    description = models.TextField(blank=True, null=True)
    template_headers = models.JSONField()  # List of template column names
    source_headers = models.JSONField()    # List of source column names used when created
    mappings = models.JSONField()          # Dict: {template_col: source_col}
    formula_rules = models.JSONField(default=list, blank=True)  # Formula rules for auto-tagging
    factwise_rules = models.JSONField(default=list, blank=True)  # Factwise ID rules
    default_values = models.JSONField(default=dict, blank=True)  # Default values for unmapped fields
    # Dynamic column counts
    tags_count = models.IntegerField(default=1)  # Number of Tags columns
    spec_pairs_count = models.IntegerField(default=1)  # Number of Specification Name/Value pairs
    customer_id_pairs_count = models.IntegerField(default=1)  # Number of Customer ID Name/Value pairs
    session_id = models.CharField(max_length=100)  # Original session ID
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    usage_count = models.IntegerField(default=0)
    
    class Meta:
        ordering = ['-created_at']
        db_table = 'excel_mapper_mapping_template'
    
    def __str__(self):
        return self.name
    
    def increment_usage(self):
        """Increment usage count when template is used"""
        self.usage_count += 1
        self.save(update_fields=['usage_count'])
    
    def apply_to_headers(self, new_source_headers):
        """
        Apply this template's mappings to new source headers.
        Returns both old and new format results for backward compatibility
        """
        applied_mappings_dict = {}  # Old format for backward compatibility
        applied_mappings_list = []  # New format preserving duplicates
        mapping_confidence = {}

        # Handle different mapping formats
        if isinstance(self.mappings, list):
            # Direct list format (new format without wrapper)
            mappings_to_process = self.mappings
        elif isinstance(self.mappings, dict) and 'new_format' in self.mappings:
            # New format with wrapper - process ALL mappings
            mappings_to_process = self.mappings['new_format']
        else:
            mappings_to_process = None

        # If template has Tag formula rules, only ignore Tag mappings that conflict with specific Tag_N targets
        # Preserve non-conflicting Tag mappings (e.g., keep Tag_1..3 if formula targets Tag_4)
        try:
            tag_formula_targets = set()
            for r in (getattr(self, 'formula_rules', []) or []):
                if (r or {}).get('column_type', 'Tag') == 'Tag':
                    tgt = (r or {}).get('target_column')
                    if isinstance(tgt, str) and tgt.startswith('Tag_'):
                        tag_formula_targets.add(tgt)
            has_tag_formulas = len(tag_formula_targets) > 0 or any(
                (r or {}).get('column_type', 'Tag') == 'Tag' and not str((r or {}).get('target_column', '')).startswith('Tag_')
                for r in (getattr(self, 'formula_rules', []) or [])
            )
        except Exception:
            tag_formula_targets = set()
            has_tag_formulas = False

        if mappings_to_process and has_tag_formulas:
            def _tag_mapping_conflicts(target_name: str) -> bool:
                # Conflict only if mapping targets a Tag_N that is explicitly targeted by a formula rule
                if not isinstance(target_name, str):
                    return False
                # Generic 'Tag' targets should be dropped when any Tag formulas exist
                if target_name == 'Tag':
                    return True
                if target_name in tag_formula_targets:
                    return True
                # If formula rule uses generic 'Tag' (no specific Tag_N), do not drop direct Tag mappings;
                # generic formulas will use the next available Tag_N in the UI/runtime.
                return False

            mappings_to_process = [
                m for m in mappings_to_process
                if not _tag_mapping_conflicts(str(m.get('target', '')))
            ]

        # Process list-based mappings (both direct list and new_format)
        if mappings_to_process:
            for mapping_item in mappings_to_process:
                template_col = mapping_item.get('target', '')
                original_source_col = mapping_item.get('source', '')
                
                matched_source_col = None
                confidence = 0.0
                
                # First try exact match
                if original_source_col in new_source_headers:
                    matched_source_col = original_source_col
                    confidence = 1.0  # Perfect match
                else:
                    # Try fuzzy matching
                    best_match, match_confidence = self._find_best_match(original_source_col, new_source_headers)
                    if best_match and match_confidence > 0.7:  # 70% confidence threshold
                        matched_source_col = best_match
                        confidence = match_confidence
                
                # If we found a match, add to both formats
                if matched_source_col:
                    # Add to new format (preserves duplicates)
                    applied_mappings_list.append({
                        'source': matched_source_col,
                        'target': template_col
                    })
                    
                    # Add to old format (for backward compatibility, overwrites duplicates)
                    applied_mappings_dict[template_col] = matched_source_col
                    mapping_confidence[template_col] = confidence
        else:
            # Old format (dictionary)
            mappings_dict = self.mappings.get('old_format', self.mappings) if isinstance(self.mappings, dict) and 'old_format' in self.mappings else self.mappings
            # Filter only conflicting Tag_* targets if tag formulas exist
            if isinstance(mappings_dict, dict) and has_tag_formulas:
                filtered = {}
                for t, s in mappings_dict.items():
                    t_str = str(t)
                    # Drop only if this Tag_N is explicitly targeted by a formula rule
                    if t_str in tag_formula_targets:
                        continue
                    filtered[t] = s
                mappings_dict = filtered
            for template_col, original_source_col in mappings_dict.items():
                matched_source_col = None
                confidence = 0.0
                
                # First try exact match
                if original_source_col in new_source_headers:
                    matched_source_col = original_source_col
                    confidence = 1.0  # Perfect match
                else:
                    # Try fuzzy matching
                    best_match, match_confidence = self._find_best_match(original_source_col, new_source_headers)
                    if best_match and match_confidence > 0.7:  # 70% confidence threshold
                        matched_source_col = best_match
                        confidence = match_confidence
                
                # If we found a match, add to both formats
                if matched_source_col:
                    applied_mappings_dict[template_col] = matched_source_col
                    applied_mappings_list.append({
                        'source': matched_source_col,
                        'target': template_col
                    })
                    mapping_confidence[template_col] = confidence
        
        # Calculate total template columns based on format
        if isinstance(self.mappings, list):
            # Direct list format
            total_template_columns = len(set(mapping.get('target', '') for mapping in self.mappings if isinstance(mapping, dict)))
        elif isinstance(self.mappings, dict) and 'new_format' in self.mappings:
            # New format with wrapper
            total_template_columns = len(set(mapping['target'] for mapping in self.mappings['new_format']))
        elif isinstance(self.mappings, dict):
            # Old format (dictionary)
            mappings_dict = self.mappings.get('old_format', self.mappings) if 'old_format' in self.mappings else self.mappings
            total_template_columns = len(mappings_dict)
        else:
            total_template_columns = 0
        
        return {
            'mappings': applied_mappings_dict,  # Old format for backward compatibility
            'mappings_new_format': applied_mappings_list,  # New format preserving duplicates  
            'confidence': mapping_confidence,
            'total_mapped': len(applied_mappings_dict),  # Unique columns mapped
            'total_mappings_with_duplicates': len(applied_mappings_list),  # All mappings including duplicates
            'total_template_columns': total_template_columns
        }
    
    def _find_best_match(self, target_header, available_headers):
        """Enhanced fuzzy matching with confidence score"""
        best_score = 0
        best_match = None
        
        target_normalized = target_header.lower().strip()
        
        for header in available_headers:
            header_normalized = header.lower().strip()
            
            # Try different similarity algorithms
            ratio_score = fuzz.ratio(target_normalized, header_normalized)
            token_sort_score = fuzz.token_sort_ratio(target_normalized, header_normalized)
            partial_score = fuzz.partial_ratio(target_normalized, header_normalized)
            
            # Take the best score from different algorithms
            score = max(ratio_score, token_sort_score, partial_score)
            
            if score > best_score:
                best_score = score
                best_match = header
        
        # Convert to 0-1 range
        confidence = best_score / 100.0
        
        return best_match, confidence
    
    def get_mapping_summary(self):
        """Get a summary of the mapping for display purposes"""
        # Handle both old and new database schemas
        try:
            formula_rules = getattr(self, 'formula_rules', []) or []
        except AttributeError:
            formula_rules = []
        
        try:
            default_values = getattr(self, 'default_values', {}) or {}
        except AttributeError:
            default_values = {}
        
        # Handle different mapping formats
        if isinstance(self.mappings, list):
            # Direct list format (new format without wrapper)
            mappings_list = self.mappings
            # Get unique template columns (targets)
            template_columns = list(set(mapping.get('target', '') for mapping in mappings_list if isinstance(mapping, dict)))
            # Get unique source columns  
            source_columns = list(set(mapping.get('source', '') for mapping in mappings_list if isinstance(mapping, dict)))
            total_mappings = len(mappings_list)
        elif isinstance(self.mappings, dict) and 'new_format' in self.mappings:
            # New format with wrapper
            mappings_list = self.mappings['new_format']
            # Get unique template columns (targets)
            template_columns = list(set(mapping['target'] for mapping in mappings_list))
            # Get unique source columns  
            source_columns = list(set(mapping['source'] for mapping in mappings_list))
            total_mappings = len(mappings_list)  # Count all mappings including duplicates
        elif isinstance(self.mappings, dict):
            # Old format (dictionary) or fallback
            mappings_dict = self.mappings.get('old_format', self.mappings) if 'old_format' in self.mappings else self.mappings
            template_columns = list(mappings_dict.keys())
            source_columns = list(mappings_dict.values())
            total_mappings = len(mappings_dict)
        else:
            # Fallback for unexpected formats
            template_columns = []
            source_columns = []
            total_mappings = 0
        
        return {
            'id': self.id,
            'name': self.name,
            'description': self.description,
            'total_mappings': total_mappings,
            'template_columns': template_columns,
            'source_columns': source_columns,
            'formula_rules': formula_rules,  # Include formula rules with fallback
            'has_formulas': len(formula_rules) > 0,
            'default_values': default_values,  # Include default values with fallback
            'has_default_values': len(default_values) > 0,
            'factwise_rules': getattr(self, 'factwise_rules', []), # Include factwise rules
            'has_factwise_rules': len(getattr(self, 'factwise_rules', [])) > 0,
            # Column counts
            'tags_count': getattr(self, 'tags_count', 1),
            'spec_pairs_count': getattr(self, 'spec_pairs_count', 1),
            'customer_id_pairs_count': getattr(self, 'customer_id_pairs_count', 1),
            'created_at': self.created_at.isoformat(),
            'usage_count': self.usage_count
        }


class TagTemplate(models.Model):
    """
    Model for storing reusable smart tag formula rule templates
    """
    name = models.CharField(max_length=200, unique=True)
    description = models.TextField(blank=True, null=True)
    formula_rules = models.JSONField(default=list, blank=True)  # Formula rules for auto-tagging
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    usage_count = models.IntegerField(default=0)
    
    class Meta:
        ordering = ['-created_at']
        db_table = 'excel_mapper_tag_template'
    
    def __str__(self):
        return self.name
    
    def increment_usage(self):
        """Increment usage count when template is used"""
        self.usage_count += 1
        self.save(update_fields=['usage_count'])
    
    @property
    def total_rules(self):
        """Return the total number of formula rules in this template"""
        return len(self.formula_rules) if self.formula_rules else 0
    
    def get_template_summary(self):
        """Get a summary of the tag template for display purposes"""
        return {
            'id': self.id,
            'name': self.name,
            'description': self.description,
            'formula_rules': self.formula_rules,
            'total_rules': self.total_rules,
            'created_at': self.created_at.isoformat(),
            'usage_count': self.usage_count
        }


class PDFSession(models.Model):
    """Model for tracking PDF processing sessions"""
    session_id = models.CharField(max_length=100, unique=True, default=uuid.uuid4)
    original_pdf_path = models.CharField(max_length=500)
    total_pages = models.IntegerField()
    processing_status = models.CharField(
        max_length=50,
        default='pending',
        choices=[
            ('pending', 'Pending'),
            ('processing', 'Processing'),
            ('completed', 'Completed'),
            ('failed', 'Failed'),
        ]
    )
    source_type = models.CharField(max_length=10, default='pdf')
    file_name = models.CharField(max_length=255, blank=True)
    file_size = models.BigIntegerField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'excel_mapper_pdf_session'
        ordering = ['-created_at']

    def __str__(self):
        return f"PDF Session {self.session_id} - {self.processing_status}"


class PDFPage(models.Model):
    """Model for storing PDF page information"""
    pdf_session = models.ForeignKey(PDFSession, on_delete=models.CASCADE, related_name='pages')
    page_number = models.IntegerField()
    image_path = models.CharField(max_length=500, blank=True)
    width = models.IntegerField(null=True, blank=True)
    height = models.IntegerField(null=True, blank=True)
    processed = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'excel_mapper_pdf_page'
        unique_together = ['pdf_session', 'page_number']
        ordering = ['page_number']

    def __str__(self):
        return f"Page {self.page_number} of {self.pdf_session.session_id}"


class PDFExtractionResult(models.Model):
    """Model for storing OCR extraction results"""
    pdf_session = models.ForeignKey(PDFSession, on_delete=models.CASCADE, related_name='extractions')
    page_numbers = models.JSONField()  # List of page numbers processed
    extracted_headers = models.JSONField()  # List of detected headers
    extracted_data = models.JSONField()  # List of rows data
    confidence_scores = models.JSONField()  # Confidence scores for headers and data
    quality_metrics = models.JSONField(default=dict)  # Overall quality metrics
    table_count = models.IntegerField(default=0)  # Number of tables detected
    processing_time_seconds = models.FloatField(null=True, blank=True)
    azure_operation_id = models.CharField(max_length=100, blank=True)  # Azure OCR operation ID
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'excel_mapper_pdf_extraction'
        ordering = ['-created_at']

    def __str__(self):
        return f"Extraction for {self.pdf_session.session_id} - {self.table_count} tables"


class MpnOAuthToken(models.Model):
    """Stores Digi‑Key OAuth tokens for MPN validation.
    Single-record usage (or per-tenant if extended later).
    """
    access_token = models.TextField()
    refresh_token = models.TextField()
    token_type = models.CharField(max_length=20, default='Bearer')
    scope = models.CharField(max_length=255, blank=True)
    expires_at = models.DateTimeField()
    # Locale context (optional; for cache scoping and audit)
    site = models.CharField(max_length=8, default='IN')
    lang = models.CharField(max_length=8, default='en')
    currency = models.CharField(max_length=8, default='INR')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'excel_mapper_mpn_oauth_token'
        ordering = ['-updated_at']

    def __str__(self):
        return f"Digi-Key OAuth token exp={self.expires_at.isoformat()}"


class GlobalMpnCache(models.Model):
    """
    Global persistent cache for MPN validation results.
    Stores MPN validation data across all sessions to avoid redundant API calls.
    """
    # Cache key components
    mpn_normalized = models.CharField(max_length=255, db_index=True)
    manufacturer_id = models.CharField(max_length=50, blank=True, null=True)
    site = models.CharField(max_length=8, default='IN')
    lang = models.CharField(max_length=8, default='en')
    currency = models.CharField(max_length=8, default='INR')

    # Validation results (JSON stored for flexibility)
    validation_data = models.JSONField()

    # Metadata
    is_valid = models.BooleanField(default=False)
    canonical_mpn = models.CharField(max_length=255, blank=True, null=True)  # Primary canonical MPN
    all_canonical_mpns = models.JSONField(default=list, blank=True)  # ALL canonical MPN options
    dkpn = models.CharField(max_length=100, blank=True, null=True)

    # Lifecycle info (for quick queries)
    status = models.CharField(max_length=50, blank=True, null=True)  # Active, NRND, Obsolete
    end_of_life = models.BooleanField(default=False)
    discontinued = models.BooleanField(default=False)

    # Cache management
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    last_accessed = models.DateTimeField(auto_now=True)
    access_count = models.IntegerField(default=0)

    class Meta:
        db_table = 'excel_mapper_global_mpn_cache'
        # Composite unique constraint for cache key
        unique_together = [['mpn_normalized', 'manufacturer_id', 'site', 'lang', 'currency']]
        indexes = [
            models.Index(fields=['mpn_normalized']),
            models.Index(fields=['is_valid']),
            models.Index(fields=['last_accessed']),
            models.Index(fields=['created_at']),
        ]
        ordering = ['-last_accessed']

    def __str__(self):
        status_info = f" ({self.status})" if self.status else ""
        return f"{self.mpn_normalized}{status_info} - Valid: {self.is_valid}"

    def increment_access(self):
        """Increment access count and update last accessed time"""
        self.access_count += 1
        from django.utils import timezone
        self.last_accessed = timezone.now()
        self.save(update_fields=['access_count', 'last_accessed'])

    @classmethod
    def create_cache_key(cls, mpn_norm: str, manufacturer_id: str = None,
                        site: str = 'IN', lang: str = 'en', currency: str = 'INR') -> str:
        """Create a cache key string for logging/debugging"""
        mid = manufacturer_id or 'any'
        return f"global_mpn:{mpn_norm}:{mid}:{site}:{lang}:{currency}"

    @classmethod
    def get_cached_result(cls, mpn_norm: str, manufacturer_id: str = None,
                         site: str = 'IN', lang: str = 'en', currency: str = 'INR'):
        """Get cached validation result if exists"""
        try:
            cache_entry = cls.objects.get(
                mpn_normalized=mpn_norm,
                manufacturer_id=manufacturer_id or '',
                site=site,
                lang=lang,
                currency=currency
            )
            cache_entry.increment_access()
            return cache_entry.validation_data
        except cls.DoesNotExist:
            return None

    @classmethod
    def store_result(cls, mpn_norm: str, validation_data: dict, manufacturer_id: str = None,
                    site: str = 'IN', lang: str = 'en', currency: str = 'INR'):
        """Store validation result in global cache"""
        # Extract key fields for database columns (for quick queries)
        is_valid = validation_data.get('valid', False)
        canonical_mpn = validation_data.get('canonical_mpn', '')
        all_canonical_mpns = validation_data.get('all_canonical_mpns', [])  # NEW: Store all options
        dkpn = validation_data.get('dkpn', '')

        lifecycle = validation_data.get('lifecycle') or {}
        status = lifecycle.get('status', '')
        end_of_life = lifecycle.get('endOfLife', False)
        discontinued = lifecycle.get('discontinued', False)

        # Create or update cache entry
        cache_entry, created = cls.objects.update_or_create(
            mpn_normalized=mpn_norm,
            manufacturer_id=manufacturer_id or '',
            site=site,
            lang=lang,
            currency=currency,
            defaults={
                'validation_data': validation_data,
                'is_valid': is_valid,
                'canonical_mpn': canonical_mpn,
                'all_canonical_mpns': all_canonical_mpns,  # NEW: Store all canonical MPNs
                'dkpn': dkpn,
                'status': status,
                'end_of_life': end_of_life,
                'discontinued': discontinued,
                'access_count': 1,
            }
        )

        if not created:
            cache_entry.increment_access()

        return cache_entry

    @classmethod
    def get_cache_stats(cls):
        """Get cache statistics"""
        from django.db.models import Count, Q
        from django.utils import timezone
        import datetime

        total_entries = cls.objects.count()
        valid_entries = cls.objects.filter(is_valid=True).count()
        invalid_entries = cls.objects.filter(is_valid=False).count()

        # Recent activity (last 7 days)
        week_ago = timezone.now() - datetime.timedelta(days=7)
        recent_access = cls.objects.filter(last_accessed__gte=week_ago).count()

        # Top accessed MPNs
        top_mpns = cls.objects.order_by('-access_count')[:10]

        return {
            'total_entries': total_entries,
            'valid_entries': valid_entries,
            'invalid_entries': invalid_entries,
            'recent_access_count': recent_access,
            'cache_hit_rate': f"{(recent_access/total_entries*100):.1f}%" if total_entries > 0 else "0%",
            'top_mpns': [{'mpn': entry.mpn_normalized, 'access_count': entry.access_count, 'valid': entry.is_valid} for entry in top_mpns]
        }

    @classmethod
    def cleanup_old_entries(cls, days_old: int = 365):
        """Clean up entries that haven't been accessed in X days"""
        from django.utils import timezone
        import datetime

        cutoff_date = timezone.now() - datetime.timedelta(days=days_old)
        old_entries = cls.objects.filter(last_accessed__lt=cutoff_date)
        count = old_entries.count()
        old_entries.delete()
        return count

    @classmethod
    def cleanup_invalid_entries(cls, days_old: int = 30):
        """Clean up invalid/error entries older than X days"""
        from django.utils import timezone
        import datetime

        cutoff_date = timezone.now() - datetime.timedelta(days=days_old)
        invalid_entries = cls.objects.filter(
            is_valid=False,
            created_at__lt=cutoff_date
        )
        count = invalid_entries.count()
        invalid_entries.delete()
        return count
