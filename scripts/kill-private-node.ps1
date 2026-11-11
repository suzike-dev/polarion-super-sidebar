$ErrorActionPreference = 'Stop'
# Kill every process launched from this project's private node runtime (host / worker / bridge).
$root = Split-Path -Parent $PSScriptRoot
$exe = (Join-Path $root '.runtime\node-v24.22.2-win-x64\node.exe')
$all = Get-CimInstance Win32_Process -Filter "Name='node.exe'"
$killed = 0
foreach ($p in $all) {
  if ($p.ExecutablePath -and ($p.ExecutablePath -ieq $exe)) {
    Write-Output ('KILL ' + $p.ProcessId + ' :: ' + $p.CommandLine)
    Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
    $killed += 1
  }
}
Write-Output ('KILLED=' + $killed)
Start-Sleep -Milliseconds 900
$left = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.ExecutablePath -and ($_.ExecutablePath -ieq $exe) })
Write-Output ('REMAIN=' + $left.Count)
