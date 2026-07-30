# MyWat v0.26 — Operational Hardening Report

## Corrected risks

1. Duplicate campaign starts are guarded by database row locking and a unique execution token.
2. Campaign recipient rows use `FOR UPDATE SKIP LOCKED` so concurrent workers cannot claim the same recipient.
3. Ambiguous stale sends are not automatically resent; they are marked failed with a reconciliation warning.
4. Campaign tasks stop when superseded, paused or cancelled.
5. Automation no longer reports generic false success. Internal actions execute and unsupported actions fail explicitly.
6. Automation graph corruption is handled inside the run failure boundary.
7. Realtime Redis listeners reconnect with exponential backoff and log failures.
8. Realtime duplicate events are suppressed using event IDs in Redis.
9. Outbox publication preserves the stable database event ID.
10. Refresh rotation uses row locking and token-family reuse detection.
11. Access tokens are tied to an active session and password-change version.
12. Multi-account users select an account explicitly; support switching requires an active grant.
13. Login and refresh endpoints have Redis-backed rate limits.
14. Inbox conversation listing removes the N+1 last-message query pattern and applies a safe limit.
15. Readiness uses a lightweight storage existence check.
16. Uploads stream into a spooled file rather than loading the whole payload into RAM.
17. Uploaded files are private by default and include scan/deletion/retention lifecycle fields.
18. Redis persistence, worker health checks, MinIO health checks, graceful stop and fixed image versions were added.
19. Backup and restore cover both PostgreSQL and MinIO without PowerShell binary-redirection corruption.
20. Version metadata is aligned at `0.26.0`.

## Important operational limits

- A real malware scanner is still an external service. The internal signature checks remain active and the schema is ready for scanner integration.
- Meta does not provide a universal idempotency guarantee for every message request. Ambiguous sends therefore require reconciliation instead of automatic resend.
- Full PostgreSQL/Redis/Docker integration, restore drills and load tests must run on the target staging environment.
- The `send_template` Automation action is deliberately excluded until its parameter mapping is validated. It will not falsely report success.
