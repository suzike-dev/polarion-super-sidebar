[CmdletBinding()]
param([string]$CredentialPath, [switch]$ValidateOnly)
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding
if (!$CredentialPath) { $CredentialPath = $env:POLARION_SIDEBAR_CREDENTIALS }
if (!$CredentialPath) {
  $data = $env:POLARION_SIDEBAR_DATA
  if (!$data) { $data = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Nanju/PolarionSidebar' }
  $privateCredentialPath = Join-Path $data 'credentials.json'
  if (Test-Path -LiteralPath $privateCredentialPath -PathType Leaf) { $CredentialPath = $privateCredentialPath }
  else { $CredentialPath = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'PolarionMcp/credentials.json' }
}
if (![IO.Path]::IsPathRooted($CredentialPath)) { throw 'POLARION_CREDENTIAL_PATH_MUST_BE_ABSOLUTE' }
if (!(Test-Path -LiteralPath $CredentialPath -PathType Leaf)) { throw 'POLARION_CREDENTIAL_FILE_MISSING: run scripts/configure-polarion-credentials.ps1, or set POLARION_SIDEBAR_CREDENTIALS / install -CredentialPath to an existing DPAPI store.' }
$payload = Get-Content -LiteralPath $credentialPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($payload.version -eq 1) { $authMode = 'password'; $encryptedSecret = $payload.password_dpapi }
elseif ($payload.version -eq 2) { $authMode = $payload.auth_mode; $encryptedSecret = $payload.secret_dpapi }
else { throw 'POLARION_CREDENTIAL_VERSION_UNSUPPORTED' }
if ($authMode -notin @('password','access_token')) { throw 'POLARION_AUTH_MODE_UNSUPPORTED' }
if (!$encryptedSecret -or ($authMode -eq 'password' -and !$payload.username)) { throw 'POLARION_CREDENTIAL_FILE_INCOMPLETE' }
$pointer = [IntPtr]::Zero
$names = @('POLARION_USERNAME','POLARION_PASSWORD','POLARION_ACCESS_TOKEN','POLARION_AUTH_MODE')
$prior = @{}
foreach ($name in $names) { $prior[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
try {
  try { $secureSecret = ConvertTo-SecureString -String $encryptedSecret }
  catch { throw 'POLARION_CREDENTIAL_DECRYPT_FAILED: provision credentials for this Windows user on this computer; copying another user or computer DPAPI file does not migrate authentication.' }
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureSecret)
  $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  if (!$plain) { throw 'POLARION_CREDENTIAL_SECRET_EMPTY' }
  if ($ValidateOnly) { Write-Output (@{ configured=$true; decryptable=$true; authMode=$authMode; version=$payload.version; networkUsed=$false } | ConvertTo-Json -Compress); return }
  foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name, $null, 'Process') }
  $env:POLARION_AUTH_MODE = $authMode
  if ($authMode -eq 'password') { $env:POLARION_USERNAME = $payload.username; $env:POLARION_PASSWORD = $plain }
  elseif ($authMode -eq 'access_token') { $env:POLARION_ACCESS_TOKEN = $plain }
  $root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
  $node = Join-Path $root '.runtime/node-v24.22.2-win-x64/node.exe'
  $worker = Join-Path $root 'dist/host/polarion-worker.mjs'
  if (!(Test-Path -LiteralPath $node -PathType Leaf) -or !(Test-Path -LiteralPath $worker -PathType Leaf)) { throw 'POLARION_WORKER_INSTALLATION_INCOMPLETE' }
  & $node $worker
  if ($LASTEXITCODE -ne 0) { throw 'POLARION_WORKER_EXIT_FAILED' }
} finally {
  if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
  foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name, $prior[$name], 'Process') }
  $plain = $null; $payload = $null; $encryptedSecret = $null; $secureSecret = $null
}
