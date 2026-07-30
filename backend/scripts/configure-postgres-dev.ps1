# Dev-only: allow passwordless local connections to finish Watesly setup.
$PgHba = "C:\Program Files\PostgreSQL\17\data\pg_hba.conf"
$PgData = "C:\Program Files\PostgreSQL\17\data"
if (-not (Test-Path $PgHba)) { throw "PostgreSQL pg_hba.conf not found." }
$content = Get-Content $PgHba -Raw
if ($content -match "127\.0\.0\.1/32\s+trust") {
    Write-Host "ALREADY"
    exit 0
}
Copy-Item $PgHba "$PgHba.mywat.bak" -Force
$content = $content -replace "host\s+all\s+all\s+127\.0\.0\.1/32\s+scram-sha-256", "host    all             all             127.0.0.1/32            trust"
$content = $content -replace "host\s+all\s+all\s+::1/128\s+scram-sha-256", "host    all             all             ::1/128                 trust"
Set-Content -Path $PgHba -Value $content -Encoding ascii
& "C:\Program Files\PostgreSQL\17\bin\pg_ctl.exe" reload -D $PgData
Write-Host "OK"
