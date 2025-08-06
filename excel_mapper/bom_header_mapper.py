import pandas as pd
import numpy as np
import re
from typing import Dict, List, Optional, Tuple, Any, Union
from pathlib import Path
import json
from rapidfuzz import fuzz, distance


class AdvancedElectronicsSpecificationParser:
    """
    Simplified specification parser without hardcoded patterns.
    Uses configurable patterns that can be loaded from external sources.
    """
    
    def __init__(self, config_file: Optional[str] = None):
        """Initialize with optional configuration file."""
        self.component_patterns = {}
        self.value_patterns = {}
        self.package_patterns = {}
        self.material_patterns = {}
        self.specification_mappings = {}
        self.unit_conversions = {}
        
        if config_file and Path(config_file).exists():
            self.load_config(config_file)
        else:
            self._setup_minimal_defaults()
    
    def load_config(self, config_file: str):
        """Load configuration from JSON file."""
        try:
            with open(config_file, 'r') as f:
                config = json.load(f)
                self.component_patterns = config.get('component_patterns', {})
                self.value_patterns = config.get('value_patterns', {})
                self.package_patterns = config.get('package_patterns', {})
                self.material_patterns = config.get('material_patterns', {})
                self.specification_mappings = config.get('specification_mappings', {})
                self.unit_conversions = config.get('unit_conversions', {})
        except Exception as e:
            print(f"Warning: Could not load config file {config_file}: {e}")
            self._setup_minimal_defaults()
    
    def _setup_minimal_defaults(self):
        """Setup minimal default patterns for basic functionality."""
        # Minimal patterns for basic component detection
        self.component_patterns = {
            'capacitor': [r'(?i)\bcap\b', r'(?i)capacitor'],
            'resistor': [r'(?i)\bres\b', r'(?i)resistor'],
            'ic': [r'(?i)\bic\b', r'(?i)integrated'],
        }
        
        # Basic value patterns
        self.value_patterns = {
            'numeric': [r'\d+(?:\.\d+)?'],
            'percentage': [r'\d+(?:\.\d+)?%'],
        }
        
        # Minimal specification mappings
        self.specification_mappings = {
            'default': ['value', 'tolerance', 'voltage', 'current']
        }
    
    def detect_component_type(self, description: str) -> str:
        """Detect component type from description using configured patterns."""
        if not description or not self.component_patterns:
            return 'unknown'
        
        description_lower = description.lower()
        scores = {}
        
        for comp_type, patterns in self.component_patterns.items():
            score = 0
            for pattern in patterns:
                if re.search(pattern, description_lower):
                    score += 1
            if score > 0:
                scores[comp_type] = score
        
        return max(scores, key=scores.get) if scores else 'unknown'
    
    def parse_description(self, description: str, max_specs: int = 5) -> Dict[str, str]:
        """Parse component description into specifications."""
        if not description:
            return {}
        
        # Basic parsing without hardcoded patterns
        results = {}
        
        # Extract numeric values
        numeric_matches = re.findall(r'\d+(?:\.\d+)?', description)
        if numeric_matches:
            results['primary_value'] = numeric_matches[0]
        
        # Extract percentage values
        percentage_matches = re.findall(r'(\d+(?:\.\d+)?)%', description)
        if percentage_matches:
            results['tolerance'] = f"{percentage_matches[0]}%"
        
        # Extract voltage patterns
        voltage_matches = re.findall(r'(\d+(?:\.\d+)?)\s*v(?:olt)?', description.lower())
        if voltage_matches:
            results['voltage'] = f"{voltage_matches[0]}V"
        
        return dict(list(results.items())[:max_specs])
    
    def analyze_specification_potential(self, descriptions: List[str]) -> Dict[str, Any]:
        """Analyze potential for specification parsing in descriptions."""
        if not descriptions:
            return {'parsing_available': False, 'reason': 'No descriptions provided'}
        
        # Simple analysis without hardcoded patterns
        total_descriptions = len(descriptions)
        parsed_count = 0
        
        for desc in descriptions:
            if self.parse_description(desc):
                parsed_count += 1
        
        parsing_rate = parsed_count / total_descriptions if total_descriptions > 0 else 0
        
        return {
            'parsing_available': parsing_rate > 0.1,  # 10% threshold
            'parsing_rate': parsing_rate,
            'total_descriptions': total_descriptions,
            'parsed_descriptions': parsed_count
        }


