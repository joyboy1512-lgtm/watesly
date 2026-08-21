# Production deployment (watesly.com)

## Canonical branch

Deploy from **`cursor/production-unified-813f`** — this branch merges:

- Meta reliability P1 + branch isolation (`cursor/meta-reliability-p1-813f`)
- Inbox chat landing style (`cursor/inbox-chat-landing-style-813f`)
- Template media download fix (`cursor/template-media-download-fix-813f`)
- External site Arabic content + clients section (`cursor/external-site-ar-813f`)
- Catalog Meta wizard, variants, sync status, create UI polish (PRs #61–#68)
- Contact reachability + campaign role permissions (PRs #80–#81)
- Brevo email transport + Meta live health sync (PRs #82–#83)

**GitHub `main` is kept in sync with this branch** after each production deploy.

### Production snapshot (2026-08-21) — current baseline

| Item | Value |
|------|-------|
| Commit | `df36f12` |
| Alembic | `0057_account_email_notifications` |
| Frontend | `0.32.5` |
| Snapshot record | `deploy/production-snapshot-20260821.json` |

**Includes:** PR #86 email notifications + catalog order PDF emails.

### Production snapshot (2026-08-20) — current baseline

| Item | Value |
|------|-------|
| Commit | `c550ca1` |
| Alembic | `0056_whatsapp_meta_health` |
| Frontend | `0.32.5` |
| Backend | `0.28.0` |
| Live assets | `index-CNNlhcHB.js`, `index-C9piTbv5.css` |
| Snapshot record | `deploy/production-snapshot-20260820.json` |

**Status:** GitHub `main` + `cursor/production-unified-813f` + live site (`watesly.com`) are aligned at **`c550ca1`**. No code drift detected.

### Production snapshot (2026-08-16)

| Item | Value |
|------|-------|
| Commit | `c550ca1` |
| Alembic | `0056_whatsapp_meta_health` |
| Server backup | run before deploy — see `/opt/watesly/backups/latest` |
| Snapshot record | `deploy/production-snapshot-20260816.json` |

Previous snapshot: `deploy/production-snapshot-20260814.json` (commit `04ad119`, Alembic `0056`).

### Production snapshot (2026-08-14)

| Item | Value |
|------|-------|
| Commit | `41c322e` |
| Alembic | `0056_whatsapp_meta_health` |
| Server backup | see `/opt/watesly/backups/latest` after sync |
| Snapshot record | `deploy/production-snapshot-20260814.json` |

Previous snapshot: `deploy/production-snapshot-20260812.json` (commit `c3cbc46`, Alembic `0055`).

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

## Email (SMTP / Brevo) — team invitations

Watesly sends email when you **invite an employee** from **الموظفون**.

### Recommended: Brevo API (works on DigitalOcean — HTTPS, no blocked SMTP ports)

```env
APP_PUBLIC_URL=https://www.watesly.com
BREVO_API_KEY=xkeysib-...
SMTP_FROM_EMAIL=info@watesly.com
SMTP_FROM_NAME=Watesly
```

Create the key at [Brevo → SMTP & API → API Keys](https://app.brevo.com/settings/keys/api). Verify sender `info@watesly.com` under **Senders & Domains**.

**Quick activate on server** (after you have the key):

```bash
ssh root@64.226.69.159
/opt/watesly/deploy/activate-brevo.sh xkeysib-YOUR_KEY
```

### تفعيل Brevo — خطوات يدوية (مرة واحدة)

الكود على السيرفر جاهز، لكن `BREVO_API_KEY` فارغ حالياً. GoDaddy SMTP محجوب من DigitalOcean؛ Brevo API يعمل عبر HTTPS.

1. **فعّل MFA لبريد info@watesly.com** (Microsoft 365 عبر GoDaddy):
   - افتح https://email.secureserver.net
   - سجّل دخول `info@watesly.com`
   - أكمل إعداد Microsoft Authenticator على جوالك (مطلوب مرة واحدة)
2. **ادخل Brevo**: https://login.brevo.com بحساب `admin@watesly.com` (أو أنشئ حساباً جديداً وتحقق من البريد)
3. **أنشئ API Key**: Settings → SMTP & API → API Keys → `Watesly Production`
4. **تحقق من المرسل**: Senders & Domains → `info@watesly.com` (أو domain `watesly.com` + سجلات DNS)
5. **على السيرفر**:
   ```bash
   /opt/watesly/deploy/activate-brevo.sh xkeysib-...
   ```
6. **اختبر**: من لوحة Watesly → **الموظفون** → دعوة موظف

**الحالة الحالية على الإنتاج:** `BREVO_API_KEY` فارغ → `is_brevo_configured()=False` → الدعوات لا تُرسل فعلياً رغم ظهور واجهة الدعوة.

### إشعارات البريد (Inbox + طلبات الكتالوج)

بعد تفعيل Brevo:

1. من Watesly → **المطور** → تبويب **«البريد»**
2. أدخل عناوين الإشعارات (مثل `info@watesly.com`)
3. اختياري: بريد منفصل لطلبات الكتالوج (يُرفق PDF الفاتورة)
4. اضغط **اختبار** للتأكد

**ما يُرسل تلقائياً:**

| الحدث | البريد |
|-------|--------|
| دعوة موظف | من «الموظفون» (موجود مسبقاً) |
| رسالة WhatsApp / SLA / قالب | نسخة إلى `notification_emails` |
| طلب كتالوج جديد | إلى `catalog_order_emails` + **PDF فاتورة** |

Env اختياري على السيرفر:

```env
NOTIFICATION_EMAILS=info@watesly.com
CATALOG_ORDER_EMAILS=orders@watesly.com
```

### Alternative: Brevo SMTP on port 2525

```env
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=2525
SMTP_USERNAME=your-login@smtp-brevo.com
SMTP_PASSWORD=your-smtp-key
SMTP_FROM_EMAIL=info@watesly.com
SMTP_USE_TLS=true
SMTP_USE_SSL=false
```

GoDaddy direct SMTP (`smtpout.secureserver.net:587`) is blocked from DigitalOcean droplets.

Test:

```bash
cd /opt/watesly/backend
docker compose -f compose.prod.yaml exec api python3 -c "from app.services.email import is_email_configured; print(is_email_configured())"
```


Migration chain ends at **`0055_contact_reachability`**. Recent migrations include branch admin enum fix (0054), catalog orders (0053), and contact reachability scoring (0055).
