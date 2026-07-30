"""
Volunteer-facing endpoints.

Paths and payloads match the FastAPI build exactly so the existing frontend
only has to change where it gets its token, not how it calls the API.
"""

import logging
import uuid
from datetime import datetime, timezone

from flask import Blueprint, g, jsonify, request
from google.cloud.firestore_v1 import Increment

from .. import config
from ..auth import consented_speaker_required, speaker_required, verify_id_token
from ..db import (
    db, delete_object, download_bytes, get_doc, next_speaker_label,
    query_all, raw_object_path, upload_bytes,
)
from ..errors import ApiError
from ..services.naming import generate_canonical_filename
from ..services.task_generator import get_or_create_session_batch

logger = logging.getLogger(__name__)
bp = Blueprint("volunteer", __name__)


def _now():
    return datetime.now(timezone.utc)


def _age_band(age: int) -> str:
    """Only the band is ever exported - raw age never leaves the database."""
    if age < 18:
        return "under-18"
    if age <= 25:
        return "18-25"
    if age <= 35:
        return "26-35"
    if age <= 50:
        return "36-50"
    return "50+"


def _task_response(task: dict) -> dict:
    """Shapes a task plus its scenario text for the recording screen."""
    scenario = get_doc(config.SCENARIOS, task.get("scenario_id")) or {}
    return {
        "task_id": task["task_id"],
        "domain": task.get("domain"),
        "intent": task.get("intent"),
        "scenario_id": task.get("scenario_id"),
        "scenario_no": task.get("scenario_no"),
        "example_no": task.get("example_no"),
        "text_hi": scenario.get("text_hi", ""),
        "examples": scenario.get("examples", []),
        "register": scenario.get("register"),
        "status": task.get("status"),
        "redo_count": task.get("redo_count", 0),
    }


# ==================== Health ====================

@bp.get("/health")
def health():
    """Unauthenticated liveness probe; also reports whether seeding has run."""
    try:
        seeded = len(query_all(config.SCENARIOS)[:1]) > 0
        scenario_count = sum(1 for _ in db().collection(config.SCENARIOS).stream()) if seeded else 0
        return jsonify({
            "status": "healthy",
            "backend": "firebase",
            "database": "connected",
            "consent_version": config.CONSENT_VERSION,
            "scenarios_loaded": scenario_count,
        })
    except Exception as e:
        logger.exception("Health check failed")
        return jsonify({"status": "unhealthy", "error": str(e)}), 503


# ==================== Devices ====================

@bp.post("/devices")
def register_device():
    """
    Records the browser/device a session runs on.

    Idempotent by document id, so the duplicate call React's StrictMode fires
    in development cannot produce a conflict.
    """
    body = request.get_json(silent=True) or {}
    device_id = (body.get("device_id") or "").strip()
    if not device_id:
        raise ApiError(400, "DEVICE_ID_REQUIRED", "device_id is required.")

    ref = db().collection(config.DEVICES).document(device_id)
    existing = ref.get()
    if existing.exists:
        ref.update({"last_seen": _now()})
    else:
        ref.set({
            "device_id": device_id,
            "ua_class": body.get("ua_class"),
            "first_seen": _now(),
            "last_seen": _now(),
        })
    return jsonify({"device_id": device_id}), 201


# ==================== Speakers ====================

