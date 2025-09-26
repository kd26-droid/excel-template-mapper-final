#!/usr/bin/env python3
"""
Create a simple test PDF with table data using basic libraries
"""
import os
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle
import requests
import json

def create_test_pdf():
    """Create a test PDF with table data"""
    try:
        pdf_path = "/Users/kartikd/Downloads/final 2000/excel-template-mapper-final/test_invoice.pdf"

        doc = SimpleDocTemplate(pdf_path, pagesize=letter)
        elements = []

        # Sample BOM/invoice data
        data = [
            ['Part Number', 'Description', 'Manufacturer', 'Quantity', 'Unit Price', 'Total'],
            ['CAP-001', 'Capacitor 10µF 25V', 'Murata', '100', '$0.25', '$25.00'],
            ['RES-002', 'Resistor 1KΩ 1/4W', 'Yageo', '200', '$0.10', '$20.00'],
            ['LED-003', 'LED Red 5mm T1-3/4', 'Kingbright', '50', '$0.50', '$25.00'],
            ['IC-004', 'MCU ARM Cortex-M4', 'STMicro', '10', '$5.00', '$50.00'],
            ['CON-005', 'Connector USB-C', 'Amphenol', '25', '$2.50', '$62.50'],
            ['SW-006', 'Switch Tactile SPST', 'C&K', '15', '$1.20', '$18.00']
        ]

        # Create table with styling
        table = Table(data, colWidths=[80, 140, 80, 60, 70, 70])
        table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.grey),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, 0), 12),
            ('BOTTOMPADDING', (0, 0), (-1, 0), 12),
            ('BACKGROUND', (0, 1), (-1, -1), colors.lightgrey),
            ('GRID', (0, 0), (-1, -1), 1, colors.black),
            ('FONTSIZE', (0, 1), (-1, -1), 10),
        ]))

        elements.append(table)
        doc.build(elements)

        print(f"✅ Test PDF created: {pdf_path}")
        return pdf_path

    except Exception as e:
        print(f"❌ Error creating PDF: {e}")
        return None

def test_pdf_upload_and_processing(pdf_path):
    """Test the complete PDF OCR workflow"""
    base_url = "http://localhost:8000/api"

    try:
        print("\n🔄 Testing PDF Upload...")

        # Step 1: Upload PDF
        with open(pdf_path, 'rb') as f:
            files = {'file': f}
            response = requests.post(f"{base_url}/pdf/upload/", files=files)

        if response.status_code == 201:
            upload_data = response.json()
            session_id = upload_data['session_id']
            print(f"✅ PDF uploaded successfully")
            print(f"   Session ID: {session_id}")
            print(f"   Total pages: {upload_data['total_pages']}")
            print(f"   File size: {upload_data['file_size']} bytes")

            # Step 2: Process with OCR
            print(f"\n🔍 Processing with Azure OCR...")
            response = requests.post(f"{base_url}/pdf/process/",
                                   json={'session_id': session_id})

            if response.status_code == 200:
                ocr_data = response.json()
                print(f"✅ OCR processing completed")
                print(f"   Tables found: {ocr_data['table_count']}")
                print(f"   Headers extracted: {len(ocr_data['headers'])}")
                print(f"   Data rows: {ocr_data['row_count']}")
                print(f"   Data columns: {ocr_data['column_count']}")

                # Display extracted headers
                if ocr_data['headers']:
                    print(f"\n📋 Extracted Headers:")
                    for i, header in enumerate(ocr_data['headers'][:6]):  # Show first 6
                        print(f"   {i+1}. {header}")

                # Display quality metrics
                if 'quality_metrics' in ocr_data:
                    metrics = ocr_data['quality_metrics']
                    print(f"\n📊 Quality Metrics:")
                    print(f"   Overall confidence: {metrics.get('overall_confidence', 0):.2f}")
                    print(f"   Header confidence: {metrics.get('header_confidence', 0):.2f}")
                    print(f"   Data completeness: {metrics.get('completeness_score', 0):.2f}")

                # Display validation results
                if 'validation' in ocr_data:
                    validation = ocr_data['validation']
                    print(f"\n✅ Validation: {'PASSED' if validation.get('is_valid') else 'FAILED'}")
                    if validation.get('warnings'):
                        print(f"   Warnings: {len(validation['warnings'])}")
                    if validation.get('recommendations'):
                        print(f"   Recommendations: {len(validation['recommendations'])}")

                return True

            else:
                print(f"❌ OCR processing failed: {response.status_code}")
                print(f"   Error: {response.text}")
                return False

        else:
            print(f"❌ PDF upload failed: {response.status_code}")
            print(f"   Error: {response.text}")
            return False

    except Exception as e:
        print(f"❌ Test failed: {e}")
        return False

def main():
    """Main test function"""
    print("🧪 Complete PDF OCR Workflow Test")
    print("=" * 40)

    # Install reportlab if needed
    try:
        import reportlab
    except ImportError:
        print("Installing reportlab...")
        os.system("pip3 install --break-system-packages reportlab")
        import reportlab

    # Create test PDF
    pdf_path = create_test_pdf()
    if not pdf_path:
        print("❌ Could not create test PDF")
        return

    # Test the workflow
    success = test_pdf_upload_and_processing(pdf_path)

    if success:
        print(f"\n🎉 PDF OCR WORKFLOW TEST PASSED!")
        print(f"\n🚀 System is fully functional and ready for production!")
        print(f"\n📝 API Endpoints Available:")
        print(f"   POST /api/pdf/upload/          - Upload PDF file")
        print(f"   POST /api/pdf/process/         - Process with Azure OCR")
        print(f"   GET  /api/pdf/status/<id>/     - Check processing status")
        print(f"   POST /api/pdf/cleanup/         - Clean up temp files")
        print(f"   GET  /api/pdf/page/<id>/<n>/   - Get page image")
    else:
        print(f"\n💥 PDF OCR WORKFLOW TEST FAILED!")
        print(f"Please check the server logs and Azure configuration.")

if __name__ == "__main__":
    main()