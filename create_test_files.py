#!/usr/bin/env python3

import pandas as pd
import os

# Create directory for test files
test_dir = "test_files"
os.makedirs(test_dir, exist_ok=True)

print("📝 Creating dummy Excel files for testing...")

# 1. Create Client BOM Data (input data)
client_data = {
    'Part Number': ['CAP001', 'RES002', 'IC003', 'LED004', 'SW005'],
    'Description': ['10uF Ceramic Capacitor', '1K Ohm Resistor', 'ATmega328P Microcontroller', 'Red LED 5mm', 'Tactile Switch'],
    'Quantity': [5, 10, 1, 2, 3],
    'Unit': ['pcs', 'pcs', 'pcs', 'pcs', 'pcs'],
    'Manufacturer': ['Murata', 'Yageo', 'Atmel', 'Kingbright', 'Omron'],
    'MPN': ['GRM188R71H103KA01D', 'RC0603FR-071KL', 'ATMEGA328P-PU', 'WP7113ID', 'B3F-1000'],
    'Category': ['Passive', 'Passive', 'IC', 'Display', 'Switch'],
    'Voltage': ['50V', '0.1W', '5V', '2V', '12V'],
    'Package': ['0603', '0603', 'DIP-28', '5mm', 'THT'],
    'Datasheet': ['http://example.com/cap1.pdf', 'http://example.com/res1.pdf', 'http://example.com/ic1.pdf', 'http://example.com/led1.pdf', 'http://example.com/sw1.pdf']
}

client_df = pd.DataFrame(client_data)
client_file = os.path.join(test_dir, "client_bom_data.xlsx")
client_df.to_excel(client_file, index=False)
print(f"✅ Created client file: {client_file}")

# 2. Create Factwise Template (target format)
template_data = {
    'Item name': ['', '', '', '', ''],
    'Item description': ['', '', '', '', ''],
    'Measurement unit': ['', '', '', '', ''],
    'Quantity required': ['', '', '', '', ''],
    'Manufacturer name': ['', '', '', '', ''],
    'Manufacturer part number': ['', '', '', '', ''],
    'Component category': ['', '', '', '', ''],
    'Specifications': ['', '', '', '', ''],
    'Package type': ['', '', '', '', ''],
    'Datasheet URL': ['', '', '', '', ''],
    'Additional notes': ['', '', '', '', ''],
    'Lead time': ['', '', '', '', ''],
    'Unit price': ['', '', '', '', '']
}

template_df = pd.DataFrame(template_data)
template_file = os.path.join(test_dir, "factwise_template.xlsx")
template_df.to_excel(template_file, index=False)
print(f"✅ Created template file: {template_file}")

print("\n📊 Test files created:")
print(f"   Client BOM: {client_file}")
print(f"   Template:   {template_file}")
print("\n🎯 Client data columns:", list(client_df.columns))
print("🎯 Template columns:", list(template_df.columns))

print("\n📝 Suggested mappings for testing:")
mappings = [
    "Part Number → Item name",
    "Description → Item description", 
    "Unit → Measurement unit",
    "Quantity → Quantity required",
    "Manufacturer → Manufacturer name",
    "MPN → Manufacturer part number",
    "Category → Component category",
    "Voltage → Specifications",
    "Package → Package type",
    "Datasheet → Datasheet URL"
]

for mapping in mappings:
    print(f"   • {mapping}")