@bp.post("/speakers")
def create_speaker():
    """
    Creates the signed-in user's speaker profile and records consent.

    Keyed by Firebase uid, so a returning volunteer on any device resolves to
    the same profile and the same recordings. Calling twice returns the
    existing profile rather than minting a duplicate.
    """
    claims = verify_id_token()
    uid = claims["uid"]

    existing = get_doc(config.SPEAKERS, uid)
    if existing:
        return jsonify({
            "speaker_id": existing["speaker_id"],
            "age_band": existing.get("age_band"),
            "consent_at": existing.get("consent_at"),
            "name": existing.get("name"),
        }), 200

    body = request.get_json(silent=True) or {}
    try:
        age = int(body.get("age"))
    except (TypeError, ValueError):
        raise ApiError(400, "INVALID_AGE", "A valid age is required.")
    if not 10 <= age <= 100:
        raise ApiError(400, "INVALID_AGE", "Age must be between 10 and 100.")

    if not body.get("consent_version"):
        raise ApiError(403, "CONSENT_REQUIRED", "Consent is required to participate.")

    speaker_label = next_speaker_label()
    profile = {
        "speaker_id": speaker_label,
        "uid": uid,
        "email": claims.get("email"),
        "name": (body.get("name") or "").strip() or None,
        "age": age,
        "age_band": _age_band(age),
        "gender": body.get("gender"),
        "l1": body.get("l1"),
        "region": body.get("region"),
        "consent_version": body.get("consent_version"),
        "consent_at": _now(),
        "created_at": _now(),
        "withdrawn_at": None,
        "assigned_domain": None,
    }
    db().collection(config.SPEAKERS).document(uid).set(profile)

    device_id = request.headers.get("X-Device-ID")
    if device_id:
        db().collection(config.DEVICE_SPEAKERS).document(f"{device_id}_{uid}").set({
            "device_id": device_id,
            "speaker_id": speaker_label,
            "uid": uid,
            "last_used_at": _now(),
        })

    return jsonify({
        "speaker_id": speaker_label,
        "age_band": profile["age_band"],
        "consent_at": profile["consent_at"].isoformat(),
        "name": profile["name"],
    }), 201


@bp.get("/speakers/me")
@speaker_required
def get_me():
    """The signed-in volunteer's own profile - how the app restores a session."""
    s = g.speaker
    return jsonify({
        "speaker_id": s["speaker_id"],
        "name": s.get("name"),
        "age_band": s.get("age_band"),
        "gender": s.get("gender"),
        "l1": s.get("l1"),
        "region": s.get("region"),
        "consent_at": s.get("consent_at"),
        "assigned_domain": s.get("assigned_domain"),
    })


# ==================== Session ====================

@bp.get("/session/next")
@consented_speaker_required
def session_next():
    """Issues or resumes the speaker's task batch."""
    requested_domain = request.args.get("domain")
    domain, batch_no, tasks = get_or_create_session_batch(g.speaker, requested_domain)

    if not tasks:
        raise ApiError(
            503, "NOT_SEEDED",
            "No prompts are available yet. Seed the scenarios before recording.",
        )

    intents = sorted({t.get("intent") for t in tasks})
    done_intents = sorted({
        t.get("intent") for t in tasks if t.get("status") == "recorded"
    })

    return jsonify({
        "batch": {
            "domain": domain,
            "batch_no": batch_no,
            "tasks": [_task_response(t) for t in tasks],
            "progress": {
                "intents_total": len(intents),
                "intents_done": len(done_intents),
                "current_intent": tasks[0].get("intent") if tasks else None,
                "scenarios_in_intent": 0,
                "scenarios_done": 0,
                "examples_in_scenario": 3,
                "examples_done": sum(1 for t in tasks if t.get("status") == "recorded"),
            },
        }
    })


@bp.get("/session/progress")
@consented_speaker_required
def session_progress():
    """Per-intent / scenario / example completion for the progress screen."""
    domain = request.args.get("domain")
    filters = [("speaker_id", "==", g.speaker["speaker_id"])]
    if domain:
        filters.append(("domain", "==", domain))
    tasks = query_all(config.TASKS, filters)

    by_intent: dict = {}
    for t in tasks:
        by_intent.setdefault(t["intent"], []).append(t)

    intents = []
    for intent_no, (intent, intent_tasks) in enumerate(sorted(by_intent.items()), 1):
        by_scenario: dict = {}
        for t in intent_tasks:
            by_scenario.setdefault(t.get("scenario_no", 0), []).append(t)

        scenarios = []
        for scenario_no, scenario_tasks in sorted(by_scenario.items()):
            scenarios.append({
                "scenario_no": scenario_no,
                "total_scenarios": len(by_scenario),
                "examples": [
                    {"example_no": t.get("example_no"), "status": t.get("status")}
                    for t in sorted(scenario_tasks, key=lambda x: x.get("example_no", 0))
                ],
            })

        intents.append({
            "intent": intent,
            "intent_no": intent_no,
            "total_intents": len(by_intent),
            "scenarios": scenarios,
        })

    return jsonify({"domain": domain, "intents": intents})


