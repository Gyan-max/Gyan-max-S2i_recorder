"""
Tests for the business logic that must not drift during the Firebase port.

Scope is deliberately the pure functions: filename generation, the stable
shuffle and version balancing. Those encode corpus-integrity rules, and unlike
the Firestore paths they can be verified with no emulator, no credentials and
no network.

Run:  python -m pytest functions/tests -q
"""

import sys
from pathlib import Path
from unittest.mock import patch

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from s2i.services.naming import generate_canonical_filename
from s2i.services.task_generator import stable_shuffle


# ==================== Canonical filenames ====================

def test_filename_matches_documented_format():
    """The manifest and research ZIP parse this shape; it must not drift."""
    name = generate_canonical_filename(
        domain="BNK",
        speaker_id="SPK_0042",
        intent="BNK.block_card",
        scenario_set="v2",
        scenario_no=2,
        example_no=1,
        clip_id="9f3a1c8e-1234-5678-9abc-def012345678",
        speaker_name="Rahul Sharma",
    )
    assert name == "bnk_rahul_sharma_block_card_v2_s2e1_9f3a1c.wav"


def test_filename_falls_back_to_speaker_id_without_a_name():
    name = generate_canonical_filename(
        domain="EDU", speaker_id="SPK_0007", intent="EDU.quiz_me",
        scenario_set="v1", scenario_no=1, example_no=3,
        clip_id="abcdef123456", speaker_name="",
    )
    # Note the case: the named branch lowercases, this one does not. That
    # asymmetry exists in the FastAPI build too and is preserved deliberately -
    # changing it would rename every existing clip in the corpus.
    assert name == "edu_SPK0007_quiz_me_v1_s1e3_abcdef.wav"


def test_filename_sanitises_hostile_names():
    """A crafted name must not escape into a path or break the manifest."""
    name = generate_canonical_filename(
        domain="TRV", speaker_id="SPK_0001", intent="TRV.book_cab",
        scenario_set="v1", scenario_no=1, example_no=1,
        clip_id="aaaaaa", speaker_name="../../etc/passwd",
    )
    assert "/" not in name
    assert ".." not in name.replace(".wav", "")
    assert name.endswith(".wav")


def test_filename_strips_domain_prefix_from_intent():
    name = generate_canonical_filename(
        domain="VAS", speaker_id="SPK_0002", intent="VAS.set_alarm",
        scenario_set="v2", scenario_no=3, example_no=2,
        clip_id="bbbbbb",
    )
    assert "_set_alarm_" in name
    assert "vas.set_alarm" not in name


# ==================== Stable shuffle ====================

def test_shuffle_is_stable_for_the_same_speaker():
    """A reload must not reorder a volunteer's prompts mid-session."""
    items = list(range(20))
    assert stable_shuffle(items, "SPK_0001") == stable_shuffle(items, "SPK_0001")


def test_shuffle_differs_between_speakers():
    """Every speaker starting on the same scenario would bias early coverage."""
    items = list(range(20))
    orders = {
        tuple(stable_shuffle(items, f"SPK_{i:04d}"))
        for i in range(1, 8)
    }
    assert len(orders) > 1


def test_shuffle_preserves_all_items():
    items = list(range(50))
    assert sorted(stable_shuffle(items, "SPK_0009")) == items


# ==================== Scenario version balancing ====================

def _scenarios(v1_use, v2_use):
    return (
        [{"scenario_id": f"I.v1.s{i}", "scenario_set": "v1", "use_count": u}
         for i, u in enumerate(v1_use, 1)]
        + [{"scenario_id": f"I.v2.s{i}", "scenario_set": "v2", "use_count": u}
           for i, u in enumerate(v2_use, 1)]
    )


def test_balancing_prefers_the_less_used_version():
    from s2i.services import scenario_assign

    # v1 heavily used, v2 barely: v2 should win by a margin jitter cannot close.
    with patch.object(scenario_assign, "query_all", return_value=[]):
        chosen = scenario_assign.assign_version_for_intent(
            "SPK_0001", "BNK.check_balance", _scenarios([50, 40], [0, 0])
        )
    assert chosen == "v2"


def test_balancing_penalises_versions_this_speaker_already_recorded():
    """
    Alternation: a speaker who already has v1 tasks should be pushed to v2
    even when global counts are equal.
    """
    from s2i.services import scenario_assign

    speaker_tasks = [{"scenario_set": "v1"} for _ in range(5)]
    with patch.object(scenario_assign, "query_all", return_value=speaker_tasks):
        chosen = scenario_assign.assign_version_for_intent(
            "SPK_0001", "BNK.check_balance", _scenarios([0, 0], [0, 0])
        )
    assert chosen == "v2"


def test_balancing_always_returns_a_valid_version():
    from s2i.services import scenario_assign

    with patch.object(scenario_assign, "query_all", return_value=[]):
        for _ in range(25):
            chosen = scenario_assign.assign_version_for_intent(
                "SPK_0001", "BNK.check_balance", _scenarios([3], [3])
            )
            assert chosen in ("v1", "v2")


# ==================== Storage paths ====================

def test_raw_object_path_is_server_chosen_and_extension_maps_by_mime():
    from s2i.db import raw_object_path

    assert raw_object_path("abc-123", "audio/webm;codecs=opus") == "raw/clip_abc-123.webm"
    assert raw_object_path("abc-123", "audio/mp4") == "raw/clip_abc-123.mp4"
    assert raw_object_path("abc-123", "audio/ogg") == "raw/clip_abc-123.ogg"
    # Unknown types fall back rather than trusting client-supplied text.
    assert raw_object_path("abc-123", "application/octet-stream") == "raw/clip_abc-123.webm"


def test_processed_path_cannot_escape_its_prefix():
    from s2i.db import processed_object_path

    assert processed_object_path("../../secret.wav") == "processed/secret.wav"
    assert processed_object_path("a/b/c.wav") == "processed/c.wav"
