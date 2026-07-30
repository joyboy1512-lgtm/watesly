# النشر على DigitalOcean

## من يرفع الملفات؟

| من | ماذا |
|----|------|
| **أنت** | رفع/نسخ المشروع إلى السيرفر (Git أو SCP) |
| **أنت** | DNS، Meta Developer، System User Token |
| **السكربت** | Docker + Caddy + تشغيل الخدمات على السيرفر |
| **الوكيل (Cursor)** | يجهّز ملفات النشر في مجلد `deploy/` — لا يصل لسيرفرك |

---

## الخطوة 1 — DNS (DigitalOcean)

في **Networking → Domains**، أنشئ:

| النوع | الاسم | القيمة |
|-------|-------|--------|
| A | `app` | IP السيرفر |
| A | `api` | IP السيرفر |
| A | `files` | IP السيرفر |

---

## الخطوة 2 — رفع المشروع (اختر طريقة)

### أ) SCP من Windows (بدون GitHub)

```powershell
scp -r D:\MYWATT root@IP_السيرفر:/opt/watesly
```

### ب) GitHub (موصى به)

```powershell
# على جهازك
cd D:\MYWATT
git init
git add .
git commit -m "Production deploy"
git remote add origin https://github.com/YOUR_USER/watesly.git
git push -u origin main
```

```bash
# على السيرفر
ssh root@IP_السيرفر
git clone https://github.com/YOUR_USER/watesly.git /opt/watesly
```

---

## الخطوة 3 — تشغيل السكربت (على السيرفر)

```bash
ssh root@IP_السيرفر
export DOMAIN=yourdomain.com
chmod +x /opt/watesly/deploy/deploy.sh
/opt/watesly/deploy/deploy.sh
```

أول تشغيل ينشئ `.env` — **عدّله**:

```bash
nano /opt/watesly/backend/.env
```

ثم أعد التشغيل:

```bash
export DOMAIN=yourdomain.com
/opt/watesly/deploy/deploy.sh
```

---

## الخطوة 4 — حساب Admin

```bash
cd /opt/watesly/backend
docker compose -f compose.prod.yaml exec api python -m app.cli.bootstrap_dev_admin \
  --email admin@yourdomain.com \
  --password 'StrongPassword123!' \
  --name "Admin"
```

---

## الخطوة 5 — Meta WhatsApp

1. Webhook URL: `https://api.yourdomain.com/api/v1/whatsapp/webhook`
2. Verify Token = `META_WEBHOOK_VERIFY_TOKEN` من `.env`
3. Subscribe: **messages**
4. من المنصة: **ربط WhatsApp** → Token + WABA ID + Phone ID

---

## تحديث لاحق

```bash
cd /opt/watesly
git pull   # أو scp مجدداً
cd backend
docker compose -f compose.prod.yaml up -d --build
```

---

## DNS مطلوب قبل Caddy

تأكد أن `app` / `api` / `files` تشير لـ IP السيرفر قبل تشغيل السكript، وإلا شهادة HTTPS لن تُصدَر.
