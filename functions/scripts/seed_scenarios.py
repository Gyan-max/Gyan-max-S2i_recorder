"""
Seeds the 198 scenario prompts into Firestore.

Run once per project, from your machine with service-account credentials:

    export GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccountKey.json
    python functions/scripts/seed_scenarios.py --project your-project-id

Idempotent: scenario_id is the document id, so re-running updates prompt text
without duplicating rows. use_count is preserved on re-run - it is live
coverage data, not seed data, and resetting it would corrupt the version
balancing that reads it.
"""

import argparse
import json
import os
import sys
from pathlib import Path

import firebase_admin
from firebase_admin import credentials, firestore

REPO_ROOT = Path(__file__).resolve().parents[2]
SCENARIO_DIR = REPO_ROOT / "data" / "scenarios"

FILES = [
    "bnk_v1.json", "bnk_v2.json",
    "edu_v1.json", "edu_v2.json",
    "trv_v1.json", "trv_v2.json",
    "vas_v1.json", "vas_v2.json",
]


def load_scenarios() -> list:
    scenarios = []
    for filename in FILES:
        path = SCENARIO_DIR / filename
        if not path.exists():
            print(f"  ! missing {filename}, skipping")
            continue

        payload = json.loads(path.read_text(encoding="utf-8"))
        for raw in payload.get("scenarios", []):
            scenario_id = raw.get("scenario_id")
            intent = raw.get("intent")
            if not scenario_id or not intent:
                print(f"  ! {filename}: scenario missing id/intent, skipping")
                continue

            examples = raw.get("examples", [])
            if len(examples) != 3:
                # Not fatal: the recorder walks whatever examples exist, but
                # uneven counts skew per-intent totals, so surface it.
                print(f"  ! {scenario_id} has {len(examples)} examples (expected 3)")

            scenarios.append({
                "scenario_id": scenario_id,
                "domain": raw.get("domain") or payload.get("domain"),
                "intent": intent,
                "scenario_set": raw.get("scenario_set") or payload.get("scenario_set"),
                # Older files use text_scenario for what is now text_hi.
                "text_hi": raw.get("text_hi") or raw.get("text_scenario", ""),
                "examples": examples,
                "register": raw.get("register", "neutral"),
            })
        print(f"  loaded {filename}")
    return scenarios


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--project", help="Firebase project id")
    parser.add_argument("--credentials", help="Path to serviceAccountKey.json")
    args = parser.parse_args()

    cred_path = args.credentials or os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
    if cred_path:
        firebase_admin.initialize_app(
            credentials.Certificate(cred_path),
            {"projectId": args.project} if args.project else None,
        )
    else:
        # Falls back to application-default credentials (gcloud auth).
        firebase_admin.initialize_app(
            options={"projectId": args.project} if args.project else None
        )

    db = firestore.client()

    print("Loading scenario files...")
    scenarios = load_scenarios()
    if not scenarios:
        print("No scenarios found. Is data/scenarios/ present?")
        return 1
    print(f"Total: {len(scenarios)} scenarios\n")

    existing = {d.id for d in db.collection("scenarios").select([]).stream()}
    print(f"Already in Firestore: {len(existing)}")

    written = 0
    batch = db.batch()
    for i, scenario in enumerate(scenarios, 1):
        ref = db.collection("scenarios").document(scenario["scenario_id"])
        payload = dict(scenario)
        if scenario["scenario_id"] not in existing:
            # Only initialise the counter for genuinely new scenarios.
            payload["use_count"] = 0
        batch.set(ref, payload, merge=True)
        written += 1

        # Firestore caps a batch at 500 writes.
        if i % 400 == 0:
            batch.commit()
            batch = db.batch()
            print(f"  committed {i}...")
    batch.commit()

    print(f"\nSeeded {written} scenarios ({len(scenarios) - len(existing & {s['scenario_id'] for s in scenarios})} new).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
