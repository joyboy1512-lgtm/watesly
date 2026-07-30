# MyWat v0.24 Production Core

This release implements internal production-readiness controls that do not require third-party accounts.

## Implemented
- Fine-grained permission catalogue and role mapping.
- Login lockout controls and session-revocation service.
- Account lifecycle states.
- Upload filename and magic-signature validation.
- Campaign approval/pause/cancellation database controls.
- Automation execution budgets and cancellation fields.
- Operational queue summary endpoint.
- PostgreSQL backup/restore scripts.
- Staging compose override and Locust smoke profile.
- Migration 0017 and additional unit tests.

## Still requires environment validation
- Full Docker migration test against PostgreSQL.
- Backup restore drill with representative data.
- End-to-end browser flows.
- Load testing against staging-sized infrastructure.
- TLS, domain, external monitoring, email and Meta/payment credentials.
