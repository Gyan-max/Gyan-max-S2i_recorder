"""
Flask application served by the `api` Cloud Function.

One function hosts every route rather than one function per endpoint: it keeps
the URL paths identical to the FastAPI build (so the frontend only changes
where it gets its token), and it avoids paying a cold start per endpoint.
"""

import logging

from flask import Flask, jsonify, request

from . import config
from .errors import ApiError
from .routes.admin import bp as admin_bp
from .routes.volunteer import bp as volunteer_bp

logger = logging.getLogger(__name__)


def _apply_cors(response):
    """
    Echoes an allowed origin back.

    Requests authenticate with a bearer ID token rather than cookies, so no
    credentialed wildcard problem arises - but the allowlist stays explicit so
    an unexpected origin cannot quietly start driving the API.
    """
    origin = request.headers.get("Origin")
    if origin and (not config.CORS_ORIGINS or origin in config.CORS_ORIGINS):
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Vary"] = "Origin"
        response.headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type, X-Device-ID"
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, PATCH, DELETE, OPTIONS"
        response.headers["Access-Control-Max-Age"] = "3600"
    return response


def create_app() -> Flask:
    app = Flask(__name__)
    # Reject oversized bodies before they are buffered into memory.
    app.config["MAX_CONTENT_LENGTH"] = config.MAX_UPLOAD_SIZE_BYTES + (1024 * 1024)

    # Hosting rewrites /api/** to this function; keep the prefix so direct
    # function URLs and the hosted path behave identically.
    app.register_blueprint(volunteer_bp, url_prefix="/api")
    app.register_blueprint(admin_bp, url_prefix="/api")

    @app.errorhandler(ApiError)
    def handle_api_error(err: ApiError):
        return jsonify(err.to_response()), err.status

    @app.errorhandler(413)
    def handle_too_large(_):
        return jsonify({"detail": {
            "code": "FILE_TOO_LARGE",
            "message": f"Audio exceeds the {config.MAX_UPLOAD_SIZE_MB}MB limit.",
        }}), 413

    @app.errorhandler(404)
    def handle_not_found(_):
        return jsonify({"detail": {"code": "NOT_FOUND", "message": "Endpoint not found."}}), 404

    @app.errorhandler(Exception)
    def handle_unexpected(err: Exception):
        # Log the detail, return a generic message: stack traces and library
        # errors must never reach a volunteer's browser.
        logger.exception("Unhandled error on %s %s", request.method, request.path)
        return jsonify({"detail": {
            "code": "INTERNAL_ERROR",
            "message": "Something went wrong. Please try again.",
        }}), 500

    @app.before_request
    def short_circuit_preflight():
        if request.method == "OPTIONS":
            return _apply_cors(app.make_default_options_response())
        return None

    @app.after_request
    def finalise(response):
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        return _apply_cors(response)

    return app
