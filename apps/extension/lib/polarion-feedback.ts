const credentialHelp = '请打开设置，在“Polarion 账号”中输入用户名和密码，点击“保存并连接”。';
const messages: Record<string, string> = {
  POLARION_CREDENTIAL_FILE_MISSING: '未找到 Polarion 凭据。' + credentialHelp,
  POLARION_CREDENTIAL_DECRYPT_FAILED: '无法解密 Polarion 凭据。加密凭据不能直接从其他电脑或 Windows 用户复制；请为当前用户重新配置。',
  POLARION_CREDENTIAL_FILE_INCOMPLETE: 'Polarion 凭据文件不完整。请检查凭据配置或重新配置。',
  POLARION_CREDENTIAL_SECRET_EMPTY: 'Polarion 凭据为空。请检查凭据配置或重新配置。',
  POLARION_CREDENTIAL_VERSION_UNSUPPORTED: 'Polarion 凭据格式版本不受支持。请检查选择的凭据文件。',
  POLARION_AUTH_MODE_UNSUPPORTED: 'Polarion 凭据的认证方式不受支持。请检查选择的凭据文件。',
  POLARION_CREDENTIAL_PATH_MUST_BE_ABSOLUTE: 'Polarion 凭据路径必须是绝对路径。请检查安装时配置的路径。',
  POLARION_WORKER_INSTALLATION_INCOMPLETE: 'Polarion 连接组件缺失。请在安装目录重新构建并检查安装。',
  POLARION_WORKER_STOPPED: 'Polarion 连接进程已停止。请检查本机凭据和安装；详见 README 的连接检查。',
  POLARION_AUTHENTICATION_FAILED: 'Polarion 未接受此账号或密码。请核对登录信息后重新输入；原有凭据保留。',
  POLARION_CONNECTION_FAILED: '暂时无法连接 Polarion。请检查网络或 VPN、服务状态；原有凭据保留。',
  POLARION_CREDENTIAL_SAVE_FAILED: '凭据保存失败，请检查本机安装与目录写入权限；原有凭据保留。',
  POLARION_CONNECTION_BUSY: 'Polarion 正在读取或保存，请等待当前操作结束后重试。',
};
export function polarionFeedback(code: string): string | undefined { return messages[code]; }
