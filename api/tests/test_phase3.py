"""
Phase 3 Tests: Scenario and Task Assignment

Tests for:
- Scenario seeding and idempotency
- Task assignment (lazy creation)
- Consent enforcement
- Server-authoritative metadata
- Task ownership
- Active task reuse
- Scenario balancing (use_count behavior)
"""

import pytest
import asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.main import app
from app.database import AsyncSessionLocal, engine, Base
from app.models import Speaker, Device, DeviceSpeaker, Scenario, Task
from app.seed import seed_scenarios


# Fixtures
@pytest.fixture(scope="function")
async def db_session():
    """Create a fresh database session for each test."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    
    async with AsyncSessionLocal() as session:
        # Seed scenarios
        await seed_scenarios(session)
        yield session


@pytest.fixture
async def client():
    """HTTP client for API testing."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


@pytest.fixture
async def test_device(db_session: AsyncSession):
    """Create a test device."""
    device = Device(
        device_id="test-device-001",
        ua_class="Test Browser"
    )
    db_session.add(device)
    await db_session.commit()
    await db_session.refresh(device)
    return device


@pytest.fixture
async def test_speaker_with_consent(db_session: AsyncSession, test_device):
    """Create a test speaker with valid consent."""
    from datetime import datetime
    
    speaker = Speaker(
        speaker_id="SPK_TEST_001",
        age=25,
        gender="male",
        l1="Hindi",
        region="Delhi",
        consent_at=datetime.utcnow(),
        consent_version="consent-v1"
    )
    db_session.add(speaker)
    
    # Add to device roster
    roster = DeviceSpeaker(
        device_id=test_device.device_id,
        speaker_id=speaker.speaker_id
    )
    db_session.add(roster)
    
    await db_session.commit()
    await db_session.refresh(speaker)
    return speaker


@pytest.fixture
async def test_speaker_no_consent(db_session: AsyncSession, test_device):
    """Create a test speaker WITHOUT consent."""
    speaker = Speaker(
        speaker_id="SPK_TEST_002",
        age=30,
        gender="female",
        l1="Tamil",
        region="Tamil Nadu",
        consent_at=None,  # No consent
        consent_version=None
    )
    db_session.add(speaker)
    
    roster = DeviceSpeaker(
        device_id=test_device.device_id,
        speaker_id=speaker.speaker_id
    )
    db_session.add(roster)
    
    await db_session.commit()
    await db_session.refresh(speaker)
    return speaker


# Test Class: Scenario Seeding
class TestScenarioSeeding:
    """Test scenario seeding functionality."""
    
    async def test_scenarios_loaded(self, db_session: AsyncSession):
        """Test that scenarios are loaded from JSON files."""
        stmt = select(func.count(Scenario.scenario_id))
        result = await db_session.execute(stmt)
        count = result.scalar()
        
        assert count > 0, "No scenarios loaded"
        assert count >= 10, f"Expected at least 10 scenarios, got {count}"
    
    async def test_scenario_structure(self, db_session: AsyncSession):
        """Test that scenarios have required fields."""
        stmt = select(Scenario).limit(1)
        result = await db_session.execute(stmt)
        scenario = result.scalar()
        
        assert scenario is not None
        assert scenario.scenario_id is not None
        assert scenario.domain is not None
        assert scenario.intent is not None
        assert scenario.scenario_set in ["v1", "v2"]
        assert scenario.text_hi is not None
        assert scenario.examples is not None
        assert len(scenario.examples) == 3, "Each scenario must have exactly 3 examples"
        assert scenario.use_count == 0 or scenario.use_count >= 0
    
    async def test_seeding_idempotent(self, db_session: AsyncSession):
        """Test that seeding is idempotent (can run multiple times)."""
        # Count before
        stmt = select(func.count(Scenario.scenario_id))
        result = await db_session.execute(stmt)
        count_before = result.scalar()
        
        # Run seeding again
        await seed_scenarios(db_session)
        
        # Count after
        result = await db_session.execute(stmt)
        count_after = result.scalar()
        
        assert count_before == count_after, "Seeding should be idempotent"


