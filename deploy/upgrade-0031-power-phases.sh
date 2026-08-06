#!/usr/bin/env bash
# Watesly — deploy power phases + migration 0031 on production
# Run ON THE SERVER: bash /opt/watesly/deploy/upgrade-0031-power-phases.sh
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/watesly}"
COMPOSE="docker compose -f compose.prod.yaml"

echo "=== Watesly upgrade: migration 0031 + power phases ==="
cd "$APP_DIR"

echo ">> Pull latest main..."
git fetch origin main
git checkout main
git pull origin main

cd "$APP_DIR/backend"

echo ">> Build api, worker, beat, frontend..."
$COMPOSE build api worker beat frontend

echo ">> Start postgres/redis (if stopped)..."
$COMPOSE up -d postgres redis

echo ">> Run alembic upgrade head (0031)..."
$COMPOSE run --rm api alembic upgrade head

echo ">> Restart services..."
$COMPOSE up -d api worker beat frontend

echo ">> Waiting for API health..."
for i in $(seq 1 40); do
  if curl -sf http://127.0.0.1:8000/api/v1/health/ready >/dev/null; then
    echo "API ready."
    break
  fi
  sleep 3
done

echo ">> Current migration:"
$COMPOSE exec -T api alembic current

echo ">> Service status:"
$COMPOSE ps

echo ""
echo "=== Done ==="
echo "Verify: curl -s https://api.watesly.com/api/v1/health/ready"
echo "App:    https://www.watesly.com"
