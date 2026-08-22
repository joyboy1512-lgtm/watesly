# Watesly v0.28 — Platform Status

**Version:** Backend `0.28.0` · Frontend `0.32.5` (see `deploy/VERSION.json`)  
**Date:** 2026-08-22

## Summary

Watesly v0.28 implements the full **21-phase roadmap foundation** locally. Phases requiring external providers (Meta, Stripe, LLM APIs, SMS, etc.) are scaffolded with clear deferred-connection notes.

## Phase completion

| Phase | Status | Notes |
|-------|--------|-------|
| 1 Stabilization | ✅ | Docker, PG, Redis, MinIO, auth, tests |
| 2 Contact Management | ✅ | Tags, custom fields, import/export, search, segments |
| 3 Inbox | ✅ | Assign, notes, mentions, star, snooze, archive, read/unread, quick replies |
| 4 Team Management | ✅ | Roles, permissions, departments, teams, presence, workload |
| 5 WhatsApp Campaigns | ✅ | Broadcast, scheduling, audience, analytics; A/B field ready |
| 6 Quick Replies | ✅ | Library page, variables `{{contact.name}}` |
| 7 Meta Templates | ✅ | Manager + sync (Meta credentials deferred) |
| 8 Automation Builder | ✅ | Triggers, conditions, delays, webhooks; send_template fixed |
| 9 AI | ✅ Local | Suggest, summarize, intent, emotion, extract, categorize |
| 10 OmniChannel | 🔌 Scaffold | WhatsApp active; others status API |
| 11 CRM | ✅ | Deals pipeline, activities |
| 12 Analytics | ✅ | Agent performance, SLA, live dashboard |
| 13 Multi-Tenant | ✅ | Accounts, orgs, billing trial, isolated data |
| 14 Notifications | ✅ | In-app; email/push/SMS deferred |
| 15 API | ✅ | REST, API keys, webhooks; GraphQL/OAuth planned |
| 16 Marketplace | ✅ | Catalog seeded; install deferred |
| 17 Security | ✅ | Audit, sessions, RBAC, rate limits, encryption |
| 18 Performance | ✅ | Redis, Celery queues, indexes |
| 19 DevOps | ✅ | Docker Compose + GitHub Actions CI |
| 20 Enterprise | 🔌 Partial | Multi-lang UI stub; billing/invoicing deferred |
| 21 AI Agent | ✅ Local | Inbox AI suggest + `/platform/ai/*` endpoints |

## Quick start

```powershell
cd backend
docker compose up -d --build
docker compose exec api alembic upgrade head
docker compose exec api python -m app.cli.bootstrap_dev_admin

cd ..\frontend
npm ci
npm run dev
```

**Login:** `admin@example.com` / `DevPassword123!`

## New routes (frontend)

- `/contacts` — CRM contacts with segments & import/export
- `/quick-replies` — Shared reply library
- `/crm` — Deals pipeline
- `/analytics` — Performance & SLA
- `/developer` — API keys & webhooks
- `/marketplace` — Integration catalog

## External connections (connect later)

- Meta WhatsApp Business API credentials
- OpenAI / LLM for enhanced AI (set `AI_API_KEY` when added)
- Stripe billing
- Instagram, Messenger, Telegram, Email, SMS, Voice providers
- Marketplace extension installs

## Tests

- Backend: **38 passed**
- Frontend: lint + vitest clean
