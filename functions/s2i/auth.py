"""
Authentication and authorization.

Firebase Auth replaces two separate mechanisms from the FastAPI build:

  * Volunteer bearer tokens stored in localStorage, which were device-bound.
    A volunteer who cleared their browser lost access to their recordings
    permanently. Email/password accounts follow the person across devices.

  * A single shared admin username/password in .env. Admin is now a custom
    claim on a named Firebase user, so it can be granted and revoked per
    person without redeploying, and every admin action traces to a real uid.

Every request carries `Authorization: Bearer <Firebase ID token>`.
"""

import logging
from functools import wraps
from typing import Any, Callable, Dict, Optional

from firebase_admin import auth as fb_auth
from flask import g, request

from . import config
from .db import get_doc, init_app
from .errors import ApiError

logger = logging.getLogger(__name__)

ADMIN_CLAIM = "admin"


def _bearer_token() -> Optional[str]:
    header = request.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        return None
    token = header[7:].strip()
    return token or None


def verify_id_token() -> Dict[str, Any]:
    """Verifies the caller's Firebase ID token, or raises 401."""
    init_app()
    token = _bearer_token()
    if not token:
        raise ApiError(401, "UNAUTHENTICATED", "Sign in to continue.")

    try:
        # check_revoked catches a user disabled or signed out everywhere since
        # the token was minted - relevant when a volunteer withdraws.
        return fb_auth.verify_id_token(token, check_revoked=True)
    except fb_auth.RevokedIdTokenError:
        raise ApiError(401, "TOKEN_REVOKED", "Your session has ended. Please sign in again.")
    except fb_auth.UserDisabledError:
        raise ApiError(403, "ACCOUNT_DISABLED", "This account has been disabled.")
    except Exception:
        # Never echo the library's parse error back to the caller.
        raise ApiError(401, "INVALID_TOKEN", "Your session is not valid. Please sign in again.")


def current_speaker() -> Dict[str, Any]:
    """
    Resolves the signed-in user to their speaker profile.

    The Firebase uid is the speaker document id, so a returning volunteer on a
    brand-new device lands on exactly the same profile and recordings.
    """
    claims = verify_id_token()
    uid = claims["uid"]
    speaker = get_doc(config.SPEAKERS, uid)

    if not speaker:
        raise ApiError(404, "PROFILE_REQUIRED", "Finish setting up your profile first.")
    if speaker.get("withdrawn_at"):
        raise ApiError(403, "WITHDRAWN", "This profile has been withdrawn.")

    speaker["uid"] = uid
    return speaker


def require_consent(speaker: Dict[str, Any]) -> Dict[str, Any]:
    """
    Consent is enforced server-side, never by the UI alone.

    A recording without recorded consent must never reach the corpus, so this
    guards every clip endpoint rather than trusting the client's checkbox.
    """
    if not speaker.get("consent_at"):
        raise ApiError(403, "CONSENT_REQUIRED", "Consent is required before recording.")
    return speaker


# ==================== Decorators ====================

def speaker_required(fn: Callable) -> Callable:
    """Route needs a signed-in volunteer with a profile."""
    @wraps(fn)
    def wrapper(*args, **kwargs):
        g.speaker = current_speaker()
        return fn(*args, **kwargs)
    return wrapper


def consented_speaker_required(fn: Callable) -> Callable:
    """Route needs a signed-in volunteer who has consented."""
    @wraps(fn)
    def wrapper(*args, **kwargs):
        g.speaker = require_consent(current_speaker())
        return fn(*args, **kwargs)
    return wrapper


def admin_required(fn: Callable) -> Callable:
    """
    Route needs the `admin: true` custom claim.

    Grant with scripts/set_admin.py. There is deliberately no password to
    share, rotate, or leak into a .env file.
    """
    @wraps(fn)
    def wrapper(*args, **kwargs):
        claims = verify_id_token()
        if not claims.get(ADMIN_CLAIM):
            raise ApiError(403, "ADMIN_REQUIRED", "Administrator access is required.")
        g.admin = claims
        return fn(*args, **kwargs)
    return wrapper
