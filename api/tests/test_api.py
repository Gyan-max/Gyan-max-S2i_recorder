import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
import uuid
import os
import io

from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import declarative_base

# Database and storage locations come from conftest.py.
TEST_DATABASE_URL = os.environ["DATABASE_URL"]

from app.database import Base, get_db
from app.main import app
from app.seed import seed_scenarios
from app import config
from app.config import validate_config

# Read after validate_config() runs, since it fills in development defaults.
validate_config()
ADMIN_USERNAME = config.ADMIN_USERNAME
ADMIN_PASSWORD = config.ADMIN_PASSWORD

def _make_wav_bytes(seconds: float = 1.0, sample_rate: int = 16000) -> bytes:
    """
    Builds a real, decodable mono WAV.

    A placeholder byte string will not do: ffmpeg cannot transcode it and the
    QC stage rejects the clip, so confirmed-clip assertions fail.
    """
    import math
    import struct
    import wave

    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sample_rate)
        frames = bytearray()
        for i in range(int(seconds * sample_rate)):
            value = int(20000 * math.sin(2 * math.pi * 440 * i / sample_rate))
            frames += struct.pack("<h", value)
        w.writeframes(bytes(frames))
    return buf.getvalue()

# Set up test engine
engine = create_async_engine(TEST_DATABASE_URL, connect_args={"check_same_thread": False})
TestingSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False
)

@pytest_asyncio.fixture(scope="function", autouse=True)
async def setup_test_db():
    """Initializes and seeds a clean test database before each test function."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
        
    async with TestingSessionLocal() as session:
        await seed_scenarios(session)
        
    yield
    
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        
    # Clean up test database file
    if os.path.exists("./test_s2i_recorder.db"):
        try:
            os.remove("./test_s2i_recorder.db")
        except PermissionError:
            pass

# Override get_db dependency for tests
async def override_get_db():
    async with TestingSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()

app.dependency_overrides[get_db] = override_get_db

@pytest.mark.asyncio
async def test_health_check():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        response = await ac.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "healthy"

@pytest.mark.asyncio
async def test_full_volunteer_flow():
    """Tests the full register -> onboard -> task -> record -> keep/redo flow."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        # 1. Register Device
        device_id = str(uuid.uuid4())
        device_resp = await ac.post(
            "/api/devices",
            json={"device_id": device_id, "ua_class": "mobile_android"}
        )
        assert device_resp.status_code == 201
        assert device_resp.json()["device_id"] == device_id

        # 2. Register Speaker
        headers = {"X-Device-ID": device_id}
        speaker_resp = await ac.post(
            "/api/speakers",
            json={
                "age": 28,
                "gender": "male",
                "l1": "Hindi",
                "region": "Delhi",
                "consent_version": "consent-v1"
            },
            headers=headers
        )
        assert speaker_resp.status_code == 201
        spk_data = speaker_resp.json()
        assert spk_data["speaker_id"] == "SPK_0001"
        assert spk_data["age_band"] == "26-35"
        
        token = spk_data["token"]
        auth_headers = {
            "X-Device-ID": device_id,
            "Authorization": f"Bearer {token}"
        }

        # 3. Retrieve Device Roster
        roster_resp = await ac.get(f"/api/devices/{device_id}/speakers", headers=headers)
        assert roster_resp.status_code == 200
        assert len(roster_resp.json()["speakers"]) == 1
        assert roster_resp.json()["speakers"][0]["speaker_id"] == "SPK_0001"

        # 4. Get Session Batch (Banking domain)
        session_resp = await ac.get("/api/session/next?domain=BNK", headers=auth_headers)
        assert session_resp.status_code == 200
        batch_data = session_resp.json()["batch"]
        assert batch_data["domain"] == "BNK"
        assert batch_data["batch_no"] == 1
        assert len(batch_data["tasks"]) > 0
        
        first_task = batch_data["tasks"][0]
        assert first_task["status"] == "pending"

        # 5. Initialize Clip
        clip_init_resp = await ac.post(
            "/api/clips/init",
            json={"task_id": first_task["task_id"], "mime_type": "audio/wav"},
            headers=auth_headers
        )
        assert clip_init_resp.status_code == 201
        clip_data = clip_init_resp.json()
        clip_id = clip_data["clip_id"]
        assert clip_data["upload_url"] == f"/api/clips/upload?clip_id={clip_id}"

        # 6. Upload Audio
        dummy_audio = io.BytesIO(_make_wav_bytes())
        upload_resp = await ac.post(
            f"/api/clips/upload?clip_id={clip_id}",
            files={"file": ("test.wav", dummy_audio, "audio/wav")},
            headers=auth_headers
        )
        assert upload_resp.status_code == 200

        # 7. Discard Clip (Redo)
        discard_resp = await ac.post(
            f"/api/clips/{clip_id}/discard",
            headers=auth_headers
        )
        assert discard_resp.status_code == 200
        assert discard_resp.json()["status"] == "discarded"
        assert discard_resp.json()["task"]["redo_count"] == 1
        assert discard_resp.json()["task"]["status"] == "pending"

        # 8. Re-initialize Clip (Same task)
        clip_init_resp2 = await ac.post(
            "/api/clips/init",
            json={"task_id": first_task["task_id"], "mime_type": "audio/wav"},
            headers=auth_headers
        )
        assert clip_init_resp2.status_code == 201
        clip_id2 = clip_init_resp2.json()["clip_id"]

        # Upload again
        dummy_audio2 = io.BytesIO(_make_wav_bytes())
        await ac.post(
            f"/api/clips/upload?clip_id={clip_id2}",
            files={"file": ("test.wav", dummy_audio2, "audio/wav")},
            headers=auth_headers
        )

        # 9. Confirm Clip (Keep)
        confirm_resp = await ac.post(
            f"/api/clips/{clip_id2}/confirm",
            json={"transcript_edit": "Mera account balance check karo", "prompted": False},
            headers=auth_headers
        )
        assert confirm_resp.status_code == 200
        assert confirm_resp.json()["status"] == "confirmed"

        # Verify task is marked recorded
        session_resp2 = await ac.get("/api/session/next?domain=BNK", headers=auth_headers)
        tasks = session_resp2.json()["batch"]["tasks"]
        updated_first_task = next(t for t in tasks if t["task_id"] == first_task["task_id"])
        assert updated_first_task["status"] == "recorded"