class BOMHeaderMapper:
    """
    Simplified header mapping system without hardcoded domain knowledge.
    Uses configurable synonyms and patterns.
    """
    
    def __init__(self, config_file: Optional[str] = None):
        """Initialize the mapper with optional configuration."""
        self.min_confidence_threshold = 40
        self.spec_parser = AdvancedElectronicsSpecificationParser(config_file)
        
        # Initialize empty structures
        self.synonyms = {}
        self.abbreviations = {}
        self.data_patterns = {}
        self.similarity_weights = {
            'semantic': 0.40,
            'jaro_winkler': 0.25,
            'token_sort': 0.15,
            'partial_ratio': 0.10,
            'levenshtein': 0.10
        }
        
        if config_file and Path(config_file).exists():
            self.load_config(config_file)
        else:
            self._setup_minimal_defaults()
    
    def load_config(self, config_file: str):
        """Load configuration from JSON file."""
        try:
            with open(config_file, 'r') as f:
                config = json.load(f)
                self.synonyms = config.get('synonyms', {})
                self.abbreviations = config.get('abbreviations', {})
                self.data_patterns = config.get('data_patterns', {})
                self.similarity_weights = config.get('similarity_weights', self.similarity_weights)
                self.min_confidence_threshold = config.get('min_confidence_threshold', 40)
        except Exception as e:
            print(f"Warning: Could not load config file {config_file}: {e}")
            self._setup_minimal_defaults()
    
    def _setup_minimal_defaults(self):
        """Setup minimal default mappings for basic functionality."""
        self.synonyms = {
            'item_code': ['part_number', 'part_no', 'item_id', 'sku'],
            'item_name': ['description', 'name', 'title'],
            'quantity': ['qty', 'amount', 'count'],
            'unit': ['uom', 'unit_of_measure'],
            'manufacturer': ['mfg', 'maker', 'brand'],
            'specification': ['spec', 'properties'],
            'value': ['val', 'data'],
            'reference': ['ref', 'designator'],
            'type': ['category', 'class'],
            'price': ['cost', 'rate']
        }
        
        self.abbreviations = {
            'qty': 'quantity',
            'desc': 'description',
            'mfg': 'manufacturer',
            'uom': 'unit',
            'ref': 'reference',
            'spec': 'specification',
            'val': 'value'
        }
    
    def read_excel_headers(self, file_path: Union[str, Path], 
                          sheet_name: str = None, 
                          header_row: int = 0) -> List[str]:
        """Extract headers from an Excel or CSV file."""
        try:
            file_path = Path(file_path)
            if not file_path.exists():
                raise FileNotFoundError(f"File not found: {file_path}")
            
            if str(file_path).lower().endswith('.csv'):
                df = pd.read_csv(file_path, header=header_row, nrows=1)
            else:
                if sheet_name is None:
                    xl_file = pd.ExcelFile(file_path)
                    sheet_name = xl_file.sheet_names[0]
                
                df = pd.read_excel(file_path, sheet_name=sheet_name, 
                                 header=header_row, nrows=1)
            
            headers = [str(col).strip() for col in df.columns if str(col).strip()]
            return headers
            
        except Exception as e:
            print(f"Error reading headers from {file_path}: {e}")
            return []
    
    def read_sample_data(self, file_path: Union[str, Path], 
                        sheet_name: str = None, 
                        header_row: int = 0, 
                        sample_rows: int = 5) -> Dict[str, List[str]]:
        """Read sample data from file for pattern analysis."""
        try:
            file_path = Path(file_path)
            if not file_path.exists():
                raise FileNotFoundError(f"File not found: {file_path}")
            
            if str(file_path).lower().endswith('.csv'):
                df = pd.read_csv(file_path, header=header_row, nrows=sample_rows)
            else:
                if sheet_name is None:
                    xl_file = pd.ExcelFile(file_path)
                    sheet_name = xl_file.sheet_names[0]
                
                df = pd.read_excel(file_path, sheet_name=sheet_name, 
                                 header=header_row, nrows=sample_rows)
            
            sample_data = {}
            for col in df.columns:
                col_str = str(col).strip()
                if col_str:
                    sample_data[col_str] = [str(val) for val in df[col].dropna().tolist()]
            
            return sample_data
            
        except Exception as e:
            print(f"Error reading sample data from {file_path}: {e}")
            return {}
    
    def calculate_semantic_similarity(self, header1: str, header2: str) -> float:
        """Calculate semantic similarity between headers using configurable synonyms."""
        if not header1 or not header2:
            return 0.0
        
        header1_lower = header1.lower().strip()
        header2_lower = header2.lower().strip()
        
        # Direct match
        if header1_lower == header2_lower:
            return 1.0
        
        # Check synonyms
        for canonical, synonyms in self.synonyms.items():
            if header1_lower in synonyms and header2_lower in synonyms:
                return 0.95
            if header1_lower == canonical and header2_lower in synonyms:
                return 0.9
            if header2_lower == canonical and header1_lower in synonyms:
                return 0.9
        
        # Check abbreviations
        expanded1 = self.abbreviations.get(header1_lower, header1_lower)
        expanded2 = self.abbreviations.get(header2_lower, header2_lower)
        
        if expanded1 == expanded2:
            return 0.85
        
        return 0.0
    
    def map_headers_to_template(self, client_file: str, template_file: str, 
                               client_sheet_name: str = None, template_sheet_name: str = None,
                               client_header_row: int = 0, template_header_row: int = 0) -> List[Dict]:
        """Map client headers to template headers."""
        try:
            template_headers = self.read_excel_headers(template_file, template_sheet_name, template_header_row)
            client_headers = self.read_excel_headers(client_file, client_sheet_name, client_header_row)
            
            try:
                client_sample_data = self.read_sample_data(client_file, client_sheet_name, client_header_row)
            except Exception as e:
                client_sample_data = {header: [] for header in client_headers}
            
            results = []
            used_client_headers = set()
            
            for template_header in template_headers:
                best_match = None
                best_score = 0.0
                best_explanation = ""
                
                for client_header in client_headers:
                    if client_header in used_client_headers:
                        continue
                    
                    # Calculate similarity score
                    semantic_score = self.calculate_semantic_similarity(template_header, client_header)
                    jaro_score = fuzz.ratio(template_header.lower(), client_header.lower()) / 100.0
                    token_score = fuzz.token_sort_ratio(template_header.lower(), client_header.lower()) / 100.0
                    partial_score = fuzz.partial_ratio(template_header.lower(), client_header.lower()) / 100.0
                    
                    # Weighted average
                    final_score = (
                        semantic_score * self.similarity_weights['semantic'] +
                        jaro_score * self.similarity_weights['jaro_winkler'] +
                        token_score * self.similarity_weights['token_sort'] +
                        partial_score * self.similarity_weights['partial_ratio']
                    )
                    
                    if final_score > best_score:
                        best_score = final_score
                        best_match = client_header
                        
                        if semantic_score > 0:
                            best_explanation = f"Semantic match (score: {semantic_score:.2f})"
                        else:
                            best_explanation = f"Fuzzy match (score: {final_score:.2f})"
                
                # Convert to percentage
                confidence = int(best_score * 100)
                
                if best_match and confidence >= self.min_confidence_threshold:
                    used_client_headers.add(best_match)
                    mapped_header = best_match
                else:
                    mapped_header = None
                
                sample_data = client_sample_data.get(mapped_header, []) if mapped_header else []
                
                results.append({
                    'template_header': template_header,
                    'mapped_client_header': mapped_header,
                    'confidence': confidence,
                    'explanation': best_explanation,
                    'sample_data': sample_data[:3]  # First 3 samples
                })
            
            return results
            
        except Exception as e:
            print(f"Error in header mapping: {e}")
            return []
    
    def analyze_specification_potential(self, descriptions: List[str]) -> Dict[str, Any]:
        """Analyze specification parsing potential."""
        try:
            return self.spec_parser.analyze_specification_potential(descriptions)
        except Exception as e:
            return {'parsing_available': False, 'reason': f'Error analyzing specifications: {str(e)}'}


