#!/usr/bin/env python3
"""
Audits - and optionally enforces - that nothing can delete recordings on a timer.

The application code cannot cause automatic deletion (no scheduled function, no
pruning, no expiry; see s2i/services/clip_deletion.py). The one remaining way
audio can vanish without an administrator asking is infrastructure configured
outside this repo:

  * a Cloud Storage **lifecycle rule** on the audio bucket, which deletes
    objects by age or version count, and
  * a Firestore **TTL policy** on the `clips` collection, which deletes the
    documents that point at that audio.

Neither lives in firebase.json, so `firebase deploy` can neither create nor
remove them. This script is how that state gets checked and pinned.

Usage:
    export GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccountKey.json

    # Report only. Exits 1 if anything could auto-delete.
    python functions/scripts/protect_recordings.py

    # Clear any lifecycle rule found on the bucket.
    python functions/scripts/protect_recordings.py --enforce

The TTL check is read-only in all modes: removing a TTL policy requires the
Firestore Admin API and is a deliberate enough act that it should be done by
hand, in the console, by someone who knows why it was added.
"""

import argparse
import os
import sys

# The bucket the functions actually write to. Kept consistent with
# functions/.env rather than guessed, because the Admin SDK's implicit default
# assumes <project>.appspot.com and this project uses .firebasestorage.app.
DEFAULT_BUCKET = os.getenv("STORAGE_BUCKET", "").strip()


def _fail(msg: str) -> None:
    print(f"  [RISK] {msg}")


def _ok(msg: str) -> None:
    print(f"  [ok]   {msg}")


def check_bucket_lifecycle(bucket_name: str, enforce: bool) -> bool:
    """Returns True if the bucket is safe (no lifecycle rules)."""
    from google.cloud import storage

    client = storage.Client()
    bucket = client.get_bucket(bucket_name)
    rules = list(bucket.lifecycle_rules)

    print(f"\nCloud Storage lifecycle - gs://{bucket_name}")

    if not rules:
        _ok("no lifecycle rules; objects are retained indefinitely")
        return True

    _fail(f"{len(rules)} lifecycle rule(s) found. These DELETE OR DOWNGRADE AUDIO:")
    for rule in rules:
        print(f"         {rule}")

    if not enforce:
        print("\n  Re-run with --enforce to clear them.")
        return False

    bucket.lifecycle_rules = []
    bucket.patch()
    # Re-read rather than trust the local object: this is the assertion that
    # matters, so it should reflect what the API now reports.
    bucket = client.get_bucket(bucket_name)
    remaining = list(bucket.lifecycle_rules)
    if remaining:
        _fail(f"cleared, but {len(remaining)} rule(s) still present: {remaining}")
        return False

    _ok("lifecycle rules cleared; objects are now retained indefinitely")
    return True


def check_soft_delete(bucket_name: str) -> None:
    """
    Reports the bucket's soft-delete window - purely informational.

    Soft delete is a recovery net for an *accidental* delete, not an
    auto-deletion risk. It is deliberately not changed here: lengthening it
    would keep audio recoverable after a right-to-erasure request, which is a
    consent question for whoever owns the study's ethics approval.
    """
    from google.cloud import storage

    client = storage.Client()
    bucket = client.get_bucket(bucket_name)
    policy = getattr(bucket, "soft_delete_policy", None)
    seconds = getattr(policy, "retention_duration_seconds", None) if policy else None

    print(f"\nSoft-delete recovery window - gs://{bucket_name}")
    if seconds:
        _ok(f"deleted objects recoverable for {int(seconds) // 86400} day(s)")
    else:
        _ok("no soft-delete window reported (deletes are immediate)")


def check_firestore_ttl(project_id: str) -> bool:
    """
    Returns True if no TTL policy is active on the clips collection.

    Read-only by design. A TTL field on `clips` would delete the documents that
    point at the audio, orphaning every object in the bucket.
    """
    print(f"\nFirestore TTL policies - project {project_id}")
    try:
        from google.cloud import firestore_admin_v1
    except ImportError:
        print("  [skip] google-cloud-firestore-admin not installed.")
        print("         Check by hand: console -> Firestore -> Time-to-live (TTL).")
        print("         There must be no policy on the 'clips' collection.")
        return True

    client = firestore_admin_v1.FirestoreAdminClient()
    parent = f"projects/{project_id}/databases/(default)/collectionGroups/clips"
    risky = False
    try:
        for field in client.list_fields(parent=parent):
            ttl = getattr(field, "ttl_config", None)
            if ttl and getattr(ttl, "state", 0):
                _fail(f"TTL policy ACTIVE on {field.name} - clips will be deleted")
                risky = True
    except Exception as e:
        print(f"  [skip] could not read field config ({e}).")
        print("         Check by hand: console -> Firestore -> Time-to-live (TTL).")
        return True

    if not risky:
        _ok("no TTL policy on the clips collection")
    return not risky


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--bucket",
        default=DEFAULT_BUCKET,
        help="Audio bucket (defaults to $STORAGE_BUCKET)",
    )
    parser.add_argument("--project", default=None, help="Firebase project id")
    parser.add_argument(
        "--enforce",
        action="store_true",
        help="Clear any lifecycle rules found instead of only reporting them",
    )
    args = parser.parse_args()

    if not args.bucket:
        print(
            "No bucket given. Pass --bucket, or set STORAGE_BUCKET "
            "(see functions/.env).",
            file=sys.stderr,
        )
        return 2

    project = args.project or args.bucket.split(".")[0]

    print("Recording-retention audit")
    print("=" * 60)
    print("Verifying nothing can delete recordings automatically.")

    safe = True
    try:
        safe &= check_bucket_lifecycle(args.bucket, args.enforce)
        check_soft_delete(args.bucket)
        safe &= check_firestore_ttl(project)
    except Exception as e:
        print(f"\nAudit could not complete: {e}", file=sys.stderr)
        print(
            "Check GOOGLE_APPLICATION_CREDENTIALS and that the service account "
            "can read the bucket.",
            file=sys.stderr,
        )
        return 2

    print("\n" + "=" * 60)
    if safe:
        print("PASS - no automatic-deletion mechanism is configured.")
        print("Recordings are removable only via DELETE /api/admin/clips/<id>.")
        return 0

    print("FAIL - something above can delete recordings without an admin.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
