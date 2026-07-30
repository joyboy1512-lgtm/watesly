# Watesly v0.26 — Operational Hardening

This release builds on v0.25 and focuses on preventing customer-facing harm and silent system stalls.

Main improvements:

- guarded campaign starts with execution tokens and row locks;
- stale campaign sends move to an explicit unknown/failed state instead of being resent automatically;
- real internal Automation actions and explicit failure for unsupported actions;
- Redis realtime listener reconnects automatically and deduplicates events;
- refresh-token row locking, token-family reuse detection and password-change invalidation;
- explicit account selection and secure support-account switching;
- login/refresh rate limiting;
- one-query Inbox conversation loading instead of N+1 queries;
- streaming private file uploads and file lifecycle fields;
- lightweight readiness checks, pinned MinIO image and persistent Redis;
- PostgreSQL + MinIO backup/restore scripts;
- migration `0018` and version consistency at `0.26.0`.

Read `OPERATIONAL_HARDENING_V026.md` before deployment. Docker/PostgreSQL/Redis integration and load tests must still be run on the target environment before real customers are onboarded.
