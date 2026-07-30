# Stop old frontend and start fresh on port 5173
$frontendRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$ports = 5173, 5174, 5175
foreach ($port in $ports) {
  $procIds = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique
  foreach ($procId in $procIds) {
    if ($procId -and $procId -gt 0) {
      Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
    }
  }
}
Start-Sleep -Seconds 2
Set-Location $frontendRoot
npm run dev -- --host 0.0.0.0 --port 5173
