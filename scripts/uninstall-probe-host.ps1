$ErrorActionPreference='Stop'
$projectRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$expected=Join-Path $projectRoot '.research\s1\native-host\com.nanju.polarion.s1.json'
foreach($key in @('HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.nanju.polarion.s1','HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.nanju.polarion.s1')){
  if(Test-Path $key){if((Get-Item $key).GetValue('') -ne $expected){throw 'Host registration changed; refusing removal'};Remove-Item -LiteralPath $key}
}
Write-Output 'Dedicated S1 native-host registrations removed. Other hosts and extensions unchanged.'
