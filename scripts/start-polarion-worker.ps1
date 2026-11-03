$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding
$credentialPath = Join-Path $env:LOCALAPPDATA 'PolarionMcp\credentials.json'
$payload = Get-Content -LiteralPath $credentialPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($payload.version -eq 1) { $authMode = 'password'; $encryptedSecret = $payload.password_dpapi }
elseif ($payload.version -eq 2) { $authMode = $payload.auth_mode; $encryptedSecret = $payload.secret_dpapi }
else { throw 'Unsupported credential-store version' }
$pointer = [IntPtr]::Zero
try {
  $secureSecret = ConvertTo-SecureString -String $encryptedSecret
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureSecret)
  $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  $env:POLARION_AUTH_MODE = $authMode
  if ($authMode -eq 'password') { $env:POLARION_USERNAME = $payload.username; $env:POLARION_PASSWORD = $plain }
  elseif ($authMode -eq 'access_token') { $env:POLARION_ACCESS_TOKEN = $plain }
  else { throw 'Unsupported authentication mode' }
  $root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
  & (Join-Path $root '.runtime/node-v24.22.2-win-x64/node.exe') (Join-Path $root 'dist/host/polarion-worker.mjs')
} finally {
  if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
  Remove-Item Env:POLARION_USERNAME,Env:POLARION_PASSWORD,Env:POLARION_ACCESS_TOKEN,Env:POLARION_AUTH_MODE -ErrorAction SilentlyContinue
  $plain = $null; $payload = $null; $encryptedSecret = $null
}
