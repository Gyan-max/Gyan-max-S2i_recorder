"""
Firestore and Cloud Storage access.

Deliberately thin: helpers for the patterns the API needs repeatedly, not a
general ORM. Firestore's model is different enough from SQLAlchemy's that
pretending otherwise hides the parts that actually matter here - transactions
for counters, and the fact that there are no joins.
"""

import logging
from typing import Any, Dict, Iterable, List, Optional

import firebase_admin
from firebase_admin import firestore, storage
from google.cloud.firestore_v1 import FieldFilter

from . import config

logger = logging.getLogger(__name__)

_app = None


def init_app():
    """Initialises the Admin SDK once per process (functions reuse instances)."""
    global _app
    if _app is None:
        try:
            _app = firebase_admin.get_app()
        except ValueError:
            _app = firebase_admin.initialize_app()
    return _app


def db():
    init_app()
    return firestore.client()


def bucket():
    """
    Returns the storage bucket.

    Passing the name explicitly when configured avoids the Admin SDK falling
    back to "<project>.appspot.com", which does not exist for projects created
    with the newer ".firebasestorage.app" naming.
    """
    init_app()
    if config.STORAGE_BUCKET:
        return storage.bucket(config.STORAGE_BUCKET)
    return storage.bucket()


# ==================== Document helpers ====================

def doc_to_dict(snapshot) -> Optional[Dict[str, Any]]:
    """Returns a document's data with its id folded in, or None if missing."""
    if snapshot is None or not snapshot.exists:
        return None
    data = snapshot.to_dict() or {}
    data["id"] = snapshot.id
    return data


def get_doc(collection: str, doc_id: str) -> Optional[Dict[str, Any]]:
    if not doc_id:
        return None
    return doc_to_dict(db().collection(collection).document(doc_id).get())


def query_all(collection: str, filters: Iterable[tuple] = ()) -> List[Dict[str, Any]]:
    """
    Runs an equality/comparison query and materialises the results.

    Firestore has no JOIN, so callers that need related documents fetch them
    explicitly. Keep result sets bounded; this walks every match.
    """
    ref = db().collection(collection)
    for field, op, value in filters:
        ref = ref.where(filter=FieldFilter(field, op, value))
    return [doc_to_dict(d) for d in ref.stream()]


def count_where(collection: str, filters: Iterable[tuple] = ()) -> int:
    """
    Counts matching documents using Firestore's aggregation query, which is
    billed per index scan rather than per document returned.
    """
    ref = db().collection(collection)
    for field, op, value in filters:
        ref = ref.where(filter=FieldFilter(field, op, value))
    result = ref.count().get()
    # Aggregation results arrive as [[AggregationResult]].
    try:
        return int(result[0][0].value)
    except (IndexError, TypeError, AttributeError):
        return 0


# ==================== Sequential speaker IDs ====================

def next_speaker_label() -> str:
    """
    Allocates the next SPK_00NN label.

    Firestore ids are opaque, but the corpus filename format and every existing
    export expect a readable, ordered speaker label. A transaction on a single
    counter document keeps them unique under concurrent signups.
    """
    client = db()
    counter_ref = client.collection(config.COUNTERS).document("speakers")

    @firestore.transactional
    def _increment(transaction):
        snapshot = counter_ref.get(transaction=transaction)
        current = (snapshot.to_dict() or {}).get("value", 0) if snapshot.exists else 0
        nxt = current + 1
        transaction.set(counter_ref, {"value": nxt}, merge=True)
        return nxt

    value = _increment(client.transaction())
    return f"SPK_{value:04d}"


# ==================== Storage helpers ====================

def raw_object_path(clip_id: str, mime_type: str) -> str:
    """Server-chosen object path. Clients never supply this."""
    ext = "webm"
    mime = (mime_type or "").lower()
    if "mp4" in mime:
        ext = "mp4"
    elif "wav" in mime:
        ext = "wav"
    elif "ogg" in mime:
        ext = "ogg"
    return f"{config.RAW_PREFIX}/clip_{clip_id}.{ext}"


def processed_object_path(filename: str) -> str:
    # basename guards against a crafted filename escaping the prefix.
    safe = filename.replace("\\", "/").split("/")[-1]
    return f"{config.PROCESSED_PREFIX}/{safe}"


def upload_bytes(path: str, data: bytes, content_type: str) -> None:
    blob = bucket().blob(path)
    blob.upload_from_string(data, content_type=content_type)


def download_bytes(path: str) -> Optional[bytes]:
    blob = bucket().blob(path)
    if not blob.exists():
        return None
    return blob.download_as_bytes()


def delete_object(path: Optional[str]) -> None:
    """Best-effort delete; a missing object must not strand the caller."""
    if not path:
        return
    try:
        blob = bucket().blob(path)
        if blob.exists():
            blob.delete()
    except Exception as e:
        logger.warning("Could not delete storage object %s: %s", path, e)