def main():
    """Example usage of the simplified BOM Header Mapper."""
    
    mapper = BOMHeaderMapper()
    
    test_descriptions = [
        "CHIP CAP,CER,100nF,16V,0402,10%,X7R",
        "RES CHIP 1.02K 1% 1/16W 0402 SMD",
        "LED,SINGLE,HIGH BRIGHT RED,WHITE PLCC-2",
        "IC-A,DC/DC CONVERTER,STEP-DOWN,600MA,ADJ,SOT23-5",
        "Multilayer Ceramic Capacitors MLCC - SMD/SMT 50V 0.1uF X7R 0805 5%"
    ]
    
    print("Simplified BOM Header Mapper")
    print("=" * 40)
    print("Specification Parsing Examples:")
    print("-" * 40)
    
    for i, desc in enumerate(test_descriptions, 1):
        print(f"\n{i}. Description: {desc}")
        print("-" * 30)
        
        parsed = mapper.spec_parser.parse_description(desc, max_specs=10)
        
        for spec_name, spec_value in parsed.items():
            print(f"   {spec_name}: {spec_value}")
    
    print(f"\n\n🔥 Simplified BOM Header Mapper Ready!")
    print(f"✅ Configurable component detection")
    print(f"✅ Basic value extraction")
    print(f"✅ External configuration support")


if __name__ == "__main__":
    main()