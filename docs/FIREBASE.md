# FIREBASE.md — Firebase backend

The Firebase backend replaces the FastAPI + SQLite service. Same REST paths,
same payloads; what changes is where they run and how callers authenticate.

| Concern | FastAPI build | Firebase build |
|---|---|---|
| API | FastAPI on Render | `api` Cloud Function (Flask) |
| Database | SQLite file | Firestore |
| Audio | `storage/` on disk | Cloud Storage bucket |
| Volunteer auth | bearer token in localStorage | Firebase Auth (email/password) |
| Admin auth | shared `ADMIN_PASSWORD` in `.env` | `admin: true` custom claim per user |
| Transcode/QC | in-process background task | Storage-triggered `process_clip` Function |

---

## 1. Why it is shaped this way

**Cloud Functions sit in front of everything, and the client can reach nothing
directly.** `firestore.rules` and `storage.rules` are deny-all.

That is deliberate. This project's core rule (ARCHITECTURE.md §3) is that the
client is never authoritative: the server decides which task a speaker gets,
which scenario version balances coverage, what a clip is named, and when
`scenario.use_count` moves. Security Rules cannot express those invariants —
they can check "is this your document?", not "is this the scenario version that
best balances the corpus right now?". A browser able to write Firestore
directly could award itself tasks, rename clips out of the manifest format, or
inflate coverage counters.

So the Admin SDK inside the Function is the only writer. The rules files exist
to guarantee nothing else becomes one.

**Two real consequences of the auth change:**

- Volunteers get durable identity. Previously a speaker token lived only in
  `localStorage`; clearing the browser orphaned their recordings permanently.
  Profiles are now keyed by Firebase uid, so signing in on any device restores
  the same profile and recordings.
- Admin is per-person and revocable. There is no shared password to leak or
  rotate, and every admin action traces to a real uid.

---

## 2. Prerequisites

- A Firebase project on the **Blaze (pay-as-you-go) plan**. Cloud Functions
  cannot deploy on the free Spark plan — this is a hard gate, not a preference.
- `firebase-tools`: `npm install -g firebase-tools`
- Python 3.13 (matches the `runtime` in `firebase.json`)
- Java 11+ **only** if you want the local emulator (the Firestore emulator
  needs a JVM)

Cost at small scale is dominated by Cloud Storage and Function invocations.
Clips are ~60 KB each; a few thousand recordings sit comfortably inside the
free monthly allowances, with ffmpeg compute the main variable.

---

## 3. First-time setup

The project is already wired up: `.firebaserc` points at **`s2i-hinglish`**,
`web/.env.local` holds the web config, and `functions/.env` sets
`STORAGE_BUCKET=s2i-hinglish.firebasestorage.app`.

> **Bucket naming.** This project uses the newer
> `<project>.firebasestorage.app` form. The Admin SDK's implicit default still
> assumes `<project>.appspot.com`, so `STORAGE_BUCKET` is set explicitly in
> `functions/.env`. Leave it set, or every upload targets a bucket that does
> not exist.

```bash
firebase login

# Enable Email/Password auth:
#   Firebase console → Authentication → Sign-in method → Email/Password → Enable

# Deploy rules, indexes and both functions
firebase deploy --only firestore:rules,firestore:indexes,storage,functions
```

### Seed the 198 scenario prompts

Nothing works before this — `/api/session/next` returns `NOT_SEEDED` until
prompts exist.

```bash
# Service account: console → Project settings → Service accounts → Generate key
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccountKey.json

pip install firebase-admin
python functions/scripts/seed_scenarios.py --project YOUR_PROJECT_ID
```

Idempotent: `scenario_id` is the document id, so re-running updates prompt text
without duplicating rows. `use_count` is preserved on re-run — it is live
coverage data, not seed data.

### Create the first admin

Admin cannot bootstrap itself through the API (that would be an open door).

```bash
# 1. The person signs up in the app normally, with their email.
# 2. Then, with service-account credentials:
python functions/scripts/set_admin.py --email you@example.com

python functions/scripts/set_admin.py --list                      # who has it
python functions/scripts/set_admin.py --email x@y.com --revoke    # take it away
```

They must sign out and back in — the claim is baked into the ID token, and the
script revokes refresh tokens to force a fresh one.

Once one admin exists, they can promote others via `POST /api/admin/grant`.

---

## 4. Frontend configuration

Firebase web config is **not secret** — it identifies the project, it does not
authorise anything. The deny-all rules and the Function's token check are what
protect data.

```bash
# web/.env.local, or your host's environment variables
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project
VITE_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
```

`VITE_API_URL` is **not needed on Firebase Hosting**: `firebase.json` rewrites
`/api/**` to the `api` function, so the browser stays same-origin and there is
no CORS to configure. Set it only if you host the frontend elsewhere (Vercel),
pointing at the function origin — and then also set `CORS_ORIGINS` on the
function:

```bash
firebase functions:config:set   # or set CORS_ORIGINS in the console
```

Deploy the frontend:

```bash
cd web && npm run build && cd ..
firebase deploy --only hosting
```

---

## 5. Data model

Seven Firestore collections, mirroring the old tables:

| Collection | Key | Notes |
|---|---|---|
| `speakers` | Firebase uid | This is what makes recordings portable across devices |
| `devices` | client-generated device id | |
| `device_speakers` | `{device}_{uid}` | Roster for shared devices |
| `scenarios` | `scenario_id` | 198 docs; holds live `use_count` |
| `tasks` | uuid | `scenario_set` is denormalised — Firestore has no joins |
| `clips` | uuid | `raw_path` / `wav_path` point into the bucket |
| `withdrawal_audits` | auto | Anonymous record left after erasure |
| `counters/speakers` | — | Transactional `SPK_00NN` allocation |

