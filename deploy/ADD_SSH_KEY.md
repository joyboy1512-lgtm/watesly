# إضافة SSH Key (مرة واحدة)

المفتاح جُنشئ على جهازك:
`C:\Users\DELL PC\.ssh\watesly_do`

## Public Key — أضفه للسيرفر

```
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIIxgsgBONUlPz6EP+Ko4Goq7SSkPkG4eg8GAJBLfodGo watesly-deploy
```

## الطريقة 1 — DigitalOcean Console (الأسهل)

1. DigitalOcean → Droplet → **Access** → **Launch Droplet Console**
2. سجّل دخول `root`
3. الصق هذا الأمر:

```bash
mkdir -p ~/.ssh && echo 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIIxgsgBONUlPz6EP+Ko4Goq7SSkPkG4eg8GAJBLfodGo watesly-deploy' >> ~/.ssh/authorized_keys && chmod 700 ~/.ssh && chmod 600 ~/.ssh/authorized_keys
```

## الطريقة 2 — DigitalOcean Settings

1. **Account** → **Security** → **SSH Keys** → Add
2. الصق Public Key أعلاه
3. أعد إنشاء Droplet أو أضف المفتاح للـ Droplet الحالي

## بعد الإضافة — نشر تلقائي

```powershell
cd D:\MYWATT
powershell -ExecutionPolicy Bypass -File .\deploy\deploy-to-server.ps1
```
