from pathlib import Path
from typing import Dict, Any

from django.conf import settings


SFO_TEMPLATE_NAME = "Default Item.xlsx"
SFO_TEMPLATE_SHEET_NAME = "Sheet1"
SFO_TEMPLATE_HEADER_ROW = 4


def get_sfo_template_path() -> Path:
    """Resolve the built-in SFO destination template in local and Docker layouts."""
    base_dir = Path(settings.BASE_DIR)
    candidates = [
        base_dir / "SFO_Technologies" / SFO_TEMPLATE_NAME,
        base_dir.parent / "SFO_Technologies" / SFO_TEMPLATE_NAME,
        Path.cwd() / "SFO_Technologies" / SFO_TEMPLATE_NAME,
    ]

    for candidate in candidates:
        if candidate.exists():
            return candidate

    return candidates[0]


def get_sfo_template_metadata() -> Dict[str, Any]:
    return {
        "template_path": str(get_sfo_template_path()),
        "original_template_name": SFO_TEMPLATE_NAME,
        "template_sheet_name": SFO_TEMPLATE_SHEET_NAME,
        "template_header_row": SFO_TEMPLATE_HEADER_ROW,
        "uses_uploaded_template": False,
    }
