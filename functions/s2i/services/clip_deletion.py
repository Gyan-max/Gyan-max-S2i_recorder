"""
Permanent deletion of a single recording.

Recordings are retained indefinitely: nothing in this codebase expires, prunes
or garbage-collects them, and there is no scheduled function that could. A
*kept* recording (one that reached /confirm) is corpus data and only an
administrator may remove it.

That rule is enforced structurally rather than by convention. `actor` is a
required keyword argument, so a future caller cannot delete a confirmed clip by
forgetting a flag - the code will not run until whoever wrote it states who is
deleting, and anything other than ADMIN raises on a confirmed clip.
"""

import logging
from typing import Dict

from google.cloud.firestore_v1 import Increment

from .. import config
from ..db import db, delete_object, get_doc

logger = logging.getLogger(__name__)

# States that went through /confirm, which incremented scenario.use_count and
# marked the task recorded. Deleting one of these has to undo both.
_CONFIRMED_STATES = ("confirmed", "processing", "processed")

#: The only actor permitted to delete a confirmed recording.
ACTOR_ADMIN = "admin"
#: A volunteer re-recording a take they never kept. Unconfirmed clips only.
ACTOR_SPEAKER_REDO = "speaker_redo"


class ProtectedRecordingError(RuntimeError):
    """
    Raised when something tries to delete a kept recording without being an
    administrator. This is a bug in the caller, not a user-facing condition -
    it exists so such a bug fails loudly in logs instead of silently
    destroying corpus data.
    """


def delete_clip_completely(clip: Dict, *, actor: str) -> None:
    """
    Deletes a clip's audio objects and Firestore document, reverting the side
    effects its confirmation caused.

    Caller handles authentication; this function enforces the retention
    invariant. Pass `actor=ACTOR_ADMIN` for an administrator action. Any other
    actor may only delete a clip that was never confirmed.
    """
    clip_id = clip["clip_id"]
    was_confirmed = clip.get("status") in _CONFIRMED_STATES

    if was_confirmed and actor != ACTOR_ADMIN:
        # Deliberately refuse rather than log-and-continue: a kept recording
        # cannot be recreated, so failing the request is always the cheaper
        # outcome than deleting it.
        raise ProtectedRecordingError(
            f"Refusing to delete confirmed clip {clip_id}: actor {actor!r} is "
            f"not {ACTOR_ADMIN!r}. Kept recordings are admin-delete only."
        )

    # 1. Remove audio. Best-effort: a missing object must not strand the
    #    document, otherwise the clip becomes undeletable.
    delete_object(clip.get("raw_path"))
    delete_object(clip.get("wav_path"))

    client = db()

    # 2. Free the prompt for re-recording and hand back the scenario's usage
    #    credit, so coverage and version balancing stay honest.
    if was_confirmed:
        task = get_doc(config.TASKS, clip.get("task_id"))
        if task:
            client.collection(config.TASKS).document(task["task_id"]).update(
                {"status": "pending"}
            )
            scenario_id = task.get("scenario_id")
            if scenario_id:
                scenario = get_doc(config.SCENARIOS, scenario_id)
                # Increment(-1) is atomic, but guard against going negative if
                # counters were ever reconciled by hand.
                if scenario and int(scenario.get("use_count", 0) or 0) > 0:
                    client.collection(config.SCENARIOS).document(scenario_id).update(
                        {"use_count": Increment(-1)}
                    )

    # 3. Drop the document.
    client.collection(config.CLIPS).document(clip_id).delete()
    logger.info(
        "Deleted clip %s (was_confirmed=%s, actor=%s)", clip_id, was_confirmed, actor
    )
