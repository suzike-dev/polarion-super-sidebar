import { spawn } from 'node:child_process';

const PICK_TIMEOUT = 90_000;

/**
 * Windows 原生选择器。浏览器扩展拿不到真实文件系统路径，
 * 由本地 Host 在同一用户桌面会话弹出系统对话框并把绝对路径回传。
 */
function runDialog(script: string, env: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    // Windows PowerShell 重定向输出时默认按 OEM 代码页编码，中文路径会变成乱码。
    const prelude = '[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)\n$OutputEncoding = [Console]::OutputEncoding\n';
    const child = spawn('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-Command', prelude + script], {
      env: { ...process.env, ...env }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill(); reject(Error('DIALOG_TIMEOUT')); }, PICK_TIMEOUT);
    child.stdout.setEncoding('utf8').on('data', chunk => { out += chunk; });
    child.stderr.setEncoding('utf8').on('data', chunk => { err += chunk; });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) return reject(Error('DIALOG_FAILED: ' + (err.trim().slice(0, 300) || code)));
      resolve(out.trim());
    });
  });
}

// 无主窗口时对话框会藏到浏览器后面：用一个透明置顶窗口当拥有者。
const OWNER = `Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$owner = New-Object System.Windows.Forms.Form
$owner.Text = 'Polarion Sidebar'
$owner.ShowInTaskbar = $false
$owner.TopMost = $true
$owner.Opacity = 0
$owner.Size = New-Object System.Drawing.Size(1,1)
$owner.StartPosition = 'CenterScreen'
$owner.Show()
$owner.Activate()`;

export async function pickFolder(title: string, defaultPath: string): Promise<string | null> {
  const script = `${OWNER}
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = $env:PSB_TITLE
$dialog.ShowNewFolderButton = $true
if ($env:PSB_DEFAULT -and (Test-Path -LiteralPath $env:PSB_DEFAULT)) { $dialog.SelectedPath = $env:PSB_DEFAULT }
try { $result = $dialog.ShowDialog($owner); if ($result -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($dialog.SelectedPath) } }
finally { $owner.Close() }`;
  const value = await runDialog(script, { PSB_TITLE: title, PSB_DEFAULT: defaultPath });
  return value || null;
}

export async function pickFiles(title: string, defaultPath: string): Promise<string[]> {
  const script = `${OWNER}
$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Title = $env:PSB_TITLE
$dialog.Multiselect = $true
$dialog.CheckFileExists = $true
$dialog.Filter = 'Markdown 与文本|*.md;*.markdown;*.txt;*.json;*.yml;*.yaml|所有文件|*.*'
if ($env:PSB_DEFAULT -and (Test-Path -LiteralPath $env:PSB_DEFAULT)) { $dialog.InitialDirectory = $env:PSB_DEFAULT }
try { $result = $dialog.ShowDialog($owner); if ($result -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write(($dialog.FileNames -join [Environment]::NewLine)) } }
finally { $owner.Close() }`;
  const value = await runDialog(script, { PSB_TITLE: title, PSB_DEFAULT: defaultPath });
  return value ? value.split(/\r?\n/).map(line => line.trim()).filter(Boolean) : [];
}
