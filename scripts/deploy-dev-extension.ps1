$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$source = Join-Path $root 'apps/extension/.output/chrome-mv3'
$target = Join-Path $root 'spikes/extension'
$backup = Join-Path $root 'spikes/s1-probe'
if (!(Test-Path -LiteralPath (Join-Path $source 'manifest.json'))) { throw 'Build the extension first' }
if ((Test-Path -LiteralPath $target) -and !(Test-Path -LiteralPath $backup)) { Copy-Item -LiteralPath $target -Destination $backup -Recurse }
New-Item -ItemType Directory -Force -Path $target | Out-Null
foreach ($file in (Get-ChildItem -LiteralPath $source)) { Copy-Item -LiteralPath $file.FullName -Destination $target -Recurse -Force }
# Only obsolete S1 files; their original source is retained in the verified backup above.
foreach ($name in @('probe.html','probe.js','context.js')) {
  $obsolete = [IO.Path]::GetFullPath((Join-Path $target $name))
  if (!$obsolete.StartsWith($root + [IO.Path]::DirectorySeparatorChar)) { throw 'Unexpected cleanup target' }
  if (Test-Path -LiteralPath $obsolete) { Remove-Item -LiteralPath $obsolete }
}
Write-Output 'Development build copied to the already-loaded extension directory; S1 source preserved.'
