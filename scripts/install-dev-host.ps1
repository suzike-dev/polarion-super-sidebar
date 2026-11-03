$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$outDir = Join-Path $root 'dist/native'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$exe = Join-Path $outDir 'PolarionSidebarHost.exe'
$compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
& $compiler /nologo /target:exe /reference:System.Web.Extensions.dll ('/out:' + $exe) (Join-Path $PSScriptRoot 'NativeLauncher.cs')
if ($LASTEXITCODE -ne 0) { throw 'Native launcher compilation failed' }
$identity = Get-Content -LiteralPath (Join-Path $root 'apps/extension/identity.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($identity.id -notmatch '^[a-p]{32}$') { throw 'Invalid extension identity' }
$origin = 'chrome-extension://' + $identity.id + '/'
$launcher = @{node=(Join-Path $root '.runtime/node-v24.22.2-win-x64/node.exe');bridge=(Join-Path $root 'dist/host/native-bridge.mjs');root=$root;origin=$origin}
[IO.File]::WriteAllText((Join-Path $outDir 'launcher.json'),($launcher | ConvertTo-Json),(New-Object Text.UTF8Encoding($false)))
$manifest = Join-Path $outDir 'com.nanju.polarion.sidebar.json'
$content = @{name='com.nanju.polarion.sidebar';description='Polarion Sidebar local persistent Host';path=$exe;type='stdio';allowed_origins=@($origin)}
[IO.File]::WriteAllText($manifest,($content | ConvertTo-Json),(New-Object Text.UTF8Encoding($false)))
foreach ($key in @('HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.nanju.polarion.sidebar','HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.nanju.polarion.sidebar')) {
  if (Test-Path -LiteralPath $key) { if ((Get-Item -LiteralPath $key).GetValue('') -ne $manifest) { throw 'Conflicting host registration' } }
  else { New-Item -Path $key -Force | Out-Null; Set-Item -LiteralPath $key -Value $manifest }
}
# Only this app's private state directory. Do not alter the user's shared credential store.
$state = Join-Path $env:LOCALAPPDATA 'Nanju/PolarionSidebar'
New-Item -ItemType Directory -Force -Path $state | Out-Null
$identityName = [Security.Principal.WindowsIdentity]::GetCurrent().Name
& icacls.exe $state /inheritance:r /grant:r ($identityName + ':(OI)(CI)F') 'SYSTEM:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not restrict application state directory' }
Write-Output 'Dedicated sidebar Host registered for the current user.'
