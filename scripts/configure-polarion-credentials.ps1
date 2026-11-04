[CmdletBinding()]
param(
  [ValidateSet('password','access_token')][string]$AuthMode = 'password',
  [string]$Username,
  [Security.SecureString]$Secret,
  [string]$CredentialPath,
  [switch]$Replace
)
$ErrorActionPreference = 'Stop'
if (!$CredentialPath) {
  $data = $env:POLARION_SIDEBAR_DATA
  if (!$data) { $data = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Nanju/PolarionSidebar' }
  $CredentialPath = Join-Path $data 'credentials.json'
}
if (![IO.Path]::IsPathRooted($CredentialPath)) { throw 'CredentialPath must be an absolute path.' }
$CredentialPath = [IO.Path]::GetFullPath($CredentialPath)
if ((Test-Path -LiteralPath $CredentialPath) -and !$Replace) { throw 'Credential file already exists. Use -Replace to explicitly replace it with an encrypted backup.' }
if ($AuthMode -eq 'password' -and !$Username) { $Username = Read-Host 'Polarion username' }
if ($AuthMode -eq 'password' -and [string]::IsNullOrWhiteSpace($Username)) { throw 'Username is required for password authentication.' }
if (!$Secret) { $Secret = Read-Host ('Polarion ' + $AuthMode + ' (hidden input)') -AsSecureString }
if ($Secret.Length -eq 0) { throw 'Secret must not be empty.' }
$directory = Split-Path -Parent $CredentialPath
New-Item -ItemType Directory -Path $directory -Force | Out-Null
$temporary = Join-Path $directory ('.credentials-' + [Guid]::NewGuid().ToString('N') + '.tmp')
$backup = $null
try {
  $payload = @{version=2;auth_mode=$AuthMode;secret_dpapi=(ConvertFrom-SecureString -SecureString $Secret)}
  if ($AuthMode -eq 'password') { $payload.username = $Username }
  [IO.File]::WriteAllText($temporary, ($payload | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
  $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  & icacls.exe $temporary /inheritance:r /grant:r ('*' + $sid + ':F') '*S-1-5-18:F' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Could not restrict credential file permissions; original file preserved.' }
  if (Test-Path -LiteralPath $CredentialPath) {
    if (!$Replace) { throw 'Credential file appeared during configuration; it was preserved.' }
    $backup = $CredentialPath + '.backup-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssffff')
    [IO.File]::Replace($temporary, $CredentialPath, $backup)
  } else { [IO.File]::Move($temporary, $CredentialPath) }
  # No username, encrypted payload or secret is emitted. DPAPI is Windows-user bound.
  @{configured=$true;path=$CredentialPath;authMode=$AuthMode;protection='Windows CurrentUser DPAPI';backup=$backup} | ConvertTo-Json -Compress
} finally {
  if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
  $payload=$null; $Secret=$null
}