# ==================== Clips ====================

@bp.post("/clips/init")
@consented_speaker_required
def clip_init():
    """
    Reserves a clip slot and assigns its canonical filename.

    The filename and storage path are decided here, never by the client - the
    dataset manifest depends on that format being authoritative.
    """
    body = request.get_json(silent=True) or {}
    task_id = body.get("task_id")
    mime_type = body.get("mime_type") or "audio/webm"

    task = get_doc(config.TASKS, task_id)
    if not task:
        raise ApiError(404, "TASK_NOT_FOUND", "Task not found.")
    if task["speaker_id"] != g.speaker["speaker_id"]:
        raise ApiError(403, "FORBIDDEN", "Task belongs to another speaker.")
    if task.get("status") == "recorded":
        raise ApiError(409, "ALREADY_RECORDED", "Task is already recorded and confirmed.")

    # Reuse an open slot so a retry does not orphan the previous one.
    for existing in query_all(config.CLIPS, [("task_id", "==", task_id)]):
        if existing.get("status") in ("initiated", "uploaded"):
            return jsonify({
                "clip_id": existing["clip_id"],
                "filename": existing.get("filename", ""),
                "upload_url": f"/api/clips/upload?clip_id={existing['clip_id']}",
            }), 201

    scenario = get_doc(config.SCENARIOS, task.get("scenario_id"))
    if not scenario:
        raise ApiError(404, "SCENARIO_NOT_FOUND", "Associated scenario not found.")

    clip_id = str(uuid.uuid4())
    filename = generate_canonical_filename(
        domain=task["domain"],
        speaker_id=g.speaker["speaker_id"],
        intent=task["intent"],
        scenario_set=scenario.get("scenario_set", "v1"),
        scenario_no=task.get("scenario_no", 1),
        example_no=task.get("example_no", 1),
        clip_id=clip_id,
        speaker_name=g.speaker.get("name") or "",
    )

    db().collection(config.CLIPS).document(clip_id).set({
        "clip_id": clip_id,
        "task_id": task_id,
        "speaker_id": g.speaker["speaker_id"],
        "uid": g.speaker["uid"],
        "device_id": request.headers.get("X-Device-ID"),
        "domain": task["domain"],
        "intent": task["intent"],
        "scenario_id": task.get("scenario_id"),
        "filename": filename,
        "raw_path": raw_object_path(clip_id, mime_type),
        "wav_path": None,
        "mime_type": mime_type,
        "status": "initiated",
        "qc_flags": [],
        "duration_s": None,
        "transcript_provisional": None,
        "transcript_final": None,
        "transcript_source": None,
        "prompted": False,
        "created_at": _now(),
    })

    return jsonify({
        "clip_id": clip_id,
        "filename": filename,
        "upload_url": f"/api/clips/upload?clip_id={clip_id}",
    }), 201


@bp.post("/clips/upload")
@consented_speaker_required
def clip_upload():
    """
    Receives the audio and writes it to Cloud Storage.

    Audio flows through the function rather than a client-side Storage write so
    the object path stays server-chosen and ownership is checked before
    anything lands in the bucket.
    """
    clip_id = request.args.get("clip_id")
    clip = get_doc(config.CLIPS, clip_id)
    if not clip:
        raise ApiError(404, "CLIP_NOT_FOUND", "Clip slot not found.")
    if clip["speaker_id"] != g.speaker["speaker_id"]:
        raise ApiError(403, "FORBIDDEN", "Not authorized to upload to this clip.")
    # Audio is immutable once kept, so a replayed request cannot swap out a
    # clip that already passed review.
    if clip.get("status") in ("confirmed", "processing", "processed", "rejected"):
        raise ApiError(409, "CLIP_LOCKED", f"Clip is already {clip['status']}.")

    file = request.files.get("file")
    if file is None:
        raise ApiError(400, "NO_FILE", "No audio file was provided.")

    content_type = (file.content_type or "").lower()
    if content_type.startswith(config.BLOCKED_UPLOAD_MIME_PREFIXES):
        raise ApiError(415, "UNSUPPORTED_MEDIA_TYPE", "Only audio recordings are accepted.")

    data = file.read()
    if not data:
        raise ApiError(400, "EMPTY_UPLOAD", "Uploaded audio was empty.")
    if len(data) > config.MAX_UPLOAD_SIZE_BYTES:
        raise ApiError(
            413, "FILE_TOO_LARGE",
            f"Audio exceeds the {config.MAX_UPLOAD_SIZE_MB}MB limit.",
        )

    upload_bytes(clip["raw_path"], data, clip.get("mime_type") or "audio/webm")
    db().collection(config.CLIPS).document(clip_id).update({"status": "uploaded"})

    return jsonify({
        "message": "Upload successful",
        "clip_id": clip_id,
        "status": "uploaded",
        "bytes": len(data),
    })


