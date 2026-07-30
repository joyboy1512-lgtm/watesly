# Watesly Backend v0.28

## الجديد
- إرسال صورة عبر رابط عام.
- إرسال فيديو عبر رابط عام.
- إرسال PDF/Document مع filename اختياري.
- إرسال Audio.
- إرسال WhatsApp Template.
- تخزين قوالب WhatsApp وحالتها.
- إنشاء حملات مبنية على قالب Approved.
- إضافة مستلمين ومعاملات القالب لكل مستلم.
- تشغيل الحملة عبر Celery.
- تسجيل نجاح أو فشل كل مستلم.
- حفظ External Message ID للحملة.

## المسارات الجديدة
- `POST /api/v1/whatsapp/accounts/{id}/messages/image`
- `POST /api/v1/whatsapp/accounts/{id}/messages/video`
- `POST /api/v1/whatsapp/accounts/{id}/messages/document`
- `POST /api/v1/whatsapp/accounts/{id}/messages/audio`
- `POST /api/v1/whatsapp/accounts/{id}/messages/template`
- `GET /api/v1/templates`
- `POST /api/v1/templates`
- `GET /api/v1/campaigns`
- `POST /api/v1/campaigns`
- `POST /api/v1/campaigns/{campaign_id}/start`

## ملاحظات مهمة
- روابط الوسائط يجب أن تكون متاحة لـ Meta عبر HTTPS.
- الحملات تستخدم قوالب Approved فقط.
- هذه النسخة تنفذ الإرسال المتتابع داخل Worker. سنضيف لاحقًا rate limiting وbatching وretry محسّن.
- مزامنة القوالب مباشرة من Meta لم تنفذ بعد؛ القوالب تسجل يدويًا في قاعدة البيانات.

## الخطوة التالية
- مزامنة Templates من Meta.
- إدارة حالات الحملة من Webhooks.
- Retry وRate limiting.
- تقارير الحملات.
- البدء في واجهة React.
