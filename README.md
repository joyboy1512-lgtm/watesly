# Watesly — Production Platform

**Canonical versions (live on watesly.com):** Backend `0.28.0` · Frontend `0.32.5` · Alembic `0058_whatsapp_branding`  
**Single source of truth:** `deploy/VERSION.json`

This repository builds on v0.26 operational hardening and v0.28 platform features.

Main v0.26 hardening highlights:

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
- migration chain through `0058_whatsapp_branding` and version consistency at backend **0.28.0** / frontend **0.32.5** (see `deploy/VERSION.json`).

Read `OPERATIONAL_HARDENING_V026.md` before deployment. Docker/PostgreSQL/Redis integration and load tests must still be run on the target environment before real customers are onboarded.
