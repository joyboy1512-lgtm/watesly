# MyWat v0.23.1 — Reliability Completion

Implemented:
- Transactional outbox hooks for webhooks, campaigns, automation creation/publish/run.
- Outbox stale-lock recovery, worker ownership, max attempts and dead-letter state.
- Command Bus idempotency integration with race-safe reservation.
- Soft-delete filtering for contacts, conversations and channels.
- Liveness, readiness and startup probes.
- Refresh token moved to HttpOnly cookie; access token kept only in browser memory.
- Separate production Compose without source mounts or public database/Redis/MinIO ports.
- Development secret generator and removal of reusable encryption keys from `.env.example`.
- Backend and frontend tests for the new foundations.

Still external / deployment-dependent:
- Real Meta credentials and webhook public URL.
- TLS/reverse proxy configuration.
- Production secret manager and monitoring provider.
- Pinning MinIO to an organization-approved release after deployment validation.
