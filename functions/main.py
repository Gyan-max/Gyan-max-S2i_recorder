"""
Cloud Functions entry points.

  api             - HTTP function hosting the whole REST API (Flask).
  process_clip    - Storage trigger: transcode raw audio to 16kHz WAV + QC.
"""

import logging

from firebase_admin import firestore
from firebase_functions import options, https_fn, storage_fn

from s2i import config
from s2i.app import create_app
from s2i.db import (
    db, get_doc, init_app, processed_object_path, query_all, upload_bytes,
)
from s2i.services.audio import TranscodeUnavailableError, process_bytes

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

init_app()

# Region matters for latency and for co-locating with the bucket. Change both
# this and the bucket location together, or every clip pays a cross-region hop.
options.set_global_options(region=options.SupportedRegion.US_CENTRAL1)

# Bucket name for this project. Set as an env var on the function rather than
# hardcoded, so staging and production can differ:
#   firebase functions:secrets / env → STORAGE_BUCKET=s2i-hinglish.firebasestorage.app
if not config.STORAGE_BUCKET:
    logger.warning(
        "STORAGE_BUCKET is unset - falling back to the Admin SDK default, which "
        "assumes <project>.appspot.com. Newer projects use .firebasestorage.app "
        "and will fail to find the bucket."
    )

_flask_app = create_app()


@https_fn.on_request(
    memory=options.MemoryOption.MB_512,
    timeout_sec=120,
    # Exports and the research bundle stream whole files; a single instance
    # handling many at once would exhaust memory.
    max_instances=20,
)
def api(req: https_fn.Request) -> https_fn.Response:
    """Serves every /api/** route through the Flask app."""
    with _flask_app.request_context(req.environ):
        return _flask_app.full_dispatch_request()


@storage_fn.on_object_finalized(
    memory=options.MemoryOption.GB_1,
    # ffmpeg on a cold start plus download/upload; 120s was too tight for
    # longer clips on a slow instance.
    timeout_sec=300,
)
def process_clip(event: storage_fn.CloudEvent[storage_fn.StorageObjectData]) -> None:
    """
    Transcodes a newly uploaded recording and records QC results.

    Fires only for objects under raw/. The processed WAV lands in processed/,
    which would otherwise re-trigger this function in a loop.
    """
    name = event.data.name or ""
    if not name.startswith(f"{config.RAW_PREFIX}/"):
        return

    # raw/clip_<uuid>.<ext>
    basename = name.split("/")[-1]
    if not basename.startswith("clip_"):
        logger.warning("Unexpected object in raw/: %s", name)
        return
    clip_id = basename[len("clip_"):].rsplit(".", 1)[0]

    clip = get_doc(config.CLIPS, clip_id)
    if not clip:
        logger.error("No clip document for %s", clip_id)
        return

    # Only process what the volunteer actually kept. An upload that was never
    # confirmed, or one already processed, must not be touched.
    if clip.get("status") != "confirmed":
        logger.info("Clip %s is '%s', not 'confirmed' - skipping.", clip_id, clip.get("status"))
        return

    client = db()
    clip_ref = client.collection(config.CLIPS).document(clip_id)
    clip_ref.update({"status": "processing"})

    from s2i.db import download_bytes
    raw = download_bytes(name)
    if raw is None:
        logger.error("Raw object vanished for clip %s", clip_id)
        clip_ref.update({"status": "confirmed"})
        return

    suffix = "." + basename.rsplit(".", 1)[-1] if "." in basename else ".webm"

    try:
        wav_bytes, qc_flags, duration = process_bytes(raw, suffix)
    except TranscodeUnavailableError as e:
        # Infrastructure fault, not bad audio. Hand the clip back so a later
        # run can retry; rejecting here would discard good corpus data.
        logger.error("Clip %s left unprocessed and awaiting retry: %s", clip_id, e)
        clip_ref.update({"status": "confirmed"})
        return

    if wav_bytes is None:
        clip_ref.update({
            "status": "rejected",
            "qc_flags": firestore.ArrayUnion(["transcode_failed"]),
        })
        logger.error("Clip %s rejected: undecodable audio", clip_id)
        return

    wav_path = processed_object_path(clip.get("filename") or f"{clip_id}.wav")
    upload_bytes(wav_path, wav_bytes, "audio/wav")

    fatal = {"silent", "corrupt"} & set(qc_flags)
    clip_ref.update({
        "wav_path": wav_path,
        "duration_s": duration,
        "qc_flags": qc_flags,
        "status": "rejected" if fatal else "processed",
        "processed_at": firestore.SERVER_TIMESTAMP,
    })

    logger.info(
        "Clip %s %s (duration=%.2fs, flags=%s)",
        clip_id, "rejected" if fatal else "processed", duration, qc_flags,
    )
