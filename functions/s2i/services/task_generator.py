"""
Session batch generation (README §14).

Decides which domain a speaker works on and materialises one task per
(scenario, example). Server-side by necessity: the domain choice depends on
global coverage across all speakers, and the shuffle must be stable per
speaker so a refresh does not reorder their prompts mid-session.
"""

import hashlib
import random
import uuid
from typing import Dict, List, Optional, Tuple

from .. import config
from ..db import db, query_all
from .scenario_assign import assign_version_for_intent


def stable_shuffle(items: list, seed_str: str) -> list:
    """
    Deterministic per-speaker ordering.

    md5 here is a seed derivation, not a security primitive - it only needs to
    spread one string into an int reproducibly.
    """
    seed_int = int(hashlib.md5(seed_str.encode()).hexdigest(), 16) & 0xFFFFFFFF
    rng = random.Random(seed_int)
    shuffled = list(items)
    rng.shuffle(shuffled)
    return shuffled


def _sort_tasks(tasks: List[dict]) -> List[dict]:
    """Presentation order: intent, then scenario, then example."""
    return sorted(
        tasks,
        key=lambda t: (t.get("intent", ""), t.get("scenario_no", 0), t.get("example_no", 0)),
    )


def _lowest_coverage_domain() -> str:
    """Picks the domain with the fewest usable clips, to even out the corpus."""
    counts: Dict[str, int] = {}
    for domain in config.DOMAINS:
        clips = query_all(config.CLIPS, [("domain", "==", domain)])
        counts[domain] = sum(
            1 for c in clips
            if c.get("status") in ("confirmed", "processing", "processed")
        )
    return min(counts, key=counts.get)


def get_or_create_session_batch(
    speaker: dict,
    requested_domain: Optional[str] = None,
) -> Tuple[str, int, List[dict]]:
    """
    Returns (domain, batch_no, tasks).

    Resumes an in-progress batch when one exists so a reload never abandons
    half-finished work.
    """
    speaker_id = speaker["speaker_id"]

    # An admin-assigned domain overrides whatever the client asked for.
    effective_domain = speaker.get("assigned_domain") or requested_domain

    # 1. Resume an existing batch if the speaker still has pending work.
    pending_filters = [("speaker_id", "==", speaker_id), ("status", "==", "pending")]
    if effective_domain:
        pending_filters.append(("domain", "==", effective_domain))
    pending = _sort_tasks(query_all(config.TASKS, pending_filters))

    if pending:
        first = pending[0]
        # Return the whole batch, not just the pending part, so the UI can show
        # the complete 3-example stepper with the finished ones marked.
        batch = query_all(
            config.TASKS,
            [
                ("speaker_id", "==", speaker_id),
                ("domain", "==", first["domain"]),
                ("batch_no", "==", first["batch_no"]),
            ],
        )
        return first["domain"], first["batch_no"], _sort_tasks(batch)

    # 2. No pending work: choose a domain.
    domain = effective_domain or _lowest_coverage_domain()

    # 3. Next batch number for this speaker in that domain.
    existing = query_all(
        config.TASKS,
        [("speaker_id", "==", speaker_id), ("domain", "==", domain)],
    )
    max_batch = max((int(t.get("batch_no", 0) or 0) for t in existing), default=None)

    if max_batch is None:
        batch_no = 1
    elif max_batch < 1:
        batch_no = max_batch + 1
    elif requested_domain:
        # Explicitly asked for this domain - keep going with another batch.
        batch_no = max_batch + 1
    else:
        # Finished here and no preference stated: offer an untouched domain
        # before repeating this one.
        for candidate in config.DOMAINS:
            if candidate == domain:
                continue
            candidate_tasks = query_all(
                config.TASKS,
                [("speaker_id", "==", speaker_id), ("domain", "==", candidate)],
            )
            candidate_max = max(
                (int(t.get("batch_no", 0) or 0) for t in candidate_tasks), default=None
            )
            if candidate_max is None or candidate_max < 1:
                domain = candidate
                batch_no = (candidate_max or 0) + 1
                break
        else:
            batch_no = max_batch + 1

    # 4. Build the batch.
    all_scenarios = query_all(config.SCENARIOS, [("domain", "==", domain)])
    if not all_scenarios:
        # Scenarios not seeded yet; the caller surfaces this rather than
        # silently handing back an empty session.
        return domain, batch_no, []

    intents = sorted({s["intent"] for s in all_scenarios})

    client = db()
    created: List[dict] = []
    # Firestore caps a batched write at 500 operations; a domain batch is
    # comfortably under that (roughly 12 intents x 2 scenarios x 3 examples).
    writer = client.batch()

    for intent in intents:
        intent_scenarios = [s for s in all_scenarios if s["intent"] == intent]
        version = assign_version_for_intent(speaker_id, intent, intent_scenarios)
        chosen = [s for s in intent_scenarios if s.get("scenario_set") == version]
        if not chosen:
            continue

        for scenario_no, scenario in enumerate(stable_shuffle(chosen, speaker_id), 1):
            for example_no in range(1, 4):
                task_id = str(uuid.uuid4())
                task = {
                    "task_id": task_id,
                    "speaker_id": speaker_id,
                    "domain": domain,
                    "intent": intent,
                    "scenario_id": scenario["scenario_id"],
                    # Denormalised so version balancing needs one query, not a join.
                    "scenario_set": scenario.get("scenario_set"),
                    "scenario_no": scenario_no,
                    "example_no": example_no,
                    "batch_no": batch_no,
                    "status": "pending",
                    "redo_count": 0,
                }
                writer.set(client.collection(config.TASKS).document(task_id), task)
                created.append({**task, "id": task_id})

    writer.commit()
    return domain, batch_no, _sort_tasks(created)