@bp.post("/clips/<clip_id>/confirm")
@consented_speaker_required
def clip_confirm(clip_id):
    """
    Volunteer keeps the take.

    The transition is a transactional compare-and-swap: two taps on Keep must
    not credit scenario.use_count twice, which would skew coverage and the
    version balancing that reads it.
    """
    body = request.get_json(silent=True) or {}
    clip = get_doc(config.CLIPS, clip_id)
    if not clip:
        raise ApiError(404, "CLIP_NOT_FOUND", "Clip not found.")
    if clip["speaker_id"] != g.speaker["speaker_id"]:
        raise ApiError(403, "FORBIDDEN", "Not authorized to confirm this clip.")
    if clip.get("status") in ("confirmed", "processing", "processed"):
        return jsonify({"clip_id": clip_id, "status": clip["status"], "next_task": None})
    if clip.get("status") == "discarded":
        raise ApiError(409, "CLIP_DISCARDED", "Cannot confirm a discarded clip.")
    # Refuse to confirm a clip whose audio never arrived, otherwise a failed
    # upload still marks the task recorded and the data point is lost.
    if clip.get("status") != "uploaded":
        raise ApiError(
            409, "AUDIO_MISSING",
            "Audio for this clip has not been uploaded yet. Please upload before confirming.",
        )

    task = get_doc(config.TASKS, clip["task_id"])
    scenario = get_doc(config.SCENARIOS, task.get("scenario_id")) if task else None

    # Label with the phrasing the volunteer was actually shown.
    provisional = ""
    if scenario and scenario.get("examples"):
        examples = scenario["examples"]
        idx = max(0, min(int(task.get("example_no", 1)) - 1, len(examples) - 1))
        provisional = examples[idx]

    transcript_edit = (body.get("transcript_edit") or "").strip()
    client = db()
    clip_ref = client.collection(config.CLIPS).document(clip_id)

    from firebase_admin import firestore as _fs

    @_fs.transactional
    def _claim(transaction):
        snapshot = clip_ref.get(transaction=transaction)
        current = snapshot.to_dict() or {}
        if current.get("status") != "uploaded":
            return False
        transaction.update(clip_ref, {
            "status": "confirmed",
            "prompted": bool(body.get("prompted", False)),
            "transcript_provisional": provisional,
            "transcript_final": transcript_edit or provisional,
            "transcript_source": "speaker_edited" if transcript_edit else "example_unedited",
            "confirmed_at": _now(),
        })
        return True

    if not _claim(client.transaction()):
        # Another request won the race; report its outcome rather than erroring.
        latest = get_doc(config.CLIPS, clip_id) or {}
        return jsonify({
            "clip_id": clip_id,
            "status": latest.get("status", "confirmed"),
            "next_task": None,
        })

    if task:
        client.collection(config.TASKS).document(task["task_id"]).update({"status": "recorded"})
    if scenario:
        client.collection(config.SCENARIOS).document(scenario["scenario_id"]).update(
            {"use_count": Increment(1)}
        )

    # Hand back the next pending task to save a round-trip.
    next_task = None
    if task:
        remaining = [
            t for t in query_all(config.TASKS, [
                ("speaker_id", "==", g.speaker["speaker_id"]),
                ("domain", "==", task["domain"]),
                ("batch_no", "==", task["batch_no"]),
                ("status", "==", "pending"),
            ])
        ]
        remaining.sort(key=lambda t: (t.get("intent", ""), t.get("scenario_no", 0), t.get("example_no", 0)))
        if remaining:
            next_task = _task_response(remaining[0])

    return jsonify({"clip_id": clip_id, "status": "confirmed", "next_task": next_task})