@pytest.mark.asyncio
async def test_admin_operations():
    """Tests admin login, stats, review queue, coverage, and withdrawal/export."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        # 1. Admin Login
        login_resp = await ac.post(
            "/api/admin/login",
            json={"username": ADMIN_USERNAME, "password": ADMIN_PASSWORD}
        )
        assert login_resp.status_code == 200
        admin_token = login_resp.json()["token"]
        admin_headers = {"Authorization": f"Bearer {admin_token}"}

        # 2. Get Stats (empty)
        stats_resp = await ac.get("/api/admin/stats", headers=admin_headers)
        assert stats_resp.status_code == 200
        assert stats_resp.json()["total_speakers"] == 0

        # 3. Create a speaker and recording to populate data
        device_id = str(uuid.uuid4())
        await ac.post("/api/devices", json={"device_id": device_id})
        spk_resp = await ac.post(
            "/api/speakers",
            json={"age": 42, "gender": "female", "l1": "Hindi", "region": "UP", "consent_version": "consent-v1"},
            headers={"X-Device-ID": device_id}
        )
        token = spk_resp.json()["token"]
        speaker_id = spk_resp.json()["speaker_id"]
        auth_headers = {"X-Device-ID": device_id, "Authorization": f"Bearer {token}"}
        
        session_resp = await ac.get("/api/session/next?domain=BNK", headers=auth_headers)
        task_id = session_resp.json()["batch"]["tasks"][0]["task_id"]
        
        clip_init = await ac.post("/api/clips/init", json={"task_id": task_id}, headers=auth_headers)
        clip_id = clip_init.json()["clip_id"]
        
        await ac.post(
            f"/api/clips/upload?clip_id={clip_id}",
            files={"file": ("t.wav", io.BytesIO(_make_wav_bytes()), "audio/wav")},
            headers=auth_headers
        )
        await ac.post(f"/api/clips/{clip_id}/confirm", json={}, headers=auth_headers)

        # 4. Check updated stats
        stats_resp2 = await ac.get("/api/admin/stats", headers=admin_headers)
        assert stats_resp2.json()["total_speakers"] == 1
        assert stats_resp2.json()["confirmed_clips"] == 1

        # 5. Check review queue
        queue_resp = await ac.get("/api/admin/clips", headers=admin_headers)
        assert queue_resp.status_code == 200
        assert len(queue_resp.json()["clips"]) == 1

        # 6. Admin accepts the clip (overrides to processed)
        review_resp = await ac.post(
            f"/api/admin/clips/{clip_id}/review",
            json={"action": "accept"},
            headers=admin_headers
        )
        assert review_resp.status_code == 200
        assert review_resp.json()["status"] == "processed"

        # 7. Check coverage heatmap
        cov_resp = await ac.get("/api/admin/coverage", headers=admin_headers)
        assert cov_resp.status_code == 200
        assert len(cov_resp.json()["coverage"]) > 0

        # 8. Export dataset
        export_resp = await ac.get("/api/admin/export", headers=admin_headers)
        assert export_resp.status_code == 200
        assert "clip_id" in export_resp.text
        assert "SPK_0001" in export_resp.text
        assert "train" in export_resp.text  # Assigned to train split

        # 9. Speaker Withdrawal
        withdraw_resp = await ac.post(
            f"/api/admin/speakers/{speaker_id}/withdraw",
            headers=admin_headers
        )
        assert withdraw_resp.status_code == 200
        assert withdraw_resp.json()["clips_deleted"] == 1

        # Verify stats after withdrawal
        stats_resp3 = await ac.get("/api/admin/stats", headers=admin_headers)
        assert stats_resp3.json()["total_speakers"] == 0  # soft-deleted/withdrawn excluded