# Test Class: Task Assignment
class TestTaskAssignment:
    """Test task assignment functionality."""
    
    async def test_task_assignment_requires_consent(
        self, 
        client: AsyncClient, 
        test_speaker_no_consent: Speaker,
        test_device
    ):
        """Test that task assignment rejects speakers without consent."""
        response = await client.get(
            "/api/session/next",
            headers={
                "Authorization": f"Bearer {test_speaker_no_consent.token}",
                "X-Device-ID": test_device.device_id
            }
        )
        
        assert response.status_code == 403, "Should reject speaker without consent"
        assert "consent" in response.json().get("detail", "").lower()
    
    async def test_task_assignment_creates_tasks(
        self,
        client: AsyncClient,
        test_speaker_with_consent: Speaker,
        test_device,
        db_session: AsyncSession
    ):
        """Test that requesting tasks creates new tasks lazily."""
        # Count tasks before
        stmt = select(func.count(Task.task_id)).where(
            Task.speaker_id == test_speaker_with_consent.speaker_id
        )
        result = await db_session.execute(stmt)
        count_before = result.scalar()
        
        # Request task
        response = await client.get(
            "/api/session/next",
            headers={
                "Authorization": f"Bearer {test_speaker_with_consent.token}",
                "X-Device-ID": test_device.device_id
            }
        )
        
        assert response.status_code == 200, f"Failed to get tasks: {response.text}"
        data = response.json()
        assert "batch" in data
        assert "tasks" in data["batch"]
        assert len(data["batch"]["tasks"]) > 0
        
        # Count tasks after
        await db_session.commit()  # Ensure changes are visible
        result = await db_session.execute(stmt)
        count_after = result.scalar()
        
        assert count_after > count_before, "Tasks should be created"
    
    async def test_task_has_server_authoritative_metadata(
        self,
        client: AsyncClient,
        test_speaker_with_consent: Speaker,
        test_device
    ):
        """Test that task contains server-authoritative metadata."""
        response = await client.get(
            "/api/session/next",
            headers={
                "Authorization": f"Bearer {test_speaker_with_consent.token}",
                "X-Device-ID": test_device.device_id
            }
        )
        
        assert response.status_code == 200
        data = response.json()
        task = data["batch"]["tasks"][0]
        
        # Verify server-authoritative fields are present
        assert "task_id" in task
        assert "domain" in task
        assert "intent" in task
        assert "scenario_id" in task
        assert "text_hi" in task
        assert "examples" in task
        assert len(task["examples"]) == 3
        assert "status" in task
        
        # Verify domain is valid
        assert task["domain"] in ["BNK", "EDU", "TRV", "VAS"]
    
    async def test_active_task_reuse(
        self,
        client: AsyncClient,
        test_speaker_with_consent: Speaker,
        test_device
    ):
        """Test that refreshing returns the same active batch."""
        # First request
        response1 = await client.get(
            "/api/session/next",
            headers={
                "Authorization": f"Bearer {test_speaker_with_consent.token}",
                "X-Device-ID": test_device.device_id
            }
        )
        assert response1.status_code == 200
        batch1 = response1.json()["batch"]
        
        # Second request (refresh)
        response2 = await client.get(
            "/api/session/next",
            headers={
                "Authorization": f"Bearer {test_speaker_with_consent.token}",
                "X-Device-ID": test_device.device_id
            }
        )
        assert response2.status_code == 200
        batch2 = response2.json()["batch"]
        
        # Should return same batch
        assert batch1["domain"] == batch2["domain"]
        assert batch1["batch_no"] == batch2["batch_no"]
        assert len(batch1["tasks"]) == len(batch2["tasks"])
        
        # First task should be the same
        assert batch1["tasks"][0]["task_id"] == batch2["tasks"][0]["task_id"]


# Test Class: Task Ownership
class TestTaskOwnership:
    """Test that tasks belong to specific speakers."""
    
    async def test_task_belongs_to_speaker(
        self,
        client: AsyncClient,
        test_speaker_with_consent: Speaker,
        test_device,
        db_session: AsyncSession
    ):
        """Test that created tasks have correct speaker_id."""
        response = await client.get(
            "/api/session/next",
            headers={
                "Authorization": f"Bearer {test_speaker_with_consent.token}",
                "X-Device-ID": test_device.device_id
            }
        )
        
        assert response.status_code == 200
        task_id = response.json()["batch"]["tasks"][0]["task_id"]
        
        # Check database
        stmt = select(Task).where(Task.task_id == task_id)
        result = await db_session.execute(stmt)
        task = result.scalar()
        
        assert task is not None
        assert task.speaker_id == test_speaker_with_consent.speaker_id


# Test Class: Scenario use_count
class TestScenarioUseCount:
    """Test that use_count behaves correctly (NOT incremented on assignment)."""
    
    async def test_use_count_not_incremented_on_assignment(
        self,
        client: AsyncClient,
        test_speaker_with_consent: Speaker,
        test_device,
        db_session: AsyncSession
    ):
        """CRITICAL: Test that use_count does NOT increment on task assignment."""
        # Get initial use_counts
        stmt = select(Scenario.scenario_id, Scenario.use_count)
        result = await db_session.execute(stmt)
        initial_counts = {row[0]: row[1] for row in result.all()}
        
        # Request tasks (triggers assignment)
        response = await client.get(
            "/api/session/next",
            headers={
                "Authorization": f"Bearer {test_speaker_with_consent.token}",
                "X-Device-ID": test_device.device_id
            }
        )
        
        assert response.status_code == 200
        assigned_scenario_ids = [
            task["scenario_id"] 
            for task in response.json()["batch"]["tasks"]
        ]
        
        # Check use_counts after assignment
        await db_session.commit()
        result = await db_session.execute(stmt)
        final_counts = {row[0]: row[1] for row in result.all()}
        
        # Verify use_count unchanged for assigned scenarios
        for scenario_id in assigned_scenario_ids:
            initial = initial_counts.get(scenario_id, 0)
            final = final_counts.get(scenario_id, 0)
            assert initial == final, \
                f"use_count changed for {scenario_id}: {initial} -> {final}. " \
                "use_count should ONLY increment on Keep/Confirm, not on assignment!"


# Test Class: Progress Tracking
class TestProgressTracking:
    """Test progress information returned with tasks."""
    
    async def test_progress_info_included(
        self,
        client: AsyncClient,
        test_speaker_with_consent: Speaker,
        test_device
    ):
        """Test that progress info is included in response."""
        response = await client.get(
            "/api/session/next",
            headers={
                "Authorization": f"Bearer {test_speaker_with_consent.token}",
                "X-Device-ID": test_device.device_id
            }
        )
        
        assert response.status_code == 200
        data = response.json()
        
        assert "progress" in data["batch"]
        progress = data["batch"]["progress"]
        
        assert "intents_total" in progress
        assert "intents_done" in progress
        assert "scenarios_in_intent" in progress
        assert "examples_in_scenario" in progress
        assert progress["examples_in_scenario"] == 3


# Run tests
if __name__ == "__main__":
    pytest.main([__file__, "-v", "-s"])