@bp.post("/clips/<clip_id>/discard")
@consented_speaker_required
def clip_discard(clip_id):
    """Volunteer re-records. The task stays pending and redo_count moves."""
    clip = get_doc(config.CLIPS, clip_id)
    if not clip:
        raise ApiError(404, "CLIP_NOT_FOUND", "Clip not found.")
    if clip["speaker_id"] != g.speaker["speaker_id"]:
        raise ApiError(403, "FORBIDDEN", "Not authorized to discard this clip.")
    if clip.get("status") in ("confirmed", "processing", "processed"):
        raise ApiError(409, "CLIP_CONFIRMED", "Cannot discard an already confirmed clip.")

    task = get_doc(config.TASKS, clip["task_id"])
    client = db()

    if clip.get("status") != "discarded":
        delete_object(clip.get("raw_path"))
        client.collection(config.CLIPS).document(clip_id).update({"status": "discarded"})
        if task:
            client.collection(config.TASKS).document(task["task_id"]).update({
                "status": "pending",
                "redo_count": Increment(1),
            })
            task = get_doc(config.TASKS, task["task_id"])

    return jsonify({
        "clip_id": clip_id,
        "status": "discarded",
        "task": _task_response(task) if task else None,
    })


@bp.get("/clips/my")
@consented_speaker_required
def my_clips():
    """Every recording this speaker has made, newest first."""
    clips = query_all(config.CLIPS, [("speaker_id", "==", g.speaker["speaker_id"])])
    clips.sort(key=lambda c: c.get("created_at") or 0, reverse=True)

    items = []
    for c in clips:
        created = c.get("created_at")
        items.append({
            "clip_id": c["clip_id"],
            "task_id": c.get("task_id"),
            "domain": c.get("domain"),
            "intent": c.get("intent"),
            "scenario_id": c.get("scenario_id"),
            "filename": c.get("filename"),
            "duration_s": c.get("duration_s"),
            "transcript_final": c.get("transcript_final") or c.get("transcript_provisional"),
            "status": c.get("status"),
            "created_at": created.isoformat() if hasattr(created, "isoformat") else created,
        })
    return jsonify({"clips": items})


@bp.get("/clips/<clip_id>/download")
@consented_speaker_required
def download_my_clip(clip_id):
    """Streams a clip back to its owner - processed WAV if ready, else raw."""
    clip = get_doc(config.CLIPS, clip_id)
    if not clip:
        raise ApiError(404, "CLIP_NOT_FOUND", "Clip not found.")
    if clip["speaker_id"] != g.speaker["speaker_id"]:
        raise ApiError(403, "FORBIDDEN", "Not authorized to download this clip.")

    path = clip.get("wav_path") or clip.get("raw_path")
    data = download_bytes(path) if path else None
    if data is None:
        raise ApiError(404, "AUDIO_NOT_FOUND", "Audio file not found.")

    is_wav = str(path).endswith(".wav")
    return (
        data, 200,
        {
            "Content-Type": "audio/wav" if is_wav else "audio/webm",
            "Content-Disposition": f'attachment; filename="{clip.get("filename") or clip_id}"',
        },
    )


@bp.delete("/clips/<clip_id>")
@consented_speaker_required
def delete_my_clip(clip_id):
    """
    Refuses speaker-initiated deletion. Admin-only is a corpus requirement.

    This route used to delete the speaker's own recording. It is kept as an
    explicit refusal rather than removed so that the policy is visible at the
    point someone would re-add it, and so an older cached frontend gets a clear
    message instead of a generic 404.

    Once a clip is confirmed it is corpus data: only DELETE
    /api/admin/clips/<clip_id> removes it. Nothing else in this codebase
    deletes a confirmed recording, and nothing deletes one on a timer.

    A volunteer who has not yet kept a take can still redo it via
    /clips/<clip_id>/discard, which only ever touches an unconfirmed clip.
    """
    raise ApiError(
        403,
        "ADMIN_ONLY",
        "Recordings can only be removed by an administrator. "
        "Please contact the study team if you need one deleted.",
    )
