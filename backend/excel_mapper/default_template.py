from pathlib import Path
from typing import Dict, Any

from django.conf import settings


SFO_TEMPLATE_NAME = "Default Item.xlsx"
SFO_TEMPLATE_SHEET_NAME = "Sheet1"
SFO_TEMPLATE_HEADER_ROW = 4

SFO_TEMPLATE_REFERENCE_ROWS = [
    [
        'Every item must be identified using this unique code. If this item code already exists, the existing item will be updated. Else a new item will be added.',
        "The item's unique code as it appears in your internal ERP system (e.g., SAP, Oracle)",
        "The company's internal part number (CPN)",
        'The official part number (MPN) from the original manufacturer.',
        'The Harmonized System of Nomenclature (HSN) code for this item.',
        'Item name, visible to vendors during events.',
        'Visible to vendors during events.',
        'Type of item',
        'At least one measurement unit must be added. Only these units can be selected in events and POs.',
        'These units can be selected in events and POs.',
        'Visible to vendors during events.',
        'Not visible to vendors.',
        'The name of a specification (e.g. color, manufacturor, weight, density) associated with this item',
        'The required value for the specification in the previous column',
        'The required measurement unit for the specification in the previous column',
        'The name of a specification (e.g. color, manufacturor, weight, density) associated with this item',
        'The required value for the specification in the previous column',
        'The required measurement unit for the specification in the previous column',
        'The name of a specification (e.g. color, manufacturor, weight, density) associated with this item',
        'The required value for the specification in the previous column',
        'The required measurement unit for the specification in the previous column',
        'Universal or internal identifier name for this item (e.g. SKU id, UCAS ID, pubchem ID)',
        'Value associated with identifier in previous column',
        'Choice TRUE: The entity is a buyer of the item; FALSE: The entity is not a buyer of the item',
        'The currency in which the entity buys the item (e.g.: INR, USD, JPY)',
        'The price in which the entity buys the item',
        'Choice TRUE: The entity is a seller of the item; FALSE: The entity is not a seller of the item',
        'Tag to group this item by',
        'Tag to group this item by',
        'Tag to group this item by',
        "The item's depth in the BOM hierarchy; 1 is a direct child of the finished good. Used to build the BOM file, not imported with the item.",
        'How much of this item the parent assembly consumes. Used to build the BOM file, not imported with the item.',
        'The quantity this BOM is defined for. Used to build the BOM file, not imported with the item.',
        'The name of the entity which procures this item. The settings after this column will apply for this entity only. An item can only be procured by entities to which it is linked. If multiple entities procure this item, then add more rows. The new rows can have different entity names and setings, but all the item details (to the left of this column) should be identical.',
        "Preferred vendors are highlighted when procuring items. It is recommended to include at least one preferred vendor per item. Vendor codes can be downloaded from the vendor directory of FactWise Admin if you do not have them handy. You can insert more columns named 'Preferred vendor code' to include multiple preferred vendors for an item",
        'Add an alternate, vendor-specific name for the item that applies only to the selected vendor',
        "Preferred vendors are highlighted when procuring items. It is recommended to include at least one preferred vendor per item. Vendor codes can be downloaded from the vendor directory of FactWise Admin if you do not have them handy. You can insert more columns named 'Preferred vendor code' to include multiple preferred vendors for an item",
        'Add an alternate, vendor-specific name for the item that applies only to the selected vendor',
    ],
    [
        'Required, Max 200 characters',
        'Optional, Max 200 characters',
        'Optional, Max 200 characters',
        'Optional, Max 200 characters',
        'Optional, Max 200 characters',
        'Required, Max 100 characters',
        'Optional, ',
        'Required, Allowed values: Raw material, Finished good',
        "Required, measurement unit names or abbreviations. e.g. 'kg, gm, units'",
        "Optional, measurement unit names or abbreviations. e.g. 'kg, gm, units'",
        'Optional, ',
        'Optional, ',
        "Optional, Max 100 characters e.g. 'Color'",
        "Optional, Max 100 characters. If multiple options are fine, provide a list separated with '/' e.g. 'Blue / Green'",
        "Optional, measurement unit names or abbreviations. e.g. 'kg, gm, units'",
        "Optional, Max 100 characters e.g. 'Color'",
        "Optional, Max 100 characters. If multiple options are fine, provide a list separated with '/' e.g. 'Blue / Green'",
        "Optional, measurement unit names or abbreviations. e.g. 'kg, gm, units'",
        "Optional, Max 100 characters e.g. 'Color'",
        "Optional, Max 100 characters. If multiple options are fine, provide a list separated with '/' e.g. 'Blue / Green'",
        "Optional, measurement unit names or abbreviations. e.g. 'kg, gm, units'",
        'Optional, Max 100 characters e.g. UCAS ID',
        'Optional, Max 100 characters e.g. 123-456-7890',
        'Optional, ',
        'Optional, ',
        'Optional, ',
        'Optional, ',
        'Optional, Max 30 characters',
        'Optional, Max 30 characters',
        'Optional, Max 30 characters',
        'Optional, whole number',
        'Optional, number, zero allowed',
        'Optional, number greater than zero',
        'Required, Name of an entity which should be able to procure this item. The entity should belong to the enterprise the current user belongs to',
        "Optional, Vendor code of preferred vendor for this item. The vendor code should exist for the enterprise the current user belongs toe.g. 'V001'",
        'Optional, Max 100 characters',
        "Optional, Vendor code of preferred vendor for this item. The vendor code should exist for the enterprise the current user belongs toe.g. 'V001'",
        'Optional, Max 100 characters',
    ],
    [
        ' ',
    ],
    [
        'Item code',
        'SAP Item ID',
        'CPN Code',
        'MPN Code',
        'HSN Code',
        'Item name',
        'Description',
        'Item type',
        'Measurement unit',
        'Alternate UoM 1',
        'Notes',
        'SAP Description',
        'Specification name (1)',
        'Specification value (1)',
        'Specification UOM (1)',
        'Specification name (2)',
        'Specification value (2)',
        'Specification UOM (2)',
        'Specification name (3)',
        'Specification value (3)',
        'Specification UOM (3)',
        'Item identifications name (1)',
        'Item identifications value (1)',
        'Procurement item',
        'Procurement item price currency code',
        'Procurement item price',
        'Sales item',
        'Tag (1)',
        'Tag (2)',
        'Tag (3)',
        'Level',
        'Quantity',
        'Base BOM Qty',
        'Procurement entity name',
        'Preferred vendor code',
        'Alternate Item Name for Preferred Vendor',
        'Preferred vendor code',
        'Alternate Item Name for Preferred Vendor',
    ],
]


def get_sfo_reference_headers() -> list:
    return list(SFO_TEMPLATE_REFERENCE_ROWS[SFO_TEMPLATE_HEADER_ROW - 1])


def get_sfo_reference_optional_map() -> Dict[str, bool]:
    headers = get_sfo_reference_headers()
    validation_row = SFO_TEMPLATE_REFERENCE_ROWS[1]
    return {
        header: "optional" in str(validation_row[index] if index < len(validation_row) else "").lower()
        for index, header in enumerate(headers)
    }


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
        "reference_headers": get_sfo_reference_headers(),
        "reference_optional_map": get_sfo_reference_optional_map(),
        "uses_uploaded_template": False,
    }
