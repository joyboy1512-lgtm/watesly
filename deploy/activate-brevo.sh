#!/usr/bin/env bash
# Activate Brevo transactional email on production (team invitations).
# Usage: ./deploy/activate-brevo.sh xkeysib-YOUR_KEY_HERE
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <BREVO_API_KEY>"
  echo "Create the key at https://app.brevo.com/settings/keys/api"
  exit 1
fi

KEY="$1"
if [[ ! "$KEY" =~ ^xkeysib- ]]; then
  echo "Expected key to start with xkeysib-"
  exit 1
fi

ROOT="${WATESLY_ROOT:-/opt/watesly}"
ENV_FILE="$ROOT/backend/.env"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE"
  exit 1
fi

if grep -q '^BREVO_API_KEY=' "$ENV_FILE"; then
  sed -i "s|^BREVO_API_KEY=.*|BREVO_API_KEY=$KEY|" "$ENV_FILE"
else
  printf '\nBREVO_API_KEY=%s\n' "$KEY" >> "$ENV_FILE"
fi

grep -q '^SMTP_FROM_EMAIL=' "$ENV_FILE" || echo 'SMTP_FROM_EMAIL=info@watesly.com' >> "$ENV_FILE"
grep -q '^SMTP_FROM_NAME=' "$ENV_FILE" || echo 'SMTP_FROM_NAME=Watesly' >> "$ENV_FILE"
grep -q '^APP_PUBLIC_URL=' "$ENV_FILE" || echo 'APP_PUBLIC_URL=https://www.watesly.com' >> "$ENV_FILE"

cd "$ROOT/backend"
docker compose -f compose.prod.yaml up -d api worker
sleep 3
docker compose -f compose.prod.yaml exec -T api python3 -c "
from app.services.email import is_brevo_configured, is_email_configured
print('brevo_configured=', is_brevo_configured())
print('email_configured=', is_email_configured())
"

echo "Done. Test by inviting an employee from الموظفون in Watesly."
