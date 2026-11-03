$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$node = Join-Path $root '.runtime/node-v24.22.2-win-x64/node.exe'
Push-Location $root
try {
  & $node node_modules/typescript/bin/tsc --noEmit
  if ($LASTEXITCODE -ne 0) { throw 'Host type check failed' }
  & $node node_modules/wxt/bin/wxt.mjs prepare apps/extension
  if ($LASTEXITCODE -ne 0) { throw 'Extension preparation failed' }
  & $node node_modules/typescript/bin/tsc --noEmit -p apps/extension/tsconfig.json
  if ($LASTEXITCODE -ne 0) { throw 'Extension type check failed' }
  & $node --test 'packages/core/*.test.ts' 'apps/host/*.test.ts' 'apps/extension/lib/*.test.ts'
  if ($LASTEXITCODE -ne 0) { throw 'Tests failed' }
  & $node scripts/build-host.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Host build failed' }
  & $node node_modules/wxt/bin/wxt.mjs build apps/extension
  if ($LASTEXITCODE -ne 0) { throw 'Extension build failed' }
} finally { Pop-Location }
