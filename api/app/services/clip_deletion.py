"""
Permanent deletion of a single recording.

Shared by the volunteer ("delete my recording") and admin ("delete this clip")
endpoints so both paths clean up identically. Recordings are otherwise retained
indefinitely - nothing in the system expires or prunes them automatically.
"""

import logging
import os

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Clip, Scenario, Task

logger = logging.getLogger(__name__)

# States that ran through /confirm, which incremented scenario.use_count and
# marked the task recorded. Deleting one of these has to undo both.
_CONFIRMED_STATES = ("confirmed", "processing", "processed")


async def delete_clip_completely(db: AsyncSession, clip: Clip) -> None:
    """
    Deletes a clip's audio files and database row, reverting the side effects
    its confirmation caused.

    Caller is responsible for authorization and for committing the session.
    """
    clip_id = clip.clip_id
    was_confirmed = clip.status in _CONFIRMED_STATES

    # 1. Remove audio from disk. Best-effort: a missing or locked file must not
    #    strand the database row, otherwise the clip is undeletable.
    for path in (clip.raw_path, clip.wav_path):
        if path and os.path.exists(path):
            try:
                os.remove(path)
            except OSError as e:
                logger.warning("Could not remove %s for clip %s: %s", path, clip_id, e)

    # 2. Free the prompt for re-recording and give the scenario's usage credit
    #    back, so coverage numbers and scenario balancing stay honest.
    if was_confirmed:
        task_res = await db.execute(select(Task).where(Task.task_id == clip.task_id))
        task = task_res.scalar()
        if task:
            task.status = "pending"
            scen_res = await db.execute(
                select(Scenario).where(Scenario.scenario_id == task.scenario_id)
            )
            scenario = scen_res.scalar()
            if scenario and scenario.use_count > 0:
                scenario.use_count -= 1

    # 3. Drop the row itself.
    await db.delete(clip)
    logger.info("Deleted clip %s (was_confirmed=%s)", clip_id, was_confirmed)
