# Watesly v0.21.1 — تشغيل Windows

من داخل مجلد `backend`:

```powershell
Copy-Item .env.example .env

docker compose config
docker compose up --build -d
docker compose exec api alembic upgrade head
docker compose exec api watesly-create-super-admin
docker compose ps
```

ثم افتح:

- API: http://localhost:8000
- API Docs: http://localhost:8000/docs
- MinIO: http://localhost:9001

لتشغيل الواجهة من Terminal آخر:

```powershell
cd ..\frontend
Copy-Item .env.example .env
npm install
npm run dev
```

ثم افتح: http://localhost:5173

> مفاتيح `.env.example` للتطوير المحلي فقط ويجب تغييرها قبل الإنتاج.