Two things worth knowing:

- **`scenario_set` is copied onto each task.** The SQL version joined tasks to
  scenarios to count a speaker's usage per version. Firestore cannot, so the
  value is denormalised to keep version balancing a single query.
- **Sequential speaker labels need a transaction.** Firestore ids are opaque,
  but the corpus filename format and every existing export expect readable
  `SPK_0042` labels, so `counters/speakers` is incremented transactionally.

---

## 6. The audio pipeline

`process_clip` fires on any object finalised under `raw/`.

1. Skips anything that is not a `confirmed` clip — an upload the volunteer
   never kept must not be processed.
2. Downloads the raw audio, transcodes to 16 kHz mono WAV with silence
   trimmed but ~150 ms padding retained at each end.
3. Runs QC (`too_short`, `too_long`, `clipped`, `silent`, `noisy`).
4. Writes the WAV to `processed/` and records flags and duration.

**ffmpeg ships with the function** via `imageio-ffmpeg`. The Python runtime has
no system ffmpeg and no apt layer to add one.

**A missing or hung ffmpeg never rejects a clip.** That distinction is carried
over deliberately: an infrastructure fault is not evidence the volunteer's
audio was bad, so the clip returns to `confirmed` and waits for a retry.
Rejecting there would silently destroy good corpus data — the exact bug fixed
in the FastAPI build.

---

## 7. Local development

```bash
firebase emulators:start        # needs Java for the Firestore emulator
```

Emulators come up on: Auth 9099, Functions 5001, Firestore 8080, Storage 9199,
Hosting 5000, UI 4000.

Logic tests need no emulator, credentials, or network:

```bash
python -m pytest functions/tests -q
```

They cover the rules that must not drift during the port: canonical filenames,
the stable per-speaker shuffle, scenario version balancing, and storage-path
containment.

---

## 8. Operational notes

- **Region.** `main.py` pins `us-central1`. Keep the Storage bucket in the same
  region or every clip pays a cross-region hop.
- **Cold starts.** `process_clip` loads ffmpeg, numpy and soundfile; first
  invocation after idle is slow. It runs asynchronously, so no volunteer waits
  on it.
- **`max_instances=20` on `api`.** Exports stream whole files into memory;
  unbounded concurrency would exhaust it.
- **Retention.** Nothing expires or prunes recordings. They persist until a
  speaker deletes their own, an admin deletes one, or the speaker withdraws.
- **Withdrawal** deletes every clip and task, clears demographics, disables the
  Auth user and revokes their tokens, leaving only an anonymous audit row.

---

## 9. Frontend auth surface

Every request now goes through `src/api.ts`, which is the only place a
credential is attached:

| Helper | Use |
|---|---|
| `apiFetch(path, opts)` | JSON calls; throws `ApiError` with `code`/`message` |
| `authFetch(path, init)` | Returns the raw `Response` for callers that branch on `res.status` themselves (the admin panel) |
| `fetchAudioObjectUrl(path)` | Audio blobs behind an authenticated endpoint |

A grep for `Bearer ` across `web/src` returns exactly one line — inside
`api.ts`. Tokens are fetched per request rather than cached, so the SDK
refreshes them silently during a long recording session.

Three screens disappeared because Firebase Auth makes them meaningless:

- **`AdminLogin`** — admin is a claim on a normal account, so the shared
  `SignInPage` covers it.
- **"Are you ready to continue?"** — the account *is* the identity; there is
  nothing to confirm.
- **Device speaker roster / "switch profile"** — signing out and back in is how
  you change who you are. Removing it also removes the duplicate-profile bug
  that switcher used to cause.

Queued offline uploads no longer store a bearer token. One captured before
going offline would very likely have expired by the time the queue drains, so
`authFetch` attaches a fresh ID token at replay instead.

## 10. Analytics — deliberately not enabled

The web config Firebase generates includes a `measurementId` and a
`getAnalytics(app)` call. It is commented out in `web/.env.local` and not
wired into `firebase.ts`, on purpose.

Google Analytics collects device, approximate-location and behavioural data
and shares it with a third party. This app's consent text tells volunteers:

> "I agree to contribute my anonymous voice recordings for researchers
> training speech recognition models. I understand no personal names or
> contact information is associated with my voice clips."

Adding third-party tracking on top of that is a decision for whoever owns the
study's ethics approval, not a default. If you do want it:

1. Uncomment `VITE_FIREBASE_MEASUREMENT_ID` in `web/.env.local`.
2. Add `measurementId` to `firebaseConfig` and call `getAnalytics(app)` in
   `web/src/firebase.ts`.
3. Update the consent text so participants are actually told.

Analytics is not required for anything the app does.

## 11. Still to do

- **ASR** is unimplemented (the FastAPI build only ever had a mock provider).
- **Not verified against a live project.** All 12 logic tests pass, every
  Python module compiles and the frontend builds clean — but no deploy has
  run. There is no Firebase project or credentials in this environment, and
  the Firestore emulator needs Java. Treat the first `firebase deploy` as the
  real integration test.
- **The FastAPI backend under `api/` is still present and still passing its 32
  tests.** It is not wired to anything now that the frontend targets Firebase;
  keep it until the Firebase deploy is confirmed working, then delete it.
