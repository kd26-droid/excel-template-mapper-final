import pandas as pd
import numpy as np
import re
import unicodedata
from typing import Dict, List, Optional, Tuple, Any, Union
from pathlib import Path
import json
from rapidfuzz import fuzz, distance

from .delimited_reader import read_delimited_text_safely
from .services.mpn_pattern_library import (
    score_column_as_manufacturer,
    score_column_as_mpn,
)

MAPPING_SAMPLE_ROWS = 500


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
            'manufacturer': [
                'mfr',
                'mfg',
                'mfgr',
                'manufacturer_name',
                'mfr_name',
                'mfg_name',
                'maker',
                'brand',
                'fabricant',
                'fab',
                'supplier',
                'vendor',
                'source',
            ],
            'specification': ['spec', 'properties'],
            'value': ['val', 'data'],
            'reference': ['ref', 'designator'],
            'type': ['category', 'class'],
            'price': ['cost', 'rate']
        }
        
        self.abbreviations = {
            'qty': 'quantity',
            'desc': 'description',
            'mfr': 'manufacturer',
            'mfg': 'manufacturer',
            'mfgr': 'manufacturer',
            'fab': 'manufacturer',
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
                df = read_delimited_text_safely(file_path, header=header_row, nrows=1)
            else:
                try:
                    if sheet_name is None:
                        xl_file = pd.ExcelFile(file_path)
                        sheet_name = xl_file.sheet_names[0]
                    
                    df = pd.read_excel(file_path, sheet_name=sheet_name, 
                                     header=header_row, nrows=1)
                except Exception:
                    # Some supplier "xls" exports are really tab/comma-delimited
                    # text with an Excel extension. Pandas cannot infer them as
                    # workbooks, but it can parse the text table.
                    df = self._read_delimited_text(file_path, header_row, nrows=1)
            
            headers = [str(col).strip() for col in df.columns if str(col).strip()]
            return headers
            
        except Exception as e:
            print(f"Error reading headers from {file_path}: {e}")
            return []

    def _read_delimited_text(self, file_path: Union[str, Path], header_row: int = 0, **kwargs):
        return read_delimited_text_safely(file_path, header=header_row, **kwargs)
    
    def read_sample_data(self, file_path: Union[str, Path], 
                        sheet_name: str = None, 
                        header_row: int = 0, 
                        sample_rows: int = MAPPING_SAMPLE_ROWS) -> Dict[str, List[str]]:
        """Read sample data from file for pattern analysis."""
        try:
            file_path = Path(file_path)
            if not file_path.exists():
                raise FileNotFoundError(f"File not found: {file_path}")
            
            if str(file_path).lower().endswith('.csv'):
                df = read_delimited_text_safely(file_path, header=header_row, nrows=sample_rows)
            else:
                try:
                    if sheet_name is None:
                        xl_file = pd.ExcelFile(file_path)
                        sheet_name = xl_file.sheet_names[0]
                    
                    df = pd.read_excel(file_path, sheet_name=sheet_name, 
                                     header=header_row, nrows=sample_rows)
                except Exception:
                    df = self._read_delimited_text(file_path, header_row, nrows=sample_rows)
            
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

    def classify_mapping_role(self, header: str) -> str:
        """Classify headers whose values should participate in mapping decisions."""
        header_text = unicodedata.normalize("NFKD", str(header or ""))
        header_text = "".join(char for char in header_text if not unicodedata.combining(char))
        text = re.sub(r"[\W_]+", " ", header_text.lower()).strip()
        if not text:
            return ""

        is_mpn = (
            "mpn" in text
            or "manufacturer part" in text
            or "mfr part" in text
            or "mfg part" in text
            or "equivalent part" in text
            or "ref fab" in text
            or "ref fabricant" in text
            or "reference fabricant" in text
            or "fabricant ref" in text
            or "fabricant reference" in text
            or ("part number" in text and ("manufacturer" in text or re.search(r"\bmfr\b", text) or re.search(r"\bmfg\b", text)))
        )
        if is_mpn:
            return "mpn"

        is_cpn = (
            "cpn" in text
            or "customer part" in text
            or "client part" in text
            or "internal part" in text
            or "item code" in text
            or "part code" in text
            or "ref article" in text
            or "reference article" in text
            or text in {"part", "part no", "part number", "pn", "p n"}
            or ("part number" in text and "customer" in text)
        )
        if is_cpn:
            return "cpn"

        is_mfr = (
            "manufacturer" in text
            or re.search(r"\bmfr\b", text)
            or re.search(r"\bmfg\b", text)
            or "maker" in text
            or "brand" in text
        )
        if is_mfr:
            return "manufacturer"

        return ""

    def calculate_value_priority_score(
        self,
        template_header: str,
        client_header: str,
        sample_values: List[str],
        header_score: float,
    ) -> Tuple[float, str]:
        """Blend header similarity with sampled value shape for MPN/MFR fields.

        MPN-style fields are easy to mis-map from headers alone ("Part Number"
        could be CPN or MPN), so sampled values now carry the larger share of the
        score when the destination is MPN/CPN. If no sample values are available,
        the caller keeps the header-only score.
        """
        target_role = self.classify_mapping_role(template_header)
        if not target_role or not sample_values:
            return header_score, ""

        source_role = self.classify_mapping_role(client_header)
        role_bonus = 0.05 if source_role == target_role else 0.0

        if target_role == "mpn":
            value_signal = score_column_as_mpn(sample_values)
            value_score = value_signal["score"]
            manufacturer_context_rate = value_signal.get("manufacturer_context_rate", 0.0)
            label_rate = value_signal.get("label_rate", 0.0)
            match_rate = value_signal.get("match_rate", 0.0)
            document_context_rate = value_signal.get("document_context_rate", 0.0)

            value_priority_score = min(
                1.0,
                value_score
                + (manufacturer_context_rate * 0.12)
                + (label_rate * 0.08)
            )
            source_role_bonus = 0.0
            if source_role == "mpn":
                source_role_bonus = 0.10
            elif source_role == "manufacturer" and manufacturer_context_rate >= 0.20:
                # Headers like "Manufacturer info" often contain "MPN (MFR)"
                # pairs. In that case the values are the deciding evidence.
                source_role_bonus = 0.05

            source_penalty = 0.0
            if source_role == "cpn" and manufacturer_context_rate < 0.15:
                source_penalty += 0.18
            if source_role == "manufacturer" and manufacturer_context_rate < 0.20 and label_rate < 0.10:
                source_penalty += 0.12
            if document_context_rate >= 0.30:
                source_penalty += 0.10

            final_score = (value_priority_score * 0.80) + (header_score * 0.20) + source_role_bonus - source_penalty
            if match_rate < 0.15 and source_role != "mpn":
                final_score = min(final_score, 0.39)
            final_score = max(0.0, min(1.0, final_score))
            explanation = (
                f"MPN value-first match "
                f"(values: {match_rate:.0%}, manufacturer context: {manufacturer_context_rate:.0%}, header: {header_score:.2f})"
            )
            return final_score, explanation

        if target_role == "cpn":
            value_signal = score_column_as_mpn(sample_values)
            value_score = value_signal["score"]
            final_score = min(1.0, (header_score * 0.45) + (value_score * 0.55) + role_bonus)
            explanation = (
                f"Part-number header + value match "
                f"(values: {value_signal['match_rate']:.0%}, header: {header_score:.2f})"
            )
            return final_score, explanation

        if target_role == "manufacturer":
            value_signal = score_column_as_manufacturer(sample_values)
            value_score = value_signal["score"]
            final_score = min(1.0, (header_score * 0.55) + (value_score * 0.45) + role_bonus)
            explanation = (
                f"Manufacturer header + value match "
                f"(values: {value_signal['match_rate']:.0%}, header: {header_score:.2f})"
            )
            return final_score, explanation

        return header_score, ""
    
    def map_headers_to_template(self, client_file: str, template_file: str,
                               client_sheet_name: str = None, template_sheet_name: str = None,
                               client_header_row: int = 0, template_header_row: int = 0,
                               extra_template_headers: List[str] = None) -> List[Dict]:
        """Map client headers to template headers.

        ``extra_template_headers`` are destination columns the app adds on top of
        the template workbook. Without them the matcher scores against the file
        alone, so a column the mapping page offers but the file does not contain
        can never be suggested - the user sees the column, sees it empty, and has
        no way to know it was never a candidate.
        """
        try:
            template_headers = self.read_excel_headers(template_file, template_sheet_name, template_header_row)
            for header in (extra_template_headers or []):
                if header and header not in template_headers:
                    template_headers.append(header)
            client_headers = self.read_excel_headers(client_file, client_sheet_name, client_header_row)
            
            try:
                client_sample_data = self.read_sample_data(
                    client_file,
                    client_sheet_name,
                    client_header_row,
                    sample_rows=MAPPING_SAMPLE_ROWS,
                )
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
                    
                    sample_values = client_sample_data.get(client_header, [])

                    # Header-name score: exact/synonym/fuzzy matching.
                    header_score = (
                        semantic_score * self.similarity_weights['semantic'] +
                        jaro_score * self.similarity_weights['jaro_winkler'] +
                        token_score * self.similarity_weights['token_sort'] +
                        partial_score * self.similarity_weights['partial_ratio']
                    )
                    final_score, value_explanation = self.calculate_value_priority_score(
                        template_header,
                        client_header,
                        sample_values,
                        header_score,
                    )
                    
                    if final_score > best_score:
                        best_score = final_score
                        best_match = client_header
                        
                        if value_explanation:
                            best_explanation = value_explanation
                        elif semantic_score > 0:
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
