import random
import hashlib
from typing import List, Tuple, Optional
from sqlalchemy import select, func, distinct
from sqlalchemy.ext.asyncio import AsyncSession
from ..models import Task, Scenario, Clip, Speaker
from .scenario_assign import assign_version_for_intent

def stable_shuffle(items: list, seed_str: str) -> list:
    """Stably shuffles items based on a seed string (e.g. speaker_id)."""
    seed_int = int(hashlib.md5(seed_str.encode()).hexdigest(), 16) & 0xffffffff
    rng = random.Random(seed_int)
    shuffled = list(items)
    rng.shuffle(shuffled)
    return shuffled

async def get_or_create_session_batch(
    db: AsyncSession,
    speaker_id: str,
    requested_domain: Optional[str] = None
) -> Tuple[str, int, List[Task]]:
    """
    Retrieves the current pending batch for the speaker, or generates a new one.
    
    Returns:
        (domain, batch_no, list_of_tasks)
    """
    # 0. Check if the speaker has an assigned domain (set by admin)
    speaker_stmt = select(Speaker).where(Speaker.speaker_id == speaker_id)
    speaker_res = await db.execute(speaker_stmt)
    speaker = speaker_res.scalar()
    assigned_domain = speaker.assigned_domain if speaker else None

    # If speaker has an assigned domain, force it
    effective_domain = assigned_domain or requested_domain

    # 1. Check if the speaker has any pending tasks (in-progress batch)
    pending_conditions = [Task.speaker_id == speaker_id, Task.status == "pending"]
    if effective_domain:
        pending_conditions.append(Task.domain == effective_domain)
    pending_stmt = select(Task).where(*pending_conditions).order_by(Task.intent, Task.scenario_no, Task.example_no)
    
    result = await db.execute(pending_stmt)
    pending_tasks = list(result.scalars().all())
    
    if pending_tasks:
        first_task = pending_tasks[0]
        # Return ALL tasks in this batch (recorded + pending) so the frontend
        # can show the complete 3-example stepper even when some are done
        batch_stmt = select(Task).where(
            Task.speaker_id == speaker_id,
            Task.domain == first_task.domain,
            Task.batch_no == first_task.batch_no
        ).order_by(Task.intent, Task.scenario_no, Task.example_no)
        batch_res = await db.execute(batch_stmt)
        all_batch_tasks = list(batch_res.scalars().all())
        return first_task.domain, first_task.batch_no, all_batch_tasks

    # 2. No pending batch. Determine which domain to run.
    domain = effective_domain
    if not domain:
        # Pick the domain with the lowest coverage globally
        # Coverage is defined by the number of confirmed/processed clips
        coverage_counts = {}
        for d in ["BNK", "EDU", "TRV", "VAS"]:
            count_stmt = select(func.count(Clip.clip_id)).join(Task).where(
                Task.domain == d,
                Clip.status.in_(["confirmed", "processing", "processed"])
            )
            count_res = await db.execute(count_stmt)
            coverage_counts[d] = count_res.scalar() or 0
        
        # Select domain with lowest count
        domain = min(coverage_counts, key=coverage_counts.get)

    # 3. Determine the next batch number for this speaker in the chosen domain
    batch_stmt = select(func.max(Task.batch_no)).where(
        Task.speaker_id == speaker_id,
        Task.domain == domain
    )
    batch_res = await db.execute(batch_stmt)
    max_batch = batch_res.scalar()

    if max_batch is None:
        batch_no = 1
    elif max_batch < 1:
        batch_no = max_batch + 1
    else:
        # Speaker has completed a batch for this domain (all 3 examples done).
        # If they requested this domain explicitly, we can continue with more batches.
        # Otherwise, let's offer a different domain.
        if requested_domain:
            batch_no = max_batch + 1
        else:
            available_domains = ["BNK", "EDU", "TRV", "VAS"]
            for d in available_domains:
                if d == domain:
                    continue
                d_stmt = select(func.max(Task.batch_no)).where(
                    Task.speaker_id == speaker_id,
                    Task.domain == d
                )
                d_res = await db.execute(d_stmt)
                d_max = d_res.scalar()
                if d_max is None or d_max < 1:
                    domain = d
                    batch_no = (d_max or 0) + 1
                    break
            else:
                batch_no = max_batch + 1

    # 4. Generate tasks for the batch (example_no = batch_no)
    # Get distinct intents for the selected domain
    intents_stmt = select(distinct(Scenario.intent)).where(Scenario.domain == domain)
    intents_res = await db.execute(intents_stmt)
    intents = sorted(list(intents_res.scalars().all()))

    if not intents:
        # If no scenarios are seeded yet, return empty list (caller should seed first)
        return domain, batch_no, []

    new_tasks = []
    for intent in intents:
        # Determine version (v1 or v2) for this speaker + intent
        version = await assign_version_for_intent(db, speaker_id, intent)
        
        # Get all scenarios for this intent and version
        scenarios_stmt = select(Scenario).where(
            Scenario.intent == intent,
            Scenario.scenario_set == version
        )
        scenarios_res = await db.execute(scenarios_stmt)
        scenarios = list(scenarios_res.scalars().all())
        
        # Shuffle scenarios stably per speaker
        shuffled_scenarios = stable_shuffle(scenarios, speaker_id)
        
        # Create 3 tasks per scenario (one for each example 1, 2, 3)
        # so the speaker records all 3 examples before moving to the next scenario
        for idx, scenario in enumerate(shuffled_scenarios, 1):
            for example_no in range(1, 4):
                task = Task(
                    speaker_id=speaker_id,
                    domain=domain,
                    intent=intent,
                    scenario_id=scenario.scenario_id,
                    scenario_no=idx,
                    example_no=example_no,
                    batch_no=batch_no,
                    status="pending",
                    redo_count=0
                )
                db.add(task)
                new_tasks.append(task)
            
    await db.commit()
    
    # Refresh to load relationships/ids
    # For SQLite, we can just query them back
    tasks_stmt = select(Task).where(
        Task.speaker_id == speaker_id,
        Task.domain == domain,
        Task.batch_no == batch_no,
        Task.status == "pending"
    ).order_by(Task.intent, Task.scenario_no, Task.example_no)
    
    tasks_res = await db.execute(tasks_stmt)
    created_tasks = list(tasks_res.scalars().all())
    
    return domain, batch_no, created_tasks
