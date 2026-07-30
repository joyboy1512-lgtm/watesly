# Watesly — local Windows backend (no Docker)
# Run PowerShell as Administrator for first-time DB setup.

$ErrorActionPreference = "Stop"
$BackendRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$Py = "$env:LocalAppData\Programs\Python\Python312\python.exe"
$PgBin = "C:\Program Files\PostgreSQL\17\bin"
$PgHba = "C:\Program Files\PostgreSQL\17\data\pg_hba.conf"
$PgPort = 5433
$RedisPort = 6380
$MinioData = Join-Path $BackendRoot "data\minio"
$RedisConf = Join-Path $BackendRoot "data\redis.conf"
$MinioRoot = "mywat"
$MinioSecret = "mywat-secret"

function Ensure-PostgresDevAccess {
    if (-not (Test-Path $PgHba)) {
        throw "PostgreSQL not found at $PgHba"
    }
    $content = Get-Content $PgHba -Raw
    if ($content -match "127\.0\.0\.1/32\s+trust") {
        Write-Host "PostgreSQL trust rule already configured."
        return
    }
    Write-Host "Configuring temporary local trust auth for PostgreSQL (dev only)..."
    $backup = "$PgHba.mywat.bak"
    if (-not (Test-Path $backup)) { Copy-Item $PgHba $backup -Force }
    $updated = $content -replace "host\s+all\s+all\s+127\.0\.0\.1/32\s+scram-sha-256", "host    all             all             127.0.0.1/32            trust"
    $updated = $updated -replace "host\s+all\s+all\s+::1/128\s+scram-sha-256", "host    all             all             ::1/128                 trust"
    Set-Content -Path $PgHba -Value $updated -Encoding ascii
    & "$PgBin\pg_ctl.exe" reload -D "C:\Program Files\PostgreSQL\17\data"
}

function Ensure-PostgresDatabase {
    $env:PGPORT = "$PgPort"
    $sql = @"
DO `$`$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'mywat') THEN
    CREATE ROLE mywat LOGIN PASSWORD 'mywat';
  END IF;
END `$`$;
SELECT 'CREATE DATABASE mywat OWNER mywat'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'mywat')\gexec
"@
    & "$PgBin\psql.exe" -U postgres -h 127.0.0.1 -d postgres -v ON_ERROR_STOP=1 -c $sql
}

function Ensure-Redis {
    if (-not (Test-Path $RedisConf)) {
        Copy-Item "C:\Program Files\Redis\redis.windows.conf" $RedisConf -Force
        (Get-Content $RedisConf) -replace '^port 6379', "port $RedisPort" | Set-Content $RedisConf
    }
    $existing = Get-NetTCPConnection -LocalPort $RedisPort -State Listen -ErrorAction SilentlyContinue
    if (-not $existing) {
        Start-Process -FilePath "C:\Program Files\Redis\redis-server.exe" -ArgumentList @($RedisConf) -WindowStyle Minimized
        Start-Sleep -Seconds 2
    }
}

function Start-Minio {
    if (-not (Test-Path $MinioData)) { New-Item -ItemType Directory -Path $MinioData -Force | Out-Null }
    $existing = Get-NetTCPConnection -LocalPort 9000 -State Listen -ErrorAction SilentlyContinue
    if ($existing) {
        Write-Host "MinIO already listening on :9000"
        return
    }
    $minioExe = Join-Path (Split-Path -Parent $BackendRoot) "tools\minio.exe"
    if (-not (Test-Path $minioExe)) { throw "MinIO binary not found at $minioExe" }
    $env:MINIO_ROOT_USER = $MinioRoot
    $env:MINIO_ROOT_PASSWORD = $MinioSecret
    Start-Process -FilePath $minioExe -ArgumentList @("server", $MinioData, "--console-address", ":9001") -WindowStyle Minimized
    Start-Sleep -Seconds 3
}

function Write-LocalEnv {
    $envFile = Join-Path $BackendRoot ".env"
    $example = Join-Path $BackendRoot ".env.example"
    if (-not (Test-Path $envFile)) { Copy-Item $example $envFile }
    $text = Get-Content $envFile -Raw
    $replacements = @{
        "postgresql\+asyncpg://mywat:mywat@db:5432/mywat" = "postgresql+asyncpg://mywat:mywat@127.0.0.1:${PgPort}/mywat"
        "redis://redis:6379/0" = "redis://127.0.0.1:${RedisPort}/0"
        "redis://redis:6379/1" = "redis://127.0.0.1:${RedisPort}/1"
        "redis://redis:6379/2" = "redis://127.0.0.1:${RedisPort}/2"
        "http://minio:9000" = "http://127.0.0.1:9000"
    }
    foreach ($k in $replacements.Keys) { $text = $text.Replace($k, $replacements[$k]) }
    Set-Content -Path $envFile -Value $text -Encoding utf8
}

Write-Host "=== Watesly local backend setup ==="
Ensure-PostgresDevAccess
Ensure-PostgresDatabase
Ensure-Redis
Start-Minio
Write-LocalEnv

Set-Location $BackendRoot
& $Py -m alembic upgrade head
& $Py -m app.cli.bootstrap_dev_admin
Write-Host ""
Write-Host "Starting API on http://localhost:8000 ..."
& $Py -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
