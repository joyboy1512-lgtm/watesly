# MyWat v0.21.3 — Clean start on Windows

هذه النسخة تستخدم معرفات Alembic قصيرة (`0001` إلى `0014`) حتى لا تتجاوز حد `version_num` الافتراضي البالغ 32 حرفًا.

## تشغيل نظيف

افتح Terminal داخل مجلد `backend` ثم نفّذ بالترتيب:

```powershell
Copy-Item .env.example .env
docker compose down -v --remove-orphans
docker compose build
docker compose up -d
docker compose exec api alembic upgrade head
```

بعد نجاح الهجرات:

```powershell
docker compose exec api python -m app.cli.create_super_admin
```

## التحقق

```powershell
docker compose exec api alembic current
docker compose exec api alembic heads
docker compose ps
```

يجب أن يكون رأس Alembic هو `0014`.

مهم: لا تنقل ملف `.env` أو قاعدة بيانات Docker من نسخة قديمة. استخدم `docker compose down -v` قبل أول تشغيل لهذه النسخة.
