# DNS — GoDaddy → DigitalOcean (watesly.com)

## أين تضيف السجلات؟

1. [godaddy.com](https://godaddy.com) → **My Products** → **watesly.com** → **DNS** → **Manage DNS**
2. أضف/عدّل السجلات التالية (IP السيرفر: **64.226.69.159**):

| Type | Name | Value | TTL |
|------|------|-------|-----|
| **A** | `@` | `64.226.69.159` | 600 |
| **A** | `www` | `64.226.69.159` | 600 |
| **A** | `api` | `64.226.69.159` | 600 |
| **A** | `files` | `64.226.69.159` | 600 |

## ملاحظات GoDaddy

- **@** = `watesly.com` (الجذر)
- **www** = `www.watesly.com` (الواجهة الرئيسية)
- احذف أو عطّل سجلات **Parking** القديمة إن وجدت
- انتظر 10–60 دقيقة بعد الحفظ

## التحقق (من جهازك)

```powershell
nslookup www.watesly.com
nslookup api.watesly.com
```

يجب أن يظهر IP السيرفر.

## بعد DNS — عناوين المنصة

| الخدمة | الرابط |
|--------|--------|
| الموقع + لوحة التحكم | https://www.watesly.com |
| API | https://api.watesly.com |
| ملفات/صور | https://files.watesly.com |
| Webhook WhatsApp | https://api.watesly.com/api/v1/whatsapp/webhook |
| Health check | https://api.watesly.com/api/v1/health/ready |

## Caddy على السيرفر

```bash
cp /opt/watesly/deploy/Caddyfile.watesly.com /etc/caddy/Caddyfile
systemctl reload caddy
```

Caddy يُصدر شهادة HTTPS تلقائياً لـ:
`watesly.com`, `www.watesly.com`, `api.watesly.com`, `files.watesly.com`
