#!/usr/bin/env python3
"""
Quick startup test to verify all imports and basic configuration.
Run this before starting the server to catch errors early.
"""

import sys
import os

# Add api directory to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'api'))

print("🧪 Testing S2I Recorder API Configuration...")
print()

# Test 1: Import main app
try:
    from app.main import app
    print("✅ Main app imports successfully")
except Exception as e:
    print(f"❌ Failed to import main app: {e}")
    sys.exit(1)

# Test 2: Import models
try:
    from app.models import Speaker, Device, Clip, Task, Scenario
    print("✅ Models import successfully")
except Exception as e:
    print(f"❌ Failed to import models: {e}")
    sys.exit(1)

# Test 3: Import auth
try:
    from app.auth import get_current_speaker, get_current_admin
    print("✅ Auth module imports successfully")
except Exception as e:
    print(f"❌ Failed to import auth: {e}")
    sys.exit(1)

# Test 4: Import routers
try:
    from app.routers import devices, speakers, session, clips, admin
    print("✅ All routers import successfully")
except Exception as e:
    print(f"❌ Failed to import routers: {e}")
    sys.exit(1)

# Test 5: Import services
try:
    from app.services import storage, naming, task_generator, scenario_assign
    print("✅ Services import successfully")
except Exception as e:
    print(f"❌ Failed to import services: {e}")
    sys.exit(1)

# Test 6: Check scenario files
scenario_dir = os.path.join(os.path.dirname(__file__), 'data', 'scenarios')
expected_files = [
    'bnk_v1.json', 'bnk_v2.json',
    'edu_v1.json', 'edu_v2.json',
    'trv_v1.json', 'trv_v2.json',
    'vas_v1.json', 'vas_v2.json'
]

missing_scenarios = []
for filename in expected_files:
    filepath = os.path.join(scenario_dir, filename)
    if not os.path.exists(filepath):
        missing_scenarios.append(filename)

if missing_scenarios:
    print(f"⚠️  Missing scenario files: {', '.join(missing_scenarios)}")
else:
    print("✅ All scenario files present")

# Test 7: Check storage directories will be created
storage_dir = os.path.join(os.path.dirname(__file__), 'api', 'storage')
print(f"ℹ️  Storage directory: {storage_dir} (will be auto-created)")

print()
print("=" * 50)
print("✅ All imports successful! API is ready to start.")
print("=" * 50)
print()
print("Next steps:")
print("1. cd api")
print("2. uvicorn app.main:app --reload")
print()
