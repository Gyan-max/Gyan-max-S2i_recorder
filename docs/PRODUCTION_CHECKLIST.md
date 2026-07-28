# Production data-safety checklist

This service treats a recording as complete only after the API has atomically
stored the audio, committed the clip and task updates, and acknowledged the
request. Local browser storage is a retry buffer, not the system of record.

## 1. Preserve current data first

Do not copy or overwrite either existing SQLite file. The historical project
has used both `api/s2i_recorder.db` and `data/s2i_recorder.db`; they contain
different speakers and clips. Back up each database using SQLite's backup API
(not a raw copy while WAL is active), and archive `api/storage` and `storage`.

```bash
sqlite3 data/s2i_recorder.db ".backup '/secure-backups/s2i-data-YYYYMMDD.db'"
sqlite3 api/s2i_recorder.db ".backup '/secure-backups/s2i-api-YYYYMMDD.db'"
tar -C api -czf /secure-backups/s2i-audio-YYYYMMDD.tgz storage
```

Choose one source of truth before importing historical records. A merge must
remap colliding speaker IDs and verify each clip's referenced audio file; do
not merge with SQL copy/paste.

## 2. Required production configuration

Set these variables in the deployed API service, not only in a local `.env`:

```text
APP_ENV=production
JWT_SECRET_KEY=<at-least-32-random-bytes>
ADMIN_USERNAME=<non-default-admin-name>
ADMIN_PASSWORD=<strong-unique-password>
CORS_ORIGINS=https://your-frontend.example
DATABASE_URL=postgresql+asyncpg://USER:PASSWORD@HOST:5432/s2i_recorder
STORAGE_BASE_PATH=/data/storage
MAX_UPLOAD_SIZE_MB=25
```

Use PostgreSQL for the production metadata database. SQLite is acceptable only
for local development or one API process on one mounted disk. Keep the API at
one instance until the PostgreSQL migration is complete.

`STORAGE_BASE_PATH` must be on a persistent mounted disk. For a larger corpus,
move audio to S3/R2 and keep object keys, checksums, and byte sizes in the
database. Do not rely on a container filesystem.

## 3. Deploy and verify

1. Configure the Render disk at `/data`; the supplied `render.yaml` puts the
   SQLite fallback and `/data/storage` on that disk. If the service was created
   manually, apply these settings in the active service as well.
2. Set the actual Vercel frontend URL in `CORS_ORIGINS` and `VITE_API_URL`.
3. Deploy the API, then call `/api/health`. It must report `database` as
   `connected` and `storage` as `writable`.
4. Record, keep, refresh the volunteer page, then refresh the admin page. The
   same clip and progress must remain visible. Restart the API and verify the
   clip is still listed and the audio plays.
5. Schedule daily PostgreSQL backups and object-storage versioning. Restore a
   backup to a separate environment at least once before collecting real data.

## 4. Operational rules

- Never deploy a database-path change without a migration and backup.
- Alert on unhealthy `/api/health`, `processing_failed` clips, and storage use.
- Browser IndexedDB can be cleared by a user; train operators to wait for the
  “saved to your profile and admin dashboard” acknowledgement before leaving.
- The API retries confirmed processing after a restart. Keep raw audio until
  the processed audio and backup have both been verified.
