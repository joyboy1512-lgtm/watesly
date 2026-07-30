#!/usr/bin/env bash
# Watesly — first deploy on Ubuntu (DigitalOcean)
# Default domain: watesly.com (www.watesly.com = app)
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/watesly}"
DOMAIN="${DOMAIN:-watesly.com}"
USE_WATESLY_PRESET="${USE_WATESLY_PRESET:-1}"

echo "=== Watesly deploy: $DOMAIN ==="

if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi

apt-get update -qq
apt-get install -y docker-compose-plugin git ufw curl

ufw allow OpenSSH || true
ufw allow 80/tcp || true
ufw allow 443/tcp || true
ufw --force enable || true

cd "$APP_DIR/backend"

if [[ ! -f .env ]]; then
  if [[ "$USE_WATESLY_PRESET" == "1" && -f ../deploy/.env.watesly.com.example ]]; then
    cp ../deploy/.env.watesly.com.example .env
  else
    cp ../deploy/.env.production.example .env
    sed -i "s/YOUR_DOMAIN/$DOMAIN/g" .env
  fi
  echo ""
  echo "Created backend/.env — EDIT IT NOW (passwords, Meta secrets):"
  echo "  nano $APP_DIR/backend/.env"
  echo ""
  echo "Generate keys:"
  echo "  python3 -c \"import secrets,base64; print('APP_SECRET_KEY='+secrets.token_urlsafe(48)); print('CREDENTIAL_ENCRYPTION_KEY='+base64.urlsafe_b64encode(secrets.token_bytes(32)).decode()); print('DATA_KEY_ENCRYPTION_KEY='+base64.urlsafe_b64encode(secrets.token_bytes(32)).decode()); print('META_WEBHOOK_VERIFY_TOKEN='+secrets.token_urlsafe(24))\""
  exit 1
fi

docker compose -f compose.prod.yaml up -d --build

echo "Waiting for API..."
for i in $(seq 1 30); do
  if curl -sf http://127.0.0.1:8000/api/v1/health/ready >/dev/null; then
    echo "API ready."
    break
  fi
  sleep 3
done

if ! command -v caddy >/dev/null 2>&1; then
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq && apt-get install -y caddy
fi

if [[ -f "$APP_DIR/deploy/Caddyfile.watesly.com" && "$DOMAIN" == "watesly.com" ]]; then
  cp "$APP_DIR/deploy/Caddyfile.watesly.com" /etc/caddy/Caddyfile
else
  sed "s/YOUR_DOMAIN/$DOMAIN/g" "$APP_DIR/deploy/Caddyfile.example" > /etc/caddy/Caddyfile
fi
systemctl reload caddy

echo ""
echo "=== Done ==="
echo "App:   https://www.watesly.com"
echo "API:   https://api.watesly.com/api/v1/health/ready"
echo "Files: https://files.watesly.com"
echo ""
echo "Create admin:"
echo "  cd $APP_DIR/backend && docker compose -f compose.prod.yaml exec api python -m app.cli.bootstrap_dev_admin --email admin@watesly.com --password 'YOUR_PASSWORD' --name Admin"
echo ""
echo "Meta webhook: https://api.watesly.com/api/v1/whatsapp/webhook"
