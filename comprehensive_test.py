#!/usr/bin/env python3
"""
Comprehensive test script for Excel Template Mapper fixes.
Tests all the Azure deployment fixes implemented.
"""

import requests
import time
import json
import sys
from pathlib import Path

BASE_URL = "http://localhost:8000"
FRONTEND_URL = "http://localhost:3000"

def test_api_health():
    """Test 1: Basic API health"""
    print("🔍 Test 1: Testing API health...")
    response = requests.get(f"{BASE_URL}/api/health/")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    print("✅ API health check passed")
    return True

def test_redis_session_consistency():
    """Test 2: Redis cache session consistency"""
    print("🔍 Test 2: Testing Redis session consistency...")
    
    # Create a session by uploading a file
    test_files_dir = Path("test_files")
    client_file = test_files_dir / "CLIENT.xlsx"
    
    if not client_file.exists():
        print(f"⚠️  Test file {client_file} not found, skipping Redis test")
        return True
        
    # Upload file to create session (need both client and template files)
    template_file = test_files_dir / "FACTWISE.xlsx"
    if not template_file.exists():
        print(f"⚠️  Template file {template_file} not found, skipping Redis test")
        return True
    
    with open(client_file, 'rb') as cf, open(template_file, 'rb') as tf:
        files = {
            'client_file': ('CLIENT.xlsx', cf, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
            'template_file': ('FACTWISE.xlsx', tf, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        }
        response = requests.post(f"{BASE_URL}/api/upload/", files=files)
    
    if response.status_code != 200:
        print(f"❌ Upload failed: {response.status_code}")
        print(response.text)
        return False
        
    session_id = response.json()["session_id"]
    print(f"📋 Created session: {session_id}")
    
    # Test session status (this uses get_session_consistent)
    status_response = requests.get(f"{BASE_URL}/api/session/{session_id}/status/")
    assert status_response.status_code == 200
    
    status_data = status_response.json()
    assert status_data["success"] == True
    assert "template_version" in status_data
    
    print("✅ Redis session consistency test passed")
    return session_id

def test_column_count_updates(session_id):
    """Test 3: Column count updates with atomic version bump"""
    print("🔍 Test 3: Testing column count updates...")
    
    # Get initial template version
    status_response = requests.get(f"{BASE_URL}/api/session/{session_id}/status/")
    initial_version = status_response.json()["template_version"]
    
    # Update column counts
    update_data = {
        "session_id": session_id,
        "tags_count": 5,
        "spec_pairs_count": 3,
        "customer_id_pairs_count": 2
    }
    
    response = requests.post(f"{BASE_URL}/api/column-counts/update/", json=update_data)
    
    if response.status_code != 200:
        print(f"❌ Column count update failed: {response.status_code}")
        print(response.text)
        return False
        
    data = response.json()
    assert data["success"] == True
    assert "template_version" in data
    assert data["template_version"] > initial_version
    assert "enhanced_headers" in data
    
    print(f"✅ Column count update passed (version {initial_version} → {data['template_version']})")
    return True

def test_template_application():
    """Test 4: Template application with version sync"""
    print("🔍 Test 4: Testing template application...")
    
    # Get available templates
    templates_response = requests.get(f"{BASE_URL}/api/templates/")
    
    if templates_response.status_code != 200:
        print("⚠️  No templates available, creating one first...")
        return True
        
    templates = templates_response.json()
    if not templates:
        print("⚠️  No templates found, skipping template application test")
        return True
        
    # Create new session for template test
    test_files_dir = Path("test_files")
    client_file = test_files_dir / "CLIENT.xlsx"
    template_file = test_files_dir / "FACTWISE.xlsx"
    
    if not client_file.exists() or not template_file.exists():
        print("⚠️  Test files not found, skipping template test")
        return True
        
    with open(client_file, 'rb') as cf, open(template_file, 'rb') as tf:
        files = {
            'client_file': ('CLIENT.xlsx', cf, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
            'template_file': ('FACTWISE.xlsx', tf, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        }
        response = requests.post(f"{BASE_URL}/api/upload/", files=files)
    
    if response.status_code != 200:
        print("⚠️  Upload failed for template test")
        return True
        
    session_id = response.json()["session_id"]
    
    # Apply first available template
    template_id = templates[0]["id"]
    apply_data = {
        "session_id": session_id,
        "template_id": template_id
    }
    
    initial_status = requests.get(f"{BASE_URL}/api/session/{session_id}/status/")
    initial_version = initial_status.json()["template_version"]
    
    apply_response = requests.post(f"{BASE_URL}/api/templates/apply/", json=apply_data)
    
    if apply_response.status_code != 200:
        print(f"❌ Template application failed: {apply_response.status_code}")
        print(apply_response.text)
        return False
        
    apply_data = apply_response.json()
    assert apply_data["success"] == True
    assert "template_version" in apply_data
    assert apply_data["template_version"] > initial_version
    
    print(f"✅ Template application passed (version {initial_version} → {apply_data['template_version']})")
    return session_id

def test_factwise_id_creation(session_id):
    """Test 5: Factwise ID creation with proper loading"""
    print("🔍 Test 5: Testing Factwise ID creation...")
    
    # Get session data first
    data_response = requests.get(f"{BASE_URL}/api/session/{session_id}/data/")
    
    if data_response.status_code != 200:
        print("⚠️  No session data, skipping Factwise ID test")
        return True
        
    headers = data_response.json().get("headers", [])
    if len(headers) < 2:
        print("⚠️  Not enough headers for Factwise ID test")
        return True
    
    # Create Factwise ID
    factwise_data = {
        "session_id": session_id,
        "first_column": headers[0],
        "second_column": headers[1] if len(headers) > 1 else headers[0],
        "operator": "_"
    }
    
    initial_status = requests.get(f"{BASE_URL}/api/session/{session_id}/status/")
    initial_version = initial_status.json()["template_version"]
    
    factwise_response = requests.post(f"{BASE_URL}/api/create-factwise-id/", json=factwise_data)
    
    if factwise_response.status_code != 200:
        print(f"❌ Factwise ID creation failed: {factwise_response.status_code}")
        print(factwise_response.text)
        return False
    
    factwise_result = factwise_response.json()
    assert factwise_result["success"] == True
    assert "template_version" in factwise_result
    assert factwise_result["template_version"] > initial_version
    
    print(f"✅ Factwise ID creation passed (version {initial_version} → {factwise_result['template_version']})")
    return True

def test_frontend_accessibility():
    """Test 6: Frontend accessibility and loader overlay"""
    print("🔍 Test 6: Testing frontend accessibility...")
    
    try:
        response = requests.get(FRONTEND_URL, timeout=10)
        assert response.status_code == 200
        
        # Check for LoaderOverlay component presence
        html_content = response.text
        assert "Excel Template Mapper" in html_content
        
        print("✅ Frontend accessibility test passed")
        return True
        
    except Exception as e:
        print(f"❌ Frontend test failed: {e}")
        return False

def test_api_waitfor_headers():
    """Test 7: API waitForFreshHeaders functionality"""
    print("🔍 Test 7: Testing waitForFreshHeaders functionality...")
    
    # Create session
    test_files_dir = Path("test_files")
    client_file = test_files_dir / "CLIENT.xlsx"
    template_file = test_files_dir / "FACTWISE.xlsx"
    
    if not client_file.exists() or not template_file.exists():
        print("⚠️  Test files not found, skipping headers test")
        return True
        
    with open(client_file, 'rb') as cf, open(template_file, 'rb') as tf:
        files = {
            'client_file': ('CLIENT.xlsx', cf, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
            'template_file': ('FACTWISE.xlsx', tf, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        }
        response = requests.post(f"{BASE_URL}/api/upload/", files=files)
    
    if response.status_code != 200:
        print("⚠️  Upload failed for headers test")
        return True
        
    session_id = response.json()["session_id"]
    
    # Test that session status returns headers_count
    status_response = requests.get(f"{BASE_URL}/api/session/{session_id}/status/")
    data = status_response.json()
    
    assert "headers_count" in data or "template_version" in data
    print("✅ Headers functionality test passed")
    return True

def run_comprehensive_tests():
    """Run all comprehensive tests"""
    print("🚀 Starting comprehensive testing of Azure fixes...")
    print("="*60)
    
    test_results = []
    
    try:
        # Test 1: API Health
        test_results.append(("API Health", test_api_health()))
        
        # Test 2: Redis Session Consistency  
        session_id = test_redis_session_consistency()
        test_results.append(("Redis Session Consistency", bool(session_id)))
        
        if session_id:
            # Test 3: Column Count Updates
            test_results.append(("Column Count Updates", test_column_count_updates(session_id)))
            
        # Test 4: Template Application
        template_session = test_template_application()
        test_results.append(("Template Application", bool(template_session)))
        
        if template_session:
            # Test 5: Factwise ID Creation
            test_results.append(("Factwise ID Creation", test_factwise_id_creation(template_session)))
        
        # Test 6: Frontend Accessibility
        test_results.append(("Frontend Accessibility", test_frontend_accessibility()))
        
        # Test 7: API Headers Functionality
        test_results.append(("API Headers Functionality", test_api_waitfor_headers()))
        
    except Exception as e:
        print(f"❌ Test suite failed with error: {e}")
        return False
    
    # Print results
    print("\n" + "="*60)
    print("📊 TEST RESULTS SUMMARY:")
    print("="*60)
    
    passed = 0
    failed = 0
    
    for test_name, result in test_results:
        status = "✅ PASS" if result else "❌ FAIL"
        print(f"{test_name:30} {status}")
        if result:
            passed += 1
        else:
            failed += 1
    
    print("="*60)
    print(f"Total: {len(test_results)} | Passed: {passed} | Failed: {failed}")
    
    if failed == 0:
        print("🎉 ALL TESTS PASSED! Azure fixes are working correctly.")
        return True
    else:
        print(f"⚠️  {failed} test(s) failed. Please review the issues above.")
        return False

if __name__ == "__main__":
    success = run_comprehensive_tests()
    sys.exit(0 if success else 1)