"""
Grants or revokes the admin custom claim on a Firebase user.

This replaces the shared ADMIN_USERNAME / ADMIN_PASSWORD from the FastAPI
build. Admin is now a property of a named account, so it can be granted per
person, revoked instantly, and every admin action traces to a real uid.

Bootstrapping the first admin has to happen here, with service-account
credentials - an API endpoint that could mint the first admin would be an
open door.

    export GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccountKey.json

    python functions/scripts/set_admin.py --email you@example.com
    python functions/scripts/set_admin.py --email them@example.com --revoke
    python functions/scripts/set_admin.py --list
"""

import argparse
import os
import sys

import firebase_admin
from firebase_admin import auth, credentials


def init(project=None, cred_path=None):
    cred_path = cred_path or os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
    opts = {"projectId": project} if project else None
    if cred_path:
        firebase_admin.initialize_app(credentials.Certificate(cred_path), opts)
    else:
        firebase_admin.initialize_app(options=opts)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--email", help="User to grant or revoke admin on")
    parser.add_argument("--revoke", action="store_true", help="Remove admin instead of granting")
    parser.add_argument("--list", action="store_true", help="List current admins")
    parser.add_argument("--project", help="Firebase project id")
    parser.add_argument("--credentials", help="Path to serviceAccountKey.json")
    args = parser.parse_args()

    init(args.project, args.credentials)

    if args.list:
        print("Current admins:")
        found = 0
        page = auth.list_users()
        while page:
            for user in page.users:
                if (user.custom_claims or {}).get("admin"):
                    print(f"  {user.email or '(no email)'}   uid={user.uid}")
                    found += 1
            page = page.get_next_page()
        if not found:
            print("  (none yet - grant one with --email)")
        return 0

    if not args.email:
        parser.error("--email is required unless --list is used")

    try:
        user = auth.get_user_by_email(args.email)
    except auth.UserNotFoundError:
        print(f"No Firebase user with email {args.email}.")
        print("The person must sign up in the app first, then re-run this.")
        return 1

    claims = dict(user.custom_claims or {})
    if args.revoke:
        claims.pop("admin", None)
        auth.set_custom_user_claims(user.uid, claims or None)
        action = "revoked from"
    else:
        claims["admin"] = True
        auth.set_custom_user_claims(user.uid, claims)
        action = "granted to"

    # Existing ID tokens carry the old claims until they expire (up to an
    # hour). Revoking refresh tokens forces a fresh one immediately.
    auth.revoke_refresh_tokens(user.uid)

    print(f"Admin {action} {args.email} (uid={user.uid}).")
    print("They must sign out and back in for the change to take effect.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
