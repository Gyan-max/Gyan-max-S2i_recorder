"""
Scenario version balancing (README §10).

Chooses v1 or v2 per speaker+intent so the corpus ends up with comparable
coverage of both phrasings rather than whichever one happened to be assigned
first. This is the clearest example of why the client cannot be trusted with
task assignment: the decision depends on global counters no browser can see.

Scoring, unchanged from the SQL implementation:

    version = argmin over {v1, v2} of
              sum(use_count) for that intent+version
            + 2.0 * tasks this speaker already has for that intent+version
            + uniform(0, 0.1)
"""

import random
from typing import Dict, List

from .. import config
from ..db import query_all


def assign_version_for_intent(speaker_id: str, intent: str, scenarios: List[dict]) -> str:
    """
    `scenarios` is every scenario document for this intent, passed in so the
    caller can fetch the collection once per batch instead of once per intent.
    Firestore charges per document read, and a batch touches ~12 intents.
    """
    # Tasks this speaker already holds for this intent, whatever the version.
    speaker_tasks = query_all(
        config.TASKS,
        [("speaker_id", "==", speaker_id), ("intent", "==", intent)],
    )

    scores: Dict[str, float] = {}
    for version in ("v1", "v2"):
        version_scenarios = [s for s in scenarios if s.get("scenario_set") == version]

        # 1. Global representation balance.
        global_use_count = sum(int(s.get("use_count", 0) or 0) for s in version_scenarios)

        # 2. Alternation: how much this speaker has already done in this version.
        #    Denormalised onto the task so this stays a single query - Firestore
        #    cannot join tasks to scenarios the way the SQL version did.
        speaker_use_count = sum(
            1 for t in speaker_tasks if t.get("scenario_set") == version
        )

        # 3. Jitter breaks ties so the first intent does not deterministically
        #    lock every speaker onto the same version.
        jitter = random.uniform(0, 0.1)

        scores[version] = global_use_count + 2.0 * speaker_use_count + jitter

    return min(scores, key=scores.get)
