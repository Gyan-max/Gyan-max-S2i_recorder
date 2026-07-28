"""
Global pytest configuration.

Loaded before any test module, which is the only reliable place to point the
application at a throwaway database and storage directory. test_phase2 and
test_phase3 call Base.metadata.drop_all on the real engine, so without this the
suite drops the tables of whatever database the app is configured to use.
"""

import os
import tempfile
from pathlib import Path

# Must be set before app.config / app.database are imported anywhere.
_TEST_DIR = Path(tempfile.mkdtemp(prefix="s2i_test_"))

os.environ["APP_ENV"] = "development"
os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{_TEST_DIR / 'test_s2i_recorder.db'}"
os.environ["STORAGE_BASE_PATH"] = str(_TEST_DIR / "storage")
# Fixed credentials so the suite does not depend on a developer's .env.
os.environ["ADMIN_USERNAME"] = "test_admin"
os.environ["ADMIN_PASSWORD"] = "test_password_for_suite"
os.environ["JWT_SECRET_KEY"] = "test-secret-key-not-used-outside-the-test-suite"
# Several tests log in repeatedly, so keep throttling out of the way.
os.environ["LOGIN_MAX_ATTEMPTS"] = "100000"

import pytest  # noqa: E402


@pytest.fixture(scope="session", autouse=True)
def _cleanup_test_dir():
    yield
    import shutil

    shutil.rmtree(_TEST_DIR, ignore_errors=True)
