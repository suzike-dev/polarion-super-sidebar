[CmdletBinding()]
param([ValidateSet('inspect','write','extend','unicode')][string]$Mode = 'inspect', [ValidatePattern('^[a-f0-9]{8}$')][string]$ResumeNonce)
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding
# Reuse the current user's existing DPAPI credential store in memory only.
# No global MCP, credential store, or user configuration is changed.
$credentialPath = Join-Path $env:LOCALAPPDATA 'PolarionMcp\credentials.json'
$payload = Get-Content -LiteralPath $credentialPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($payload.version -eq 1) { $authMode = 'password'; $encryptedSecret = $payload.password_dpapi }
elseif ($payload.version -eq 2) { $authMode = $payload.auth_mode; $encryptedSecret = $payload.secret_dpapi }
else { throw 'Unsupported credential-store version' }
$secureSecret = ConvertTo-SecureString -String $encryptedSecret
$pointer = [IntPtr]::Zero
try {
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureSecret)
  $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  $env:POLARION_AUTH_MODE = $authMode
  if ($authMode -eq 'password') { $env:POLARION_USERNAME = $payload.username; $env:POLARION_PASSWORD = $plain }
  elseif ($authMode -eq 'access_token') { $env:POLARION_ACCESS_TOKEN = $plain }
  else { throw 'Unsupported authentication mode' }
  $node = Join-Path $PSScriptRoot '..\.runtime\node-v24.22.2-win-x64\node.exe'
  if ($ResumeNonce) { & $node (Join-Path $PSScriptRoot 'probe-document-structure.mjs') $Mode $ResumeNonce }
  else { & $node (Join-Path $PSScriptRoot 'probe-document-structure.mjs') $Mode }
  exit $LASTEXITCODE
} finally {
  if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
  Remove-Item Env:POLARION_USERNAME,Env:POLARION_PASSWORD,Env:POLARION_ACCESS_TOKEN,Env:POLARION_AUTH_MODE -ErrorAction SilentlyContinue
  $plain = $null; $encryptedSecret = $null; $payload = $null
}
