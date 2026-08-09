# Watesly — upload + deploy to DigitalOcean (Windows)
# Usage: .\deploy\deploy-to-server.ps1
param(
    [string]$Server = "64.226.69.159",
    [string]$User = "root",
    [string]$Key = "$env:USERPROFILE\.ssh\watesly_do",
    [string]$RemoteDir = "/opt/watesly"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

if (-not (Test-Path $Key)) {
    Write-Host "SSH key missing. Run: ssh-keygen -t ed25519 -f `"$Key`" -N `"`" -C watesly-deploy"
    exit 1
}

Write-Host "=== 1/4 Generate production .env ==="
python "$Root\deploy\generate_production_env.py"
Copy-Item "$Root\backend\.env.production.generated" "$Root\backend\.env.deploy" -Force

Write-Host "=== 2/4 Test SSH ==="
ssh -i $Key -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20 "${User}@${Server}" "echo SSH OK"
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "SSH failed. Add this public key in DigitalOcean Console (one time):"
    Get-Content "$Key.pub"
    Write-Host ""
    Write-Host "DigitalOcean -> Droplet -> Access -> Launch Console, then paste:"
    Write-Host "mkdir -p ~/.ssh && echo `"$(Get-Content `"$Key.pub`")`" >> ~/.ssh/authorized_keys && chmod 700 ~/.ssh && chmod 600 ~/.ssh/authorized_keys"
    exit 1
}

Write-Host "=== 3/4 Upload project ==="
ssh -i $Key "${User}@${Server}" "mkdir -p $RemoteDir"
$envBackup = "$Root\backend\.env"
$envMoved = $false
if (Test-Path $envBackup) {
    Move-Item $envBackup "$Root\backend\.env.local.bak" -Force
    $envMoved = $true
}
try {
    scp -i $Key -r "$Root\backend" "${User}@${Server}:${RemoteDir}/"
    scp -i $Key -r "$Root\frontend" "${User}@${Server}:${RemoteDir}/"
    scp -i $Key -r "$Root\deploy" "${User}@${Server}:${RemoteDir}/"
    if (Test-Path "$Root\LAUNCH_CHECKLIST.md") {
        scp -i $Key "$Root\LAUNCH_CHECKLIST.md" "${User}@${Server}:${RemoteDir}/"
    }
} finally {
    if ($envMoved -and (Test-Path "$Root\backend\.env.local.bak")) {
        Move-Item "$Root\backend\.env.local.bak" $envBackup -Force
    }
}

Write-Host "=== 4/4 Remote deploy ==="
ssh -i $Key "${User}@${Server}" @"
set -e
# Preserve production secrets — never overwrite live .env on redeploy
if [[ ! -f $RemoteDir/backend/.env ]]; then
  cp $RemoteDir/backend/.env.deploy $RemoteDir/backend/.env 2>/dev/null || cp $RemoteDir/deploy/.env.watesly.com.example $RemoteDir/backend/.env
fi
chmod +x $RemoteDir/deploy/deploy.sh
DOMAIN=watesly.com APP_DIR=$RemoteDir bash $RemoteDir/deploy/deploy.sh
"@

Write-Host ""
Write-Host "=== Finished ==="
Write-Host "App:  https://www.watesly.com"
Write-Host "API:  https://api.watesly.com/api/v1/health/ready"
Write-Host ""
Write-Host "Create admin:"
Write-Host "ssh -i `"$Key`" ${User}@${Server} `"cd $RemoteDir/backend && docker compose -f compose.prod.yaml exec api python -m app.cli.bootstrap_dev_admin --email admin@watesly.com --password 'StrongPassword123!' --name Admin`""
