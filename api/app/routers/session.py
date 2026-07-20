from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, update, distinct
from typing import Optional, List
from ..database import get_db
from ..models import Task, Scenario, DeviceSpeaker, Speaker
from ..schemas import SessionResponse, SessionBatchInfo, TaskResponse, ProgressInfo, ProgressResponse, IntentProgressInfo, ScenarioProgressInfo, ExampleProgressInfo
from ..auth import get_current_speaker_with_consent, verify_device
from ..services.task_generator import get_or_create_session_batch

router = APIRouter(prefix="/session", tags=["Session"])

@router.get("/next", response_model=SessionResponse)
async def get_next_session_batch(
    domain: Optional[str] = Query(None, description="BNK, EDU, TRV, or VAS"),
    speaker: Speaker = Depends(get_current_speaker_with_consent),
    x_device_id: str = Depends(verify_device),
    db: AsyncSession = Depends(get_db)
):
    """
    Issues the next task batch for the speaker. If a pending batch already exists,
    it returns that batch to maintain idempotency.
    """
    # 1. Update the last used time for this speaker on this device
    update_roster_stmt = (
        update(DeviceSpeaker)
        .where(
            DeviceSpeaker.device_id == x_device_id,
            DeviceSpeaker.speaker_id == speaker.speaker_id
        )
        .values(last_used_at=func.now())
    )
    await db.execute(update_roster_stmt)
    await db.commit()
    
    # 2. Call task generator to get or create batch
    domain_assigned, batch_no, tasks = await get_or_create_session_batch(
        db, speaker.speaker_id, domain
    )
    
    if not tasks:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "SCENARIOS_NOT_SEEDED", "message": "No scenarios found in database. Seed scenarios first."}
        )

    # 3. Build TaskResponse list with joined Scenario details
    task_responses = []
    for task in tasks:
        # Load scenario text
        scenario_stmt = select(Scenario).where(Scenario.scenario_id == task.scenario_id)
        scen_res = await db.execute(scenario_stmt)
        scenario = scen_res.scalar()
        
        task_responses.append(
            TaskResponse(
                task_id=task.task_id,
                intent=task.intent,
                scenario_id=task.scenario_id,
                scenario_no=task.scenario_no,
                example_no=task.example_no,
                text_hi=scenario.text_hi if scenario else "",
                examples=scenario.examples if scenario else [],
                register=scenario.register if scenario else None,
                status=task.status,
                redo_count=task.redo_count
            )
        )

    # 4. Calculate progress
    # Group tasks by intent to see completed intents
    intents_stmt = select(distinct(Task.intent)).where(
        Task.speaker_id == speaker.speaker_id,
        Task.domain == domain_assigned,
        Task.batch_no == batch_no
    )
    intents_res = await db.execute(intents_stmt)
    intents_in_batch = list(intents_res.scalars().all())
    intents_total = len(intents_in_batch)
    
    # Check completed intents
    intents_done = 0
    for intent in intents_in_batch:
        intent_tasks_stmt = select(func.count(Task.task_id)).where(
            Task.speaker_id == speaker.speaker_id,
            Task.domain == domain_assigned,
            Task.batch_no == batch_no,
            Task.intent == intent,
            Task.status != "recorded"  # count pending tasks
        )
        p_res = await db.execute(intent_tasks_stmt)
        pending_count = p_res.scalar() or 0
        if pending_count == 0:
            intents_done += 1

    # Find the current active task (first pending task)
    current_task = None
    for t in tasks:
        if t.status == "pending":
            current_task = t
            break

    # Initialize progress values
    current_intent = None
    scenarios_in_intent = 0
    scenarios_done = 0
    examples_in_scenario = 3
    examples_done = 0

    if current_task:
        current_intent = current_task.intent
        # Count scenarios/tasks for this intent in this batch
        scen_tasks_stmt = select(Task).where(
            Task.speaker_id == speaker.speaker_id,
            Task.domain == domain_assigned,
            Task.batch_no == batch_no,
            Task.intent == current_intent
        )
        scen_tasks_res = await db.execute(scen_tasks_stmt)
        scen_tasks = list(scen_tasks_res.scalars().all())
        
        scenarios_in_intent = len(scen_tasks)
        scenarios_done = sum(1 for t in scen_tasks if t.status == "recorded")
        
        # Calculate examples done for current scenario (across all batches / examples 1, 2, 3)
        ex_done_stmt = select(func.count(Task.task_id)).where(
            Task.speaker_id == speaker.speaker_id,
            Task.scenario_id == current_task.scenario_id,
            Task.status == "recorded"
        )
        ex_done_res = await db.execute(ex_done_stmt)
        examples_done = ex_done_res.scalar() or 0
    else:
        # All completed
        if tasks:
            current_intent = tasks[-1].intent
            scen_tasks_stmt = select(func.count(Task.task_id)).where(
                Task.speaker_id == speaker.speaker_id,
                Task.domain == domain_assigned,
                Task.batch_no == batch_no,
                Task.intent == current_intent
            )
            scen_tasks_res = await db.execute(scen_tasks_stmt)
            scenarios_in_intent = scen_tasks_res.scalar() or 0
            scenarios_done = scenarios_in_intent
            examples_done = 3

    progress = ProgressInfo(
        intents_total=intents_total,
        intents_done=intents_done,
        current_intent=current_intent,
        scenarios_in_intent=scenarios_in_intent,
        scenarios_done=scenarios_done,
        examples_in_scenario=examples_in_scenario,
        examples_done=examples_done
    )

    batch_info = SessionBatchInfo(
        domain=domain_assigned,
        batch_no=batch_no,
        tasks=task_responses,
        progress=progress
    )

    return SessionResponse(batch=batch_info)

