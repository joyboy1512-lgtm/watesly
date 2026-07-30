param([Parameter(Mandatory=$true)][string]$BackupDir)
$ErrorActionPreference="Stop"
$pg=Resolve-Path (Join-Path $BackupDir "postgres.dump")
$minio=Resolve-Path (Join-Path $BackupDir "minio-data.tar.gz")
if(!(Test-Path $pg) -or !(Test-Path $minio)){throw "Backup is incomplete"}
$dbContainer=(docker compose ps -q db).Trim(); $minioContainer=(docker compose ps -q minio).Trim()
$dbUser=(docker compose exec -T db printenv POSTGRES_USER).Trim(); $dbName=(docker compose exec -T db printenv POSTGRES_DB).Trim()
docker compose stop api worker beat
docker cp $pg "${dbContainer}:/tmp/mywat-postgres.dump"
docker compose exec -T db pg_restore -U $dbUser -d $dbName --clean --if-exists /tmp/mywat-postgres.dump
docker compose exec -T db rm -f /tmp/mywat-postgres.dump
docker cp $minio "${minioContainer}:/tmp/mywat-minio.tar.gz"
docker compose exec -T minio sh -c "rm -rf /data/* && tar -C /data -xzf /tmp/mywat-minio.tar.gz && rm -f /tmp/mywat-minio.tar.gz"
docker compose start api worker beat
Write-Host "Restore completed. Run smoke tests before reopening service."
