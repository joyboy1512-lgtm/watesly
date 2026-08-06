# watesly.com — نشر على 64.226.69.159

## 1) GoDaddy DNS

**My Products → watesly.com → DNS → Manage DNS**

| Type | Name | Value | TTL |
|------|------|-------|-----|
| A | `@` | `64.226.69.159` | 600 |
| A | `www` | `64.226.69.159` | 600 |
| A | `api` | `64.226.69.159` | 600 |
| A | `files` | `64.226.69.159` | 600 |

احذف سجلات Parking القديمة إن وجدت. انتظر 10–30 دقيقة.

**تحقق (PowerShell):**
```powershell
nslookup www.watesly.com
nslookup api.watesly.com
```

---

## 2) رفع المشروع (PowerShell على جهازك)

```powershell
scp -r D:\MYWATT root@64.226.69.159:/opt/watesly
```

---

## 3) SSH + تشغيل (تحديث 2026)

```bash
ssh root@64.226.69.159
bash /opt/watesly/deploy/upgrade-production.sh
```

أو من جهازك (PowerShell) بعد `git pull` على السيرفر:

```powershell
$env:DEPLOY_SSH_KEY_FILE = "C:\Users\DELL PC\.ssh\watesly_do"
bash deploy/push-and-deploy.sh
```

**GitHub Actions (نشر تلقائي):** أضف Secret `DEPLOY_SSH_PRIVATE_KEY` (محتوى مفتاح SSH) في repo → Actions → Deploy Production.

---

عدّل `.env` عند أول تشغيل:
```bash
nano /opt/watesly/backend/.env
```

ولّد مفاتيح:
```bash
python3 -c "import secrets,base64; print('APP_SECRET_KEY='+secrets.token_urlsafe(48)); print('CREDENTIAL_ENCRYPTION_KEY='+base64.urlsafe_b64encode(secrets.token_bytes(32)).decode()); print('DATA_KEY_ENCRYPTION_KEY='+base64.urlsafe_b64encode(secrets.token_bytes(32)).decode()); print('META_WEBHOOK_VERIFY_TOKEN='+secrets.token_urlsafe(24))"
```

ثم أعد:
```bash
/opt/watesly/deploy/deploy.sh
```

---

## 4) Admin

```bash
cd /opt/watesly/backend
docker compose -f compose.prod.yaml exec api python -m app.cli.bootstrap_dev_admin \
  --email admin@watesly.com \
  --password 'StrongPassword123!' \
  --name "Admin"
```

---

## 5) الروابط

| | |
|--|--|
| App | https://www.watesly.com |
| Login | https://www.watesly.com/login |
| API health | https://api.watesly.com/api/v1/health/ready |
| Meta webhook | https://api.watesly.com/api/v1/whatsapp/webhook |

---

## 6) Meta Developer

- Callback: `https://api.watesly.com/api/v1/whatsapp/webhook`
- Verify Token = `META_WEBHOOK_VERIFY_TOKEN` من `.env`
- Subscribe: **messages**