@router.get("/progress", response_model=ProgressResponse)
async def get_detailed_progress(
    domain: str = Query(..., description="BNK, EDU, TRV, or VAS"),
    batch_no: int = Query(0, ge=0, le=3),
    speaker: Speaker = Depends(get_current_speaker_with_consent),
    db: AsyncSession = Depends(get_db)
):
    """
    Returns the three-level nested progress structure for the specified domain and batch.
    Use batch_no=0 to get the latest batch. Used to render the detailed progress bars/history in the frontend.
    """
    actual_batch = batch_no
    if batch_no == 0:
        max_batch_stmt = select(func.max(Task.batch_no)).where(
            Task.speaker_id == speaker.speaker_id,
            Task.domain == domain
        )
        max_res = await db.execute(max_batch_stmt)
        max_batch = max_res.scalar()
        actual_batch = max_batch if max_batch else 1

    stmt = select(Task).where(
        Task.speaker_id == speaker.speaker_id,
        Task.domain == domain,
        Task.batch_no == actual_batch
    ).order_by(Task.intent, Task.scenario_no, Task.example_no)
    
    res = await db.execute(stmt)
    tasks = list(res.scalars().all())
    
    if not tasks:
        # If no tasks exist, return an empty representation
        return ProgressResponse(domain=domain, batch_no=actual_batch, intents=[])
        
    # Group by intent
    intents_dict = {}
    for task in tasks:
        if task.intent not in intents_dict:
            intents_dict[task.intent] = []
        intents_dict[task.intent].append(task)
        
    intents_list = sorted(list(intents_dict.keys()))
    intent_progress_infos = []
    
    for idx, intent in enumerate(intents_list, 1):
        intent_tasks = intents_dict[intent]
        
        # Determine intent status
        # pending: no tasks completed
        # recorded: all tasks completed
        # in_progress: some tasks completed
        completed_count = sum(1 for t in intent_tasks if t.status == "recorded")
        if completed_count == len(intent_tasks):
            intent_status = "recorded"
        elif completed_count > 0:
            intent_status = "in_progress"
        else:
            intent_status = "pending"
            
        # Group intent tasks by scenario_no
        scenarios_dict = {}
        for t in intent_tasks:
            if t.scenario_no not in scenarios_dict:
                scenarios_dict[t.scenario_no] = []
            scenarios_dict[t.scenario_no].append(t)
            
        scenario_keys = sorted(list(scenarios_dict.keys()))
        scenario_progress_infos = []
        
        for scen_no in scenario_keys:
            scen_tasks = scenarios_dict[scen_no]
            
            # For each scenario, retrieve progress of examples (across all batches / examples 1, 2, 3)
            # Find the scenario_id from the first task
            scenario_id = scen_tasks[0].scenario_id
            
            # Query all tasks for this speaker and scenario across all batches to check completion of examples
            ex_stmt = select(Task.example_no, Task.status).where(
                Task.speaker_id == speaker.speaker_id,
                Task.scenario_id == scenario_id
            ).order_by(Task.example_no)
            
            ex_res = await db.execute(ex_stmt)
            ex_rows = ex_res.all()
            
            examples_progress = []
            # We have exactly 3 examples, track status of each
            ex_status_map = {r.example_no: r.status for r in ex_rows}
            for ex_no in range(1, 4):
                status_val = ex_status_map.get(ex_no, "pending")
                examples_progress.append(
                    ExampleProgressInfo(example_no=ex_no, status=status_val)
                )
                
            scenario_progress_infos.append(
                ScenarioProgressInfo(
                    scenario_no=scen_no,
                    total_scenarios=len(scenario_keys),
                    examples=examples_progress
                )
            )
            
        intent_progress_infos.append(
            IntentProgressInfo(
                intent=intent,
                intent_no=idx,
                total_intents=len(intents_list),
                status=intent_status,
                scenarios=scenario_progress_infos
            )
        )
        
    return ProgressResponse(
        domain=domain,
        batch_no=actual_batch,
        intents=intent_progress_infos
    )
