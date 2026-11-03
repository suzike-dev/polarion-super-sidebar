# 版本与基线管理

## 当前基线

首个源码基线为 `v0.2.5`，日期 2026-11-03，仓库 `suzike-dev/polarion-super-sidebar`，私有。此前版本只保留真实开发记录，不创建追溯性的虚构提交或 tag。

`main` 保存通过检查的集成结果。功能分支使用 `feat/<topic>`，修复使用 `fix/<topic>`，维护使用 `chore/<topic>`；通过 PR 进入 main。合并前检查 CI、验证记录、CHANGELOG 和数据兼容性。

## 版本号

采用 `MAJOR.MINOR.PATCH`。1.0 之前，MINOR 表示功能增量或明显兼容变化，PATCH 表示修复及小幅优化。Chrome 扩展要求数字版本，开发稳定程度通过 Release 的 Pre-release 标记及文档表示，不向 manifest 写入带连字符的版本。

以下四个文件必须保持一致：

- package.json
- package-lock.json（根版本与 packages[""]）
- apps/extension/wxt.config.ts
- apps/host/service.ts

```powershell
node scripts/version.mjs set 0.2.6
# 编辑 CHANGELOG.md，为该版本写清变化和验证结果
node scripts/version.mjs check
./scripts/check.ps1
```

## 提交与发布

推荐提交前缀 `feat:`、`fix:`、`docs:`、`test:`、`chore:`。每个提交围绕一个可审阅的变化，避免把业务数据和构建目录一并提交。

发布流程：

1. 完成版本更新、CHANGELOG、自动检查和受影响的浏览器验证。
2. 合并 PR 后确认 main 的 CI 通过，工作区无待提交改动。
3. 在已核验的提交上创建 annotated tag：`git tag -a v0.2.6 -m "Release v0.2.6"`。
4. 推送 tag：`git push origin v0.2.6`，确认 tag CI 通过。
5. 使用该 tag 创建 GitHub Release，写清变化、验证和已知限制；开发版标记 Pre-release。

tag 发布后不移动、不覆盖；修正发布缺陷使用新版本。GitHub 自动提供的源码压缩包不是可安装扩展包，不将其称为完整安装包。

当前仓库的 GitHub 套餐不支持私有仓库保护规则（API 返回 403，要求升级套餐或公开仓库）。仓库保持私有；上述 PR/CI 门槛和 tag 不覆盖要求目前是维护约定，不能表述为已启用服务器强制保护。后续套餐支持时，再为 main 启用必需 CI/PR、禁止强推和删除，并为 v* tag 启用禁止更新与删除规则。

## 回退

可从已发布 tag 建立修复分支，例如 `git switch -c fix/regression v0.2.5`。恢复代码不等于恢复 SQLite 草稿、会话或 Polarion 远端版本；数据迁移和服务端需求变更需单独核验，不能用代码回退推断业务数据已回退。

## 自动检查范围

CI 在 Windows / Node 24.22.2 执行版本一致性、类型检查、单元测试及构建。CI 不使用本机登录、Polarion 凭据或真实业务写入；保存行为和浏览器交互仍由隔离环境实测覆盖。
