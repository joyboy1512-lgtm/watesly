# MyWat v0.25 — Enforcement & Isolation

This release completes the six critical enforcement tasks identified in the v0.24 review:

1. Business routes use permission dependencies rather than role-only checks.
2. Account lifecycle status is enforced during authentication and write operations.
3. Super administrators require an active, scoped, time-bound support grant to access tenant data.
4. Campaign approval, recipient limits, pause/cancel and partial completion are enforced by API and worker.
5. Automation runs enforce max steps, deadlines and cancellation during execution.
6. Regression tests prevent authorization and execution-safety regressions.

## Validation scope

Unit and static guard tests run locally in this release. The PostgreSQL, Redis and Docker integration suite must still be executed on a machine with Docker. External provider actions inside the automation engine remain adapters and are not claimed as completed provider integrations.
