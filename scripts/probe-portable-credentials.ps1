[CmdletBinding()]
param([string]$Root, [switch]$CheckWorkerStartup)
$ErrorActionPreference = 'Stop'
if (!$Root) { $Root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')) }
$tempBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$fixture = Join-Path $tempBase ('polarion-credential-fixture-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixture | Out-Null
$worker = Join-Path $Root 'scripts/start-polarion-worker.ps1'
$configure = Join-Path $Root 'scripts/configure-polarion-credentials.ps1'
$results = @()
$priorModulePath = $env:PSModulePath
try {
  $env:PSModulePath = $null
  $configuredFile = Join-Path $fixture 'configured.json'
  $secretForConfiguration = ConvertTo-SecureString -String ([Guid]::NewGuid().ToString('N')) -AsPlainText -Force
  $created = & $configure -AuthMode password -Username 'isolated-fixture' -Secret $secretForConfiguration -CredentialPath $configuredFile | ConvertFrom-Json
  if (!$created.configured -or $created.path -ne $configuredFile) { throw 'Secure configuration failed' }
  $checked = & $worker -CredentialPath $configuredFile -ValidateOnly | ConvertFrom-Json
  if (!$checked.decryptable) { throw 'Configured credentials did not decrypt' }
  $results += @{case='interactive-config-engine-roundtrip';passed=$true;actualPromptNotTested=$true}
  try { & $configure -AuthMode password -Username 'isolated-fixture' -Secret $secretForConfiguration -CredentialPath $configuredFile | Out-Null; throw 'Existing credentials unexpectedly replaced' }
  catch { if ($_.Exception.Message -notmatch 'already exists') { throw }; $results += @{case='config-refuses-implicit-overwrite';passed=$true} }
  $updated = & $configure -AuthMode access_token -Secret $secretForConfiguration -CredentialPath $configuredFile -Replace | ConvertFrom-Json
  if (!(Test-Path -LiteralPath $updated.backup -PathType Leaf)) { throw 'Encrypted replacement backup missing' }
  $results += @{case='config-explicit-replace-with-encrypted-backup';passed=$true}
  foreach ($version in @(1,2)) {
    # Synthetic random data that is not an account credential. Never print it.
    $synthetic = [Guid]::NewGuid().ToString('N')
    $encrypted = ConvertTo-SecureString -String $synthetic -AsPlainText -Force | ConvertFrom-SecureString
    if ($version -eq 1) { $payload = @{version=1;username='isolated-fixture';password_dpapi=$encrypted}; $expectedMode='password' }
    else { $payload = @{version=2;auth_mode='access_token';secret_dpapi=$encrypted}; $expectedMode='access_token' }
    $file = Join-Path $fixture ('fixture-' + $version + '.json')
    [IO.File]::WriteAllText($file, ($payload | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
    $result = & $worker -CredentialPath $file -ValidateOnly | ConvertFrom-Json
    if (!$result.decryptable -or $result.authMode -ne $expectedMode -or $result.networkUsed) { throw 'Synthetic DPAPI validation failed.' }
    $results += @{case=('DPAPI-v' + $version);passed=$true;networkUsed=$false}
    if ($CheckWorkerStartup) {
      $start = New-Object Diagnostics.ProcessStartInfo
      $start.FileName = Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
      $start.Arguments = '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $worker + '" -CredentialPath "' + $file + '"'
      $start.UseShellExecute=$false; $start.CreateNoWindow=$true
      $start.RedirectStandardInput=$true; $start.RedirectStandardOutput=$true; $start.RedirectStandardError=$true
      $child = [Diagnostics.Process]::Start($start)
      $child.StandardInput.Close()
      $output = $child.StandardOutput.ReadToEndAsync(); $errors = $child.StandardError.ReadToEndAsync()
      if (!$child.WaitForExit(15000)) { $child.Kill(); throw 'Isolated worker startup timeout.' }
      if ($child.ExitCode -ne 0) { throw 'Isolated worker startup failed; subprocess output suppressed.' }
      $results += @{case=('worker-start-v' + $version);passed=$true;businessRequests=0}
      $child.Dispose()
    }
  }
  try { & $worker -CredentialPath (Join-Path $fixture 'missing.json') -ValidateOnly | Out-Null; throw 'Missing credentials unexpectedly accepted' }
  catch { if ($_.Exception.Message -notmatch 'POLARION_CREDENTIAL_FILE_MISSING') { throw }; $results += @{case='missing-file';passed=$true} }
  $bad = Join-Path $fixture 'unsupported.json'
  [IO.File]::WriteAllText($bad, '{"version":999}', (New-Object Text.UTF8Encoding($false)))
  try { & $worker -CredentialPath $bad -ValidateOnly | Out-Null; throw 'Unknown version unexpectedly accepted' }
  catch { if ($_.Exception.Message -notmatch 'POLARION_CREDENTIAL_VERSION_UNSUPPORTED') { throw }; $results += @{case='unknown-version';passed=$true} }
  $results | ConvertTo-Json -Compress
} finally {
  $env:PSModulePath = $priorModulePath
  $synthetic=$null; $encrypted=$null; $payload=$null
  $resolved = [IO.Path]::GetFullPath($fixture)
  if (!$resolved.StartsWith($tempBase, [StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($resolved) -notlike 'polarion-credential-fixture-*') { throw 'Unexpected fixture cleanup path' }
  Remove-Item -LiteralPath $resolved -Recurse -Force
}
