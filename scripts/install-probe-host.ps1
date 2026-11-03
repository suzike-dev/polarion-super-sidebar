[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
$projectRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$output=Join-Path $projectRoot '.research\s1\native-host'
New-Item -ItemType Directory -Force -Path $output | Out-Null
$exe=Join-Path $output 'PolarionS1Host.exe'
$compiler=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
& $compiler /nologo /target:exe /reference:System.Web.Extensions.dll ('/out:'+$exe) (Join-Path $projectRoot 'spikes\native-host\ProbeHost.cs')
if($LASTEXITCODE -ne 0){throw 'Native probe compilation failed'}
$identity=Get-Content -Raw -Encoding UTF8 (Join-Path $projectRoot '.research\s1\extension-identity.json') | ConvertFrom-Json
if($identity.id -notmatch '^[a-p]{32}$'){throw 'Invalid extension identity'}
$manifest=Join-Path $output 'com.nanju.polarion.s1.json'
$content=@{name='com.nanju.polarion.s1';description='Polarion S1 scoped echo probe';path=$exe;type='stdio';allowed_origins=@('chrome-extension://'+$identity.id+'/')} | ConvertTo-Json -Depth 4
[IO.File]::WriteAllText($manifest,$content,(New-Object Text.UTF8Encoding($false)))
$keys=@('HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.nanju.polarion.s1','HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.nanju.polarion.s1')
foreach($key in $keys){
  if(Test-Path $key){$current=(Get-Item $key).GetValue('');if($current -ne $manifest){throw 'Existing probe registration differs; refusing overwrite'}}
  else{New-Item -Path $key -Force | Out-Null;Set-Item -LiteralPath $key -Value $manifest}
}
$receipt=@{at=[DateTime]::UtcNow.ToString('o');extension_id=$identity.id;manifest=$manifest;executable=$exe;registry_keys=$keys;scope='current user; dedicated test host; no existing host modified';uninstall='scripts/uninstall-probe-host.ps1'}
[IO.File]::WriteAllText((Join-Path $projectRoot '.research\s1\native-registration.json'),($receipt | ConvertTo-Json -Depth 4),(New-Object Text.UTF8Encoding($false)))
$receipt | ConvertTo-Json -Depth 4
