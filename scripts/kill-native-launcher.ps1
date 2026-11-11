$ErrorActionPreference = 'Stop'
# Kill the native messaging launcher processes that lock dist/native/*.exe
$procs = Get-CimInstance Win32_Process -Filter "Name='PolarionSidebarHost.exe'"
if (-not $procs) { Write-Output 'NO_LAUNCHER'; exit 0 }
foreach ($p in $procs) {
  Write-Output ('KILL ' + $p.ProcessId)
  Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Milliseconds 700
$left = @(Get-CimInstance Win32_Process -Filter "Name='PolarionSidebarHost.exe'")
Write-Output ('REMAIN=' + $left.Count)
