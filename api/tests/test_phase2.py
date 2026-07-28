"""
Tests for Phase 2: Speaker Identity + Device ID + Consent
"""

import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.main import app
from app.database import get_db, AsyncSessionLocal, engine, Base
from app.models import Speaker, Device, DeviceSpeaker
from app.services.consent import ConsentService, get_current_consent_version


@pytest.fixture
async def db_session():
    """Create a test database session."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    
    async with AsyncSessionLocal() as session:
        yield session
    
    # Clean up
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest.fixture
async def client(db_session):
    """Create test client with database dependency override."""
    async def override_get_db():
        yield db_session
    
    app.dependency_overrides[get_db] = override_get_db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()


class TestDeviceRegistration:
    """Test device registration functionality."""
    
    async def test_register_new_device(self, client: AsyncClient):
        """Test registering a new device."""
        device_id = str(uuid.uuid4())
        response = await client.post("/api/devices", json={
            "device_id": device_id,
            "ua_class": "Test Browser"
        })
        
        assert response.status_code == 201
        data = response.json()
        assert data["device_id"] == device_id
        assert "first_seen" in data
    
    async def test_register_existing_device(self, client: AsyncClient):
        """Test registering the same device twice (should be idempotent)."""
        device_id = str(uuid.uuid4())
        
        # First registration
        response1 = await client.post("/api/devices", json={
            "device_id": device_id,
            "ua_class": "Test Browser"
        })
        assert response1.status_code == 201
        
        # Second registration (should return existing)
        response2 = await client.post("/api/devices", json={
            "device_id": device_id,
            "ua_class": "Test Browser"
        })
        assert response2.status_code == 200  # Existing device
        assert response2.json()["device_id"] == device_id
    
    async def test_invalid_device_id(self, client: AsyncClient):
        """Test registration with invalid device ID."""
        response = await client.post("/api/devices", json={
            "device_id": "not-a-uuid",
            "ua_class": "Test Browser"
        })
        
        assert response.status_code == 422  # Validation error


class TestSpeakerCreation:
    """Test speaker creation and consent functionality."""
    
    async def setup_device(self, client: AsyncClient, device_id: str):
        """Helper to set up a device for speaker tests."""
        await client.post("/api/devices", json={
            "device_id": device_id,
            "ua_class": "Test Browser"
        })
    
    async def test_create_speaker_with_consent(self, client: AsyncClient):
        """Test creating a speaker with valid consent."""
        device_id = str(uuid.uuid4())
        await self.setup_device(client, device_id)
        
        response = await client.post("/api/speakers", 
            headers={"X-Device-ID": device_id},
            json={
                "age": 25,
                "gender": "male",
                "l1": "Hindi",
                "region": "Delhi",
                "consent_version": get_current_consent_version()
            })
        
        assert response.status_code == 201
        data = response.json()
        assert data["speaker_id"].startswith("SPK_")
        assert "token" in data
        assert data["age_band"] == "18-25"
        assert "consent_at" in data
    
    async def test_invalid_consent_version(self, client: AsyncClient):
        """Test creating speaker with invalid consent version."""
        device_id = str(uuid.uuid4())
        await self.setup_device(client, device_id)
        
        response = await client.post("/api/speakers",
            headers={"X-Device-ID": device_id},
            json={
                "age": 30,
                "gender": "female", 
                "l1": "Hindi",
                "region": "Mumbai",
                "consent_version": "invalid-version"
            })
        
        assert response.status_code == 400
        error_data = response.json()
        assert error_data["detail"]["code"] == "INVALID_CONSENT_VERSION"
    
    async def test_speaker_creation_without_device(self, client: AsyncClient):
        """Test creating speaker without registering device first."""
        response = await client.post("/api/speakers",
            headers={"X-Device-ID": "nonexistent-device"},
            json={
                "age": 25,
                "gender": "male",
                "l1": "Hindi", 
                "region": "Delhi",
                "consent_version": get_current_consent_version()
            })
        
        assert response.status_code == 404
        error_data = response.json()
        assert error_data["detail"]["code"] == "DEVICE_NOT_FOUND"
    
    async def test_speaker_validation(self, client: AsyncClient):
        """Test speaker field validation."""
        device_id = str(uuid.uuid4())
        await self.setup_device(client, device_id)
        
        # Test invalid age
        response = await client.post("/api/speakers",
            headers={"X-Device-ID": device_id},
            json={
                "age": 5,  # Too young
                "gender": "male",
                "l1": "Hindi",
                "region": "Delhi",
                "consent_version": get_current_consent_version()
            })
        
        assert response.status_code == 422
        
        # Test invalid gender
        response = await client.post("/api/speakers", 
            headers={"X-Device-ID": device_id},
            json={
                "age": 25,
                "gender": "invalid_gender",
                "l1": "Hindi",
                "region": "Delhi", 
                "consent_version": get_current_consent_version()
            })
        
        assert response.status_code == 422


class TestSharedDeviceSupport:
    """Test shared device functionality."""
    
    async def setup_device(self, client: AsyncClient, device_id: str):
        """Helper to set up a device."""
        await client.post("/api/devices", json={
            "device_id": device_id,
            "ua_class": "Shared Device"
        })
    
    async def create_speaker(self, client: AsyncClient, device_id: str, age: int) -> dict:
        """Helper to create a speaker."""
        response = await client.post("/api/speakers",
            headers={"X-Device-ID": device_id},
            json={
                "age": age,
                "gender": "male",
                "l1": "Hindi",
                "region": "Delhi",
                "consent_version": get_current_consent_version()
            })
        assert response.status_code == 201
        return response.json()
    
    async def test_multiple_speakers_same_device(self, client: AsyncClient):
        """Test multiple speakers on the same device."""
        device_id = str(uuid.uuid4())
        await self.setup_device(client, device_id)
        
        # Create two speakers
        speaker1 = await self.create_speaker(client, device_id, 25)
        speaker2 = await self.create_speaker(client, device_id, 35)
        
        # Verify they have different IDs but same device
        assert speaker1["speaker_id"] != speaker2["speaker_id"]
        assert speaker1["token"] != speaker2["token"]
        
        # Get device roster
        response = await client.get(f"/api/devices/{device_id}/speakers",
                                  headers={"X-Device-ID": device_id})
        
        assert response.status_code == 200
        roster = response.json()
        assert len(roster["speakers"]) == 2
        
        # Check speaker IDs are in roster
        roster_ids = [s["speaker_id"] for s in roster["speakers"]]
        assert speaker1["speaker_id"] in roster_ids
        assert speaker2["speaker_id"] in roster_ids
    
    async def test_roster_access_control(self, client: AsyncClient):
        """Test that device can only access its own roster."""
        device1_id = "device-001"
        device2_id = "device-002"
        
        await self.setup_device(client, device1_id)
        await self.setup_device(client, device2_id)
        
        # Try to access device1 roster from device2
        response = await client.get(f"/api/devices/{device1_id}/speakers",
                                  headers={"X-Device-ID": device2_id})
        
        assert response.status_code == 403
        error_data = response.json()
        assert error_data["detail"]["code"] == "ACCESS_DENIED"


class TestConsentValidation:
    """Test consent validation service."""
    
    async def test_consent_service_validation(self, db_session: AsyncSession):
        """Test consent service functionality."""
        # Create device and speaker directly in database
        device = Device(device_id="test-consent-device", ua_class="Test")
        db_session.add(device)
        
        speaker = Speaker(
            speaker_id="SPK_TEST",
            age=25,
            gender="male",
            l1="Hindi",
            region="Delhi"
        )
        db_session.add(speaker)
        await db_session.commit()
        
        # Test no consent initially
        has_consent = await ConsentService.has_valid_consent("SPK_TEST", db_session)
        assert not has_consent
        
        # Record consent
        success = await ConsentService.record_consent(
            "SPK_TEST", 
            get_current_consent_version(),
            db_session
        )
        assert success
        
        # Test consent now valid
        has_consent = await ConsentService.has_valid_consent("SPK_TEST", db_session)
        assert has_consent
        
        # Test consent status details
        status = await ConsentService.get_speaker_consent_status("SPK_TEST", db_session)
        assert status is not None
        assert status["has_consent"] is True
        assert status["consent_version"] == get_current_consent_version()
        assert not status["is_withdrawn"]
    
    async def test_consent_version_validation(self):
        """Test consent version validation."""
        # Valid version
        assert ConsentService.validate_consent_version(get_current_consent_version())
        
        # Invalid version
        assert not ConsentService.validate_consent_version("invalid-version")
        assert not ConsentService.validate_consent_version("")


class TestHealthEndpoint:
    """Test health check endpoint."""
    
    async def test_health_check(self, client: AsyncClient):
        """Test health endpoint returns proper status."""
        response = await client.get("/api/health")
        
        assert response.status_code == 200
        data = response.json()
        assert "status" in data
        assert "phase" in data
        assert "database" in data
        assert "consent_version" in data
        assert data["consent_version"] == get_current_consent_version()


# Integration test for the complete Phase 2 flow
class TestPhase2Integration:
    """Integration test for complete Phase 2 workflow."""
    
    async def test_complete_phase2_flow(self, client: AsyncClient):
        """Test the complete Phase 2 flow: device → speaker → consent."""
        device_id = str(uuid.uuid4())
        
        # Step 1: Register device
        device_response = await client.post("/api/devices", json={
            "device_id": device_id,
            "ua_class": "Integration Test Browser"
        })
        assert device_response.status_code == 201
        
        # Step 2: Create speaker with consent
        speaker_response = await client.post("/api/speakers",
            headers={"X-Device-ID": device_id},
            json={
                "age": 28,
                "gender": "female",
                "l1": "Hindi", 
                "region": "Bangalore",
                "consent_version": get_current_consent_version()
            })
        assert speaker_response.status_code == 201
        
        speaker_data = speaker_response.json()
        speaker_id = speaker_data["speaker_id"]
        
        # Step 3: Verify consent was recorded
        consent_response = await client.get(
            f"/api/speakers/{speaker_id}/consent",
            headers={"Authorization": f"Bearer {speaker_data['token']}"}
        )
        assert consent_response.status_code == 200
        
        consent_data = consent_response.json()
        assert consent_data["has_consent"] is True
        assert consent_data["consent_version"] == get_current_consent_version()
        assert not consent_data["is_withdrawn"]
        
        # Step 4: Verify speaker appears in device roster
        roster_response = await client.get(f"/api/devices/{device_id}/speakers",
                                         headers={"X-Device-ID": device_id})
        assert roster_response.status_code == 200
        
        roster_data = roster_response.json()
        assert len(roster_data["speakers"]) == 1
        assert roster_data["speakers"][0]["speaker_id"] == speaker_id
        assert roster_data["speakers"][0]["age_band"] == "26-35"