# Production deployment (watesly.com)

## Canonical branch

Deploy from **`cursor/production-unified-813f`** — this branch merges:

- Meta reliability P1 + branch isolation (`cursor/meta-reliability-p1-813f`)
- Inbox chat landing style (`cursor/inbox-chat-landing-style-813f`)
- Template media download fix (`cursor/template-media-download-fix-813f`)
- External site Arabic content + clients section (`cursor/external-site-ar-813f`)
- Catalog Meta wizard, variants, sync status, create UI polish (PRs #61–#68)

**GitHub `main` is kept in sync with this branch** after each production deploy.

### Production snapshot (2026-08-12)

| Item | Value |
|------|-------|
| Commit | `c3cbc46` |
| Alembic | `0055` |
| Server backup | `/opt/watesly/backups/20260812-223130` |
| Snapshot record | `deploy/production-snapshot-20260812.json` |

Previous snapshot: `deploy/production-snapshot-20260811.json` (commit `9813e7b`, Alembic `0052`).

## Server

| Item | Value |
|------|-------|
| Host | `64.226.69.159` |
| App path | `/opt/watesly` |
| Compose | `/opt/watesly/backend/compose.prod.yaml` |
| Site | https://www.watesly.com |
| API | https://api.watesly.com |

## Backup

Run on the server (as root):

```bash
bash /opt/watesly/deploy/backup-server.sh
```

Backups are stored under `/opt/watesly/backups/<timestamp>/` with a `latest` symlink.

Contents: PostgreSQL dump, MinIO data, Redis snapshot, `.env`, Caddyfile, project config tarball, manifest.

## Deploy

From a machine with the deploy SSH key:

```bash
export DEPLOY_SSH_KEY_FILE=~/.ssh/watesly-deploy
bash deploy/push-and-deploy.sh
```

Or on the server directly:

```bash
cd /opt/watesly
git fetch origin cursor/production-unified-813f
git checkout cursor/production-unified-813f
git pull origin cursor/production-unified-813f
bash deploy/upgrade-production.sh
```

## Site content snapshot

Production marketing content (company info, clients, landing copy) is stored in the database table `platform_site_config`.

A JSON snapshot from production (2026-08-09) is kept at:

`backend/data/production_snapshots/platform_site_config_2026-08-09.json`

To restore site content on a fresh database:

```bash
cd backend
python scripts/restore_site_config_snapshot.py \
  data/production_snapshots/platform_site_config_2026-08-09.json
```

## Alembic migrations

Migration chain ends at **`0055_contact_reachability`**. Recent migrations include branch admin enum fix (0054), catalog orders (0053), and contact reachability scoring (0055).
