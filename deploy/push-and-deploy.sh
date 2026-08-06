#!/usr/bin/env bash
# Deploy Watesly to production from CI or a machine with SSH key.
# Usage:
#   export DEPLOY_SSH_PRIVATE_KEY="$(cat ~/.ssh/watesly_do)"
#   bash deploy/push-and-deploy.sh
set -euo pipefail

HOST="${DEPLOY_HOST:-64.226.69.159}"
USER="${DEPLOY_USER:-root}"
APP_DIR="${DEPLOY_APP_DIR:-/opt/watesly}"
KEY_FILE="${DEPLOY_SSH_KEY_FILE:-}"

if [ -n "$KEY_FILE" ] && [ -f "$KEY_FILE" ]; then
  DEPLOY_SSH_PRIVATE_KEY="$(cat "$KEY_FILE")"
fi

if [ -z "${DEPLOY_SSH_PRIVATE_KEY:-}" ]; then
  echo "ERROR: Set DEPLOY_SSH_PRIVATE_KEY or DEPLOY_SSH_KEY_FILE to your SSH private key."
  exit 1
fi

TMP_KEY="$(mktemp)"
trap 'rm -f "$TMP_KEY"' EXIT
printf '%s\n' "$DEPLOY_SSH_PRIVATE_KEY" > "$TMP_KEY"
chmod 600 "$TMP_KEY"

echo ">> Deploying to ${USER}@${HOST}..."
ssh -i "$TMP_KEY" -o StrictHostKeyChecking=no "${USER}@${HOST}" "bash ${APP_DIR}/deploy/upgrade-production.sh"

echo ">> Verifying public API..."
curl -sf "https://api.watesly.com/api/v1/health/ready"
echo ""
echo "Deploy complete."
