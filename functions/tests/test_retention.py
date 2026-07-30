"""
Tests for the retention invariant: a kept recording is admin-delete only.

Recordings cannot be recreated, so this is the one rule in the codebase where
failing a request is always cheaper than proceeding. These tests exist so a
future refactor cannot quietly reintroduce a path that deletes confirmed audio
without an administrator.

No emulator, credentials or network: Firestore and Storage access is patched
out, because what is under test is the guard, not the writes it protects.

Run:  python -m pytest functions/tests -q
"""

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from s2i.services.clip_deletion import (
    ACTOR_ADMIN,
    ACTOR_SPEAKER_REDO,
    ProtectedRecordingError,
    delete_clip_completely,
)

# Every state that means "the volunteer kept this take".
CONFIRMED_STATES = ("confirmed", "processing", "processed")
UNCONFIRMED_STATES = ("initiated", "uploaded", "discarded", "rejected")


def _clip(status):
    return {
        "clip_id": "abc123",
        "task_id": "task-1",
        "status": status,
        "raw_path": "raw/clip_abc123.webm",
        "wav_path": "processed/bnk_asha_verma_block_card_v1_s1e1_abc123.wav",
    }


@pytest.mark.parametrize("status", CONFIRMED_STATES)
@pytest.mark.parametrize("actor", [ACTOR_SPEAKER_REDO, "system", "cron", ""])
def test_non_admin_cannot_delete_a_kept_recording(status, actor):
    """The core invariant. Anything but an admin must be refused."""
    with patch("s2i.services.clip_deletion.delete_object") as delete_object, \
         patch("s2i.services.clip_deletion.db") as db:
        with pytest.raises(ProtectedRecordingError):
            delete_clip_completely(_clip(status), actor=actor)

        # The refusal must happen *before* any destructive call, otherwise the
        # audio is already gone by the time the error is raised.
        delete_object.assert_not_called()
        db.assert_not_called()


@pytest.mark.parametrize("status", CONFIRMED_STATES)
def test_admin_can_delete_a_kept_recording(status):
    """Admin deletion is the one sanctioned path and must keep working."""
    with patch("s2i.services.clip_deletion.delete_object") as delete_object, \
         patch("s2i.services.clip_deletion.db") as db, \
         patch("s2i.services.clip_deletion.get_doc", return_value=None):
        db.return_value = MagicMock()

        delete_clip_completely(_clip(status), actor=ACTOR_ADMIN)

        # Both the raw upload and the processed WAV have to go.
        deleted = {c.args[0] for c in delete_object.call_args_list}
        assert deleted == {
            "raw/clip_abc123.webm",
            "processed/bnk_asha_verma_block_card_v1_s1e1_abc123.wav",
        }


@pytest.mark.parametrize("status", UNCONFIRMED_STATES)
def test_unconfirmed_takes_may_be_cleaned_up_by_a_redo(status):
    """
    A take the volunteer never kept is not corpus data, so a redo may remove
    it. Without this, re-recording would strand an object per attempt.
    """
    with patch("s2i.services.clip_deletion.delete_object"), \
         patch("s2i.services.clip_deletion.db") as db, \
         patch("s2i.services.clip_deletion.get_doc", return_value=None):
        db.return_value = MagicMock()
        delete_clip_completely(_clip(status), actor=ACTOR_SPEAKER_REDO)


def test_actor_is_required_and_keyword_only():
    """
    A caller cannot delete by accident: omitting `actor` is a TypeError, so the
    decision of who is deleting has to be made explicitly at every call site.
    """
    with pytest.raises(TypeError):
        delete_clip_completely(_clip("confirmed"))  # type: ignore[call-arg]

    with pytest.raises(TypeError):
        delete_clip_completely(_clip("confirmed"), ACTOR_ADMIN)  # type: ignore[misc]


def test_no_route_deletes_a_clip_outside_the_guard():
    """
    Greps the route layer. `delete_clip_completely` centralises the invariant,
    so a route calling Firestore's raw `.delete()` on a clip document would
    bypass it - which is exactly the regression this test is here to catch.

    The speaker withdrawal endpoint is the documented exception: it is
    admin-only right-to-erasure and deletes a whole speaker's data by design.
    """
    routes = Path(__file__).resolve().parents[1] / "s2i" / "routes"
    volunteer = (routes / "volunteer.py").read_text(encoding="utf-8")

    # The volunteer surface must not delete clip documents at all.
    assert "CLIPS).document(clip_id).delete()" not in volunteer, (
        "volunteer.py deletes a clip document directly, bypassing the "
        "retention guard in clip_deletion.py"
    )

    # And it must not call the deletion helper either: every volunteer-facing
    # delete route was replaced by an explicit ADMIN_ONLY refusal.
    assert "delete_clip_completely" not in volunteer, (
        "volunteer.py calls delete_clip_completely; speaker-initiated deletion "
        "of recordings is not permitted"
    )
