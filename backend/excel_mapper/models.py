# models.py

from django.db import models
import json
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