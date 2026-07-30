# MyWat v0.22 — Stable Foundation

This release implements the seven improvement tracks on top of the working v0.21.3 codebase.

1. Reliable startup: automatic Alembic migration service, restart policies and API healthcheck.
2. Interface: clearer Inbox loading, error and empty states plus real filters.
3. Inbox: unread and assignment filtering, improved status display and existing media/tags/notes retained.
4. WhatsApp readiness: existing Meta integration retained; webhook payload moved to JSONB and indexes added.
5. Reliability: Transactional Outbox models/worker and Command idempotency foundation.
6. Database: soft delete columns, JSONB conversion and high-value indexes in migration 0015.
7. Security: request IDs and secure response headers; secrets remain excluded from the release.

## Start
```powershell
cd backend
Copy-Item .env.example .env
docker compose up -d --build
```
Migrations now run automatically through the `migrate` service.

## Verify
```powershell
docker compose ps
docker compose logs migrate
docker compose exec api alembic current
```
Expected migration: `0015`.
