# قائمة الإطلاق — Watesly v0.28

مرجع عملي قبل ربط WhatsApp والنشر. حدّث `[ ]` إلى `[x]` عند الإنجاز.

---

## 1. البنية التحتية

- [ ] خادم إنتاج مع HTTPS (API + Frontend)
- [ ] `docker compose -f compose.prod.yaml up -d` (migrate → api → worker → beat → frontend)
- [ ] Worker يستمع للطوابير: `webhooks,campaigns,automations,default` (مُصلَح في `compose.prod.yaml`)
- [ ] Beat يعمل (مهام مجدولة: outbox، WhatsApp health كل ساعة)
- [ ] PostgreSQL + Redis + MinIO/S3 مع نسخ احتياطي (`scripts/backup_all.ps1`)
- [ ] Reverse proxy (nginx/Caddy) أمام API على `127.0.0.1:8000`
- [ ] Frontend على المنفذ `8080` أو CDN بعد `npm run build` / `frontend/Dockerfile`

---

## 2. متغيرات البيئة (`.env`)

### أمان
- [ ] `APP_ENV=production`
- [ ] `APP_DEBUG=false`
- [ ] تدوير `APP_SECRET_KEY`, `CREDENTIAL_ENCRYPTION_KEY`, `DATA_KEY_ENCRYPTION_KEY`
- [ ] `REFRESH_COOKIE_SECURE=true`
- [ ] `REFRESH_COOKIE_DOMAIN=.your-domain.com` (إن لزم)
- [ ] `CORS_ORIGINS=https://app.your-domain.com`

### تخزين الوسائط
- [ ] `S3_PUBLIC_BASE_URL=https://cdn.your-domain.com/bucket` (HTTPS عام — Meta تحتاجه لإرسال الصور)

### Frontend (وقت البناء)
- [ ] `VITE_API_BASE_URL=https://api.your-domain.com/api/v1`
- [ ] `VITE_WS_BASE_URL=wss://api.your-domain.com/api/v1`

---

## 3. Meta / WhatsApp

### Meta Developer Console
- [ ] App Secret → `META_APP_SECRET`
- [ ] Webhook Verify Token → `META_WEBHOOK_VERIFY_TOKEN`
- [ ] Callback URL: `https://api.your-domain.com/api/v1/whatsapp/webhook`
- [ ] Subscribe: `messages` (+ `message_status` اختياري)
- [ ] System User Token طويل الأمد (موصى به للإنتاج)

### داخل المنصة
- [ ] **ربط WhatsApp** → WABA ID + Phone Number ID + Access Token
- [ ] **تحقق من Token** → ناجح
- [ ] **مزامنة** → حالة ACTIVE + tier
- [ ] مزامنة **قوالب WhatsApp** من Meta
- [ ] (اختياري) Catalog ID للتجارة

### اختبارات حية
- [ ] رسالة واردة → تظهر في Inbox
- [ ] رد نصي → يصل للعميل
- [ ] إرسال صورة/ملف (يتطلب S3_PUBLIC_BASE_URL عام)
- [ ] اقتراح منتج من الكتalog في Inbox
- [ ] حملة تجريبية لرقمك

---

## 4. المحتوى والمنتجات

- [ ] **محتوى الموقع** (Super Admin) — شعار، ألوان، نصوص
- [ ] التحقق من `/` و `/login` — الشعار والنصوص
- [ ] **المنتجات والخدمات** — بيانات حقيقية + أصناف
- [ ] **الردود السريعة** و**قاعدة المعرفة** (إن استخدمت AI)

---

## 5. الأمان والعمليات

- [ ] تقييد أو rate-limit `/auth/register` للإطلاق العام
- [ ] فريق + صلاحيات (RBAC)
- [ ] Health: `GET /api/v1/health/ready`
- [ ] مراقبة logs: `watesly.http`, Celery worker
- [ ] تجربة استعادة من نسخة احتياطية

---

## 6. ما بعد الإطلاق (Beta)

- [ ] Stripe / فوترة (غير مدمج حالياً — trial 14 يوم)
- [ ] API لفصل رقم WhatsApp
- [ ] ترقية Embedded Signup token → long-lived
- [ ] Sentry / مراقبة مركزية

---

## أوامر سريعة

```powershell
# إنتاج (من مجلد backend)
docker compose -f compose.prod.yaml up -d --build

# تحقق
curl https://api.your-domain.com/api/v1/health/ready

# نسخ احتياطي
.\scripts\backup_all.ps1
```

---

**آخر تحديث:** إصلاح Celery queues، Dockerfile بدون `--reload`، frontend Dockerfile + nginx، مزامنة صحة WhatsApp كل ساعة، CI env vars.
