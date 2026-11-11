import { defineConfig } from 'wxt';
import fs from 'node:fs';
import path from 'node:path';
const identity = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, 'identity.json'), 'utf8'));
const key = identity.publicKey;
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Polarion 超级侧边栏 · 开发版', version: '0.9.1', key,
    description: '与本地 Agent 及 Polarion 工作项共享上下文和草稿的工程工作台',
    permissions: ['storage', 'contextMenus', 'nativeMessaging', 'scripting', 'offscreen', 'clipboardWrite'],
    host_permissions: ['https://polarion.pufafen.com/*'],
    action: { default_title: '展开 / 收起 Polarion 助手' },
    web_accessible_resources:[{resources:['board.html'],matches:['https://polarion.pufafen.com/*']}],
  },
});
