# ADR-0002: Transactional Outbox

**Status:** Accepted

Business writes and outbox records must commit in the same PostgreSQL transaction. Redis/Celery are delivery mechanisms, not the source of truth. Workers claim events with locking, retry failures and retain an audit trail.
