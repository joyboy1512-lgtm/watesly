#!/usr/bin/env bash
# Watesly — production upgrade (main branch + migration + rebuild)
# Run ON THE SERVER: bash /opt/watesly/deploy/upgrade-production.sh
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/watesly}"
COMPOSE="docker compose -f compose.prod.yaml"

echo "=== Watesly production upgrade ==="
cd "$APP_DIR"

echo ">> Pull latest production branch..."
PROD_BRANCH="${PROD_BRANCH:-cursor/production-unified-813f}"
git fetch origin "$PROD_BRANCH"
git checkout "$PROD_BRANCH"
git pull origin "$PROD_BRANCH"

cd "$APP_DIR/backend"

echo ">> Build api, worker, beat, migrate, frontend..."
$COMPOSE build api worker beat migrate frontend

echo ">> Ensure data services..."
$COMPOSE up -d db redis minio

echo ">> Run migrations..."
$COMPOSE run --rm migrate

echo ">> Restart application services..."
$COMPOSE up -d api worker beat frontend

echo ">> Waiting for API health..."
for i in $(seq 1 40); do
  if curl -sf http://127.0.0.1:8000/api/v1/health/ready >/dev/null; then
    echo "API ready."
    break
  fi
  sleep 3
done

echo ">> Migration:"
$COMPOSE exec -T api alembic current

echo ">> Services:"
$COMPOSE ps

echo ""
echo "=== Done ==="
echo "Public: curl -s https://api.watesly.com/api/v1/health/ready"
