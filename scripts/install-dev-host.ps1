[CmdletBinding()]
param([switch]$PrepareOnly, [string]$DataDirectory, [string]$ClaudePath, [string]$CredentialPath)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (![Environment]::Is64BitOperatingSystem) { throw 'This release requires Windows x64.' }
$node = Join-Path $root '.runtime/node-v24.22.2-win-x64/node.exe'
foreach ($relative in @('.runtime/node-v24.22.2-win-x64/node.exe','dist/host/native-bridge.mjs','dist/host/server.mjs','dist/host/polarion-worker.mjs','resources/diagram-design/source.json','resources/diagram-design/skill/SKILL.md')) {
  if (!(Test-Path -LiteralPath (Join-Path $root $relative) -PathType Leaf)) { throw ('Required installation file missing: ' + $relative + '. Run setup-runtime and check.ps1 first.') }
}
$outDir = Join-Path $root 'dist/native'
$manifest = Join-Path $outDir 'com.nanju.polarion.sidebar.json'
$keys = @('HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.nanju.polarion.sidebar','HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.nanju.polarion.sidebar')
# Preflight both browsers before changing either registration.
if (!$PrepareOnly) {
  foreach ($key in $keys) {
    if ((Test-Path -LiteralPath $key) -and (Get-Item -LiteralPath $key).GetValue('') -ne $manifest) { throw 'Conflicting host registration. Uninstall the previous location before registering this one.' }
  }
}
function Resolve-ExplicitPath([string]$Value, [string]$Name) {
  if (![IO.Path]::IsPathRooted($Value)) { throw ($Name + ' must be an absolute path.') }
  return [IO.Path]::GetFullPath($Value)
}
if (Test-Path -LiteralPath (Join-Path $outDir 'launcher.json') -PathType Leaf) {
  $previous = Get-Content -LiteralPath (Join-Path $outDir 'launcher.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($previous.root -eq $root) {
    if (!$DataDirectory -and !$env:POLARION_SIDEBAR_DATA) { $DataDirectory = $previous.data }
    if (!$ClaudePath -and !$env:POLARION_SIDEBAR_CLAUDE) { $ClaudePath = $previous.claude }
    if (!$CredentialPath -and !$env:POLARION_SIDEBAR_CREDENTIALS) { $CredentialPath = $previous.credentials }
  }
}
if (!$DataDirectory) { $DataDirectory = $env:POLARION_SIDEBAR_DATA }
if (!$DataDirectory) { $DataDirectory = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Nanju/PolarionSidebar' }
$DataDirectory = Resolve-ExplicitPath $DataDirectory 'DataDirectory'
if (!$ClaudePath) { $ClaudePath = $env:POLARION_SIDEBAR_CLAUDE }
if (!$CredentialPath) { $CredentialPath = $env:POLARION_SIDEBAR_CREDENTIALS }
if ($ClaudePath) {
  $ClaudePath = Resolve-ExplicitPath $ClaudePath 'ClaudePath'
  if (!(Test-Path -LiteralPath $ClaudePath -PathType Leaf) -or $ClaudePath -notmatch '\.(exe|[cm]?js)$') { throw 'ClaudePath must name an installed executable or CLI JavaScript file, not a .cmd/.ps1 shim.' }
}
if ($CredentialPath) {
  $CredentialPath = Resolve-ExplicitPath $CredentialPath 'CredentialPath'
  if (!(Test-Path -LiteralPath $CredentialPath -PathType Leaf)) { throw 'The configured credential file is missing.' }
}
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$exe = Join-Path $outDir 'PolarionSidebarHost.exe'
$compiler = @((Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'), (Join-Path $env:WINDIR 'Microsoft.NET/Framework/v4.0.30319/csc.exe')) | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
if (!$compiler) { throw '.NET Framework 4 compiler is required to build the Windows Native Messaging launcher.' }
& $compiler /nologo /target:exe /reference:System.Web.Extensions.dll ('/out:' + $exe) (Join-Path $PSScriptRoot 'NativeLauncher.cs')
if ($LASTEXITCODE -ne 0) { throw 'Native launcher compilation failed' }
$identity = Get-Content -LiteralPath (Join-Path $root 'apps/extension/identity.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($identity.id -notmatch '^[a-p]{32}$') { throw 'Invalid extension identity' }
$origin = 'chrome-extension://' + $identity.id + '/'
$launcher = @{node=$node;bridge=(Join-Path $root 'dist/host/native-bridge.mjs');root=$root;origin=$origin;data=$DataDirectory}
if ($ClaudePath) { $launcher.claude = $ClaudePath }
if ($CredentialPath) { $launcher.credentials = $CredentialPath }
[IO.File]::WriteAllText((Join-Path $outDir 'launcher.json'),($launcher | ConvertTo-Json),(New-Object Text.UTF8Encoding($false)))
$content = @{name='com.nanju.polarion.sidebar';description='Polarion Sidebar local persistent Host';path=$exe;type='stdio';allowed_origins=@($origin)}
[IO.File]::WriteAllText($manifest,($content | ConvertTo-Json),(New-Object Text.UTF8Encoding($false)))
if ($PrepareOnly) {
  Write-Output 'Launcher and manifest prepared. No registry, user environment or application-state permissions changed.'
  exit 0
}
# Only this app's private state directory. Do not alter the user's shared credential store.
$state = $DataDirectory
New-Item -ItemType Directory -Force -Path $state | Out-Null
$identityName = [Security.Principal.WindowsIdentity]::GetCurrent().Name
& icacls.exe $state /inheritance:r /grant:r ($identityName + ':(OI)(CI)F') 'SYSTEM:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not restrict application state directory' }
foreach ($key in $keys) {
  if (!(Test-Path -LiteralPath $key)) { New-Item -Path $key -Force | Out-Null; Set-Item -LiteralPath $key -Value $manifest }
}
Write-Output 'Dedicated sidebar Host registered for the current user.'
