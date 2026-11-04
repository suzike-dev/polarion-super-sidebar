# 历史开发探针

此目录保存早期开发过程的原始实验，不属于安装、验证或发版命令。

- `probe-polarion.mjs` 使用早期外部 MCP 项目与当时的业务样例。
- `probe-document-structure.mjs` 针对 2026-11-03 隔离项目结构执行过特定写入实验。
- `start-polarion-capability.ps1` 是该历史结构探针的旧启动包装器。
- `probe-claude-capabilities.mjs` 和 `probe-native-command.mjs` 记录早期固定 npm 安装布局的 SDK 实验。

它们保留历史来源，不能在新电脑或正式需求上直接运行。当前产品 SOAP 适配器位于 `packages/polarion-soap`；跨目录安装与诊断使用 `scripts/setup-runtime.mjs`、`check.ps1`、`diagnose-install.mjs` 和 `probe-portability-cleanroom.mjs`。
