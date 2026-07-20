import random
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from ..models import Scenario, Task

async def assign_version_for_intent(
    db: AsyncSession,
    speaker_id: str,
    intent: str
) -> str:
    """
    Implements the scenario assignment version selection algorithm:
    version = argmin over {v1, v2} of:
              use_count_version[intent][v]
            + 2.0 * already_used_by(speaker, intent, v)
            + uniform(0, 0.1)
    """
    scores = {}
    for version in ["v1", "v2"]:
        # 1. Global representation balance: sum of use_count for scenarios of this intent in this version
        use_count_stmt = select(func.sum(Scenario.use_count)).where(
            Scenario.intent == intent,
            Scenario.scenario_set == version
        )
        use_count_result = await db.execute(use_count_stmt)
        global_use_count = use_count_result.scalar() or 0
        
        # 2. Alternation check: count tasks already assigned to this speaker for this intent in this version
        already_used_stmt = select(func.count(Task.task_id)).join(
            Scenario, Task.scenario_id == Scenario.scenario_id
        ).where(
            Task.speaker_id == speaker_id,
            Task.intent == intent,
            Scenario.scenario_set == version
        )
        already_used_result = await db.execute(already_used_stmt)
        speaker_use_count = already_used_result.scalar() or 0
        
        # 3. Add Jitter to break ties and prevent deterministic locking
        jitter = random.uniform(0, 0.1)
        
        # Calculate score
        score = global_use_count + 2.0 * speaker_use_count + jitter
        scores[version] = score
        
    # Select version with the lowest score
    selected_version = min(scores, key=scores.get)
    return selected_version
