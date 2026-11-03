$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$expected = Join-Path $root 'dist/native/com.nanju.polarion.sidebar.json'
foreach ($key in @('HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.nanju.polarion.sidebar','HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.nanju.polarion.sidebar')) {
  if (Test-Path -LiteralPath $key) {
    if ((Get-Item -LiteralPath $key).GetValue('') -ne $expected) { throw 'Registration belongs to another installation; not removed.' }
    Remove-Item -LiteralPath $key
  }
}
Write-Output 'Dedicated development registration removed. User sessions, drafts, and credentials retained.'
