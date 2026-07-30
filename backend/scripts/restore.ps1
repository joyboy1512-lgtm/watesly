param([Parameter(Mandatory=$true)][string]$BackupFile)
$ErrorActionPreference = "Stop"
if (-not (Test-Path $BackupFile)) { throw "Backup file not found" }
Get-Content -Raw -Encoding Byte $BackupFile | docker compose exec -T db pg_restore -U mywat -d mywat --clean --if-exists
if ($LASTEXITCODE -ne 0) { throw "Database restore failed" }
Write-Host "Restore completed"
