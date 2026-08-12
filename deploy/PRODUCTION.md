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

## Email (SMTP) — team invitations

Watesly sends email when you **invite an employee** from **الموظفون**. Owner self-registration does not send email.

Production uses GoDaddy mailbox **`info@watesly.com`**. Settings live in `/opt/watesly/backend/.env` (never commit passwords to git).

```env
APP_PUBLIC_URL=https://www.watesly.com
SMTP_HOST=smtpout.secureserver.net
SMTP_PORT=587
SMTP_USERNAME=info@watesly.com
SMTP_FROM_EMAIL=info@watesly.com
SMTP_FROM_NAME=Watesly
SMTP_USE_TLS=true
SMTP_USE_SSL=false
```

If the GoDaddy plan is **Microsoft 365 via GoDaddy**, use `SMTP_HOST=smtp.office365.com` instead.

**DigitalOcean note:** Outbound SMTP ports **587/465** are often blocked on new droplets. If sends fail with timeout, open a DigitalOcean support ticket to enable SMTP for transactional mail, or use a relay on port **2525** (Brevo/Mailgun/SendGrid) with DNS verification for `watesly.com`.

Test from the server:

```bash
cd /opt/watesly/backend
docker compose -f compose.prod.yaml exec api python3 -c "from app.services.email import is_smtp_configured; print(is_smtp_configured())"
```


Migration chain ends at **`0055_contact_reachability`**. Recent migrations include branch admin enum fix (0054), catalog orders (0053), and contact reachability scoring (0055).
