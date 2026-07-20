#!/usr/bin/env python3
"""Test script to verify scenario seeding works correctly."""

import asyncio
import sys
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent))

from app.database import AsyncSessionLocal
from app.seed import seed_scenarios
from sqlalchemy import select, func
from app.models import Scenario

async def test_seeding():
    """Test scenario seeding."""
    print("Testing scenario seeding...")
    
    async with AsyncSessionLocal() as db:
        # Run seeding
        await seed_scenarios(db)
        
        # Count scenarios
        stmt = select(func.count(Scenario.scenario_id))
        result = await db.execute(stmt)
        count = result.scalar()
        
        print(f"✓ Scenarios in database: {count}")
        
        # Sample some scenarios
        stmt = select(Scenario).limit(5)
        result = await db.execute(stmt)
        scenarios = list(result.scalars().all())
        
        print(f"\n✓ Sample scenarios:")
        for s in scenarios:
            print(f"  - {s.scenario_id}: {s.intent} ({s.scenario_set})")
            print(f"    Domain: {s.domain}, Use count: {s.use_count}")
            print(f"    Examples: {len(s.examples)} items")
            
        # Test idempotency - run again
        print("\n✓ Testing idempotency (running seed again)...")
        await seed_scenarios(db)
        
        stmt = select(func.count(Scenario.scenario_id))
        result = await db.execute(stmt)
        count_after = result.scalar()
        
        if count == count_after:
            print(f"  ✓ Count unchanged: {count_after} (idempotent)")
        else:
            print(f"  ✗ Count changed from {count} to {count_after} (NOT idempotent!)")
            return False
            
    print("\n✓ All seeding tests passed!")
    return True

if __name__ == "__main__":
    success = asyncio.run(test_seeding())
    sys.exit(0 if success else 1)
