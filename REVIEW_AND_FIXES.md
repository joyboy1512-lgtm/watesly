# MyWat v0.21.2 Reviewed

تمت مراجعة النسخة المرفوعة وإصلاح الآتي:

- منع إنشاء PostgreSQL ENUM مرتين في الهجرات 0001 و0002 و0003.
- إضافة `create_type=False` لأنواع ENUM المستخدمة داخل الجداول.
- إضافة `checkfirst=True` عند إنشاء وحذف أنواع ENUM.
- إصلاح تمرير `details=` الخاطئ إلى `append_audit_log` واستبداله بـ `metadata=`.
- الإبقاء على اسم عمود قاعدة البيانات `metadata` مع اسم خاصية Python الآمن `details`.
- رفع إصدار Backend إلى 0.21.2.

## بدء نظيف

```powershell
cd backend
Copy-Item .env.example .env
docker compose down -v
docker compose up -d --build
docker compose exec api alembic upgrade head
```

بعد نجاح الهجرات:

```powershell
docker compose exec api python -m app.cli.create_super_admin
```
