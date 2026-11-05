# Polarion 超级侧边栏

[![Version 0.5.0](https://img.shields.io/badge/Version-v0.5.0-0F766E?style=for-the-badge)](https://github.com/suzike-dev/polarion-super-sidebar/releases/tag/v0.5.0)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-087EA4?style=for-the-badge&logo=react&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![Claude Code](https://img.shields.io/badge/Claude_Code-D97757?style=for-the-badge&logo=claude&logoColor=white)
![Model Context Protocol](https://img.shields.io/badge/Model_Context_Protocol-7C3AED?style=for-the-badge&logo=modelcontextprotocol&logoColor=white)

**先看需求全景，再在需求旁边使用本地 AI；在同一份草稿里编辑，审阅后保存回 Polarion。**

面向工程需求编写与评审的 Windows 浏览器扩展。需求总览把整份 LiveDoc 铺成章节矩阵；独立富文本窗口与 AI 侧栏并排工作；正文、工程表格和画板保留各自的编辑方式；Claude Code 使用本机已有配置、Skills 与 MCP。

[安装与更新](#安装与更新) · [需求总览](#从需求全景开始) · [变体](#同一需求多个变体) · [保存机制](#保存机制) · [验收与边界](#验收与边界) · [版本记录](CHANGELOG.md) · [GitHub Releases](https://github.com/suzike-dev/polarion-super-sidebar/releases)

**[0.5.0 · Windows 开发版](https://github.com/suzike-dev/polarion-super-sidebar/releases/tag/v0.5.0)。** 新增软件需求分析总览、编辑器与对话的 `@` 工作项引用、完整阅读预览、变体管理和可持久化的预设指令；画板扩展到 70 项内置素材、6 个整图模板与 Mermaid 导入。本轮同时修复总览/编辑器遮挡、长分组单列、`@` 候选过少与弹窗不关闭、受保护宏显示、指令删除不生效、Host 草稿目录与 Lucene 查询边界，以及画板长文本标签、素材吸附壳、剪贴板并发等问题。

[![功能示意：独立富文本窗口与 AI 侧栏，使用虚构内容](docs/assets/readme-workbench.svg)](docs/assets/readme-workbench.svg)

*按当前产品功能自绘，使用虚构示例；不是产品截图，不含真实项目、需求或对话信息。点击图片可放大。*

## 从需求全景开始

侧边栏头部只有一个「总览」按钮。点击后，总览在**左侧文档区**展开，不挤占右侧 AI 侧栏；对话仍可继续使用。

二级章是一条色带，三级分组是色带内的块，条目直接平铺：不做可折叠树，也不要求逐层点开。分组块按体量分配宽度，大分组再按 18 项切块并排；**如果某个大章没有三级分组**（工作项直接挂在章下），整章跨满宽度、多列平铺，不会变成一根超长竖列。

[![功能示意：需求总览的章节色带、分组块与条目平铺，使用虚构编号与名称](docs/assets/readme-overview.svg)](docs/assets/readme-overview.svg)

*自绘功能示意，使用虚构工作项。真实 SWR 文档实测 258 个可导航条目、24 个分组块、零重叠；章节和分组数量随文档变化。*

| 操作 | 行为 |
|---|---|
| 输入或 `Ctrl+F` | 在面板内搜索编号或名称，结果即时收敛 |
| 单击条目 | 打开完整**阅读预览**（只读，不修改草稿、不写服务端） |
| 预览内「打开编辑工作台」 | 进入悬浮编辑器；总览关闭，编辑现场保留 |
| 编辑中再开总览 | 编辑层暂时隐藏但保持挂载；关闭总览后原样回来 |
| `Esc` | 关闭当前层的阅读预览或总览，不误关其他弹层 |

总览读取 Host 的文档结构，优先使用本地缓存秒开，再后台刷新；切换文档时旧请求不会回写。条目仍来自同一个 Polarion 文档，跨文档或不在当前文档的工作项会被拒绝。

## @ 引用工作项，单击即读

编辑器正文和对话输入框都支持 `@`：

- 输入 `@` 立即列出**本文档全部工作项**（读取 Polarion 正文同源 iframe 内的 `module-workitem` 块），继续输入编号或标题即时过滤；中文紧邻 `@`（如「参考@」）也能触发。
- 候选弹窗自带搜索框，不再只显示十几条；最多展示 300 条并可滚动。`↑↓` 选择、`Enter` 插入、`Esc` 关闭；点击外部、滚动或切换焦点也会自动收起。
- 插入的是源保留的原生引用标记 `span.polarion-rte-link[data-type="workItem"]`；保存后就是 Polarion 原生工作项链接，往返编辑不丢。
- 编辑器、聊天回答和原生正文里的引用编号，**单击**打开完整阅读预览；双击不会触发 Polarion 自己的编辑器跳转。

[![功能示意：@ 搜索、本文档候选、插入原生引用与阅读预览，使用虚构工作项](docs/assets/readme-references.svg)](docs/assets/readme-references.svg)

*自绘功能示意，候选来源依次为「本文档工作项 → 本地草稿 → Polarion 搜索」，按编号去重。*

阅读预览是独立只读窗口：标题、修订、完整正文、表格与图片；`Esc` 或遮罩关闭。需要修改时再点「打开编辑工作台」，预览本身不会改动任何内容。

## 同一需求，多个变体

一个需求可能因客户、项目、车型或配置存在多个版本。主工作项保持文档槽位稳定；变体是 Polarion 项目里的**独立工作项**，通过可配置链接角色关联，需要时再接入主正文。

[![功能示意：主工作项、默认变体、独立变体工作项与接入/撤销流程，使用虚构客户和项目](docs/assets/readme-variants.svg)](docs/assets/readme-variants.svg)

*自绘功能示意，客户、项目与车型均为虚构；真实验收使用隔离测试文档。*

| 能力 | 行为 |
|---|---|
| 新建变体 | 同类型独立工作项，可复制主正文；客户/项目/车型/配置/备注存入工作项附件 `sidebar-variant.json` |
| 默认变体 | 主工作项默认显示为「默认」；首次接入其他变体前先把它捕获成独立默认变体，避免原始正文丢失 |
| 编辑变体 | 复用悬浮编辑器；保存只写变体工作项，不触碰主工作项 |
| 接入主工作项 | 差异预览、主工作项并发校验、画板快照复制、图片重新绑定、服务端保存后独立回读 |
| 撤销 | 保留最近 20 次接入前正文快照；主工作项被再次修改后不再显示必然失败的撤销入口 |
| 跨机器 | 变体列表、详细配置和当前接入状态都随 Polarion 链接与附件保存，重新同步即可发现 |
| 解除 | 只删除本地归属与 Polarion 链接，工作项本身保留 |

安全边界：变体必须与主工作项存在指定角色的链接，并通过回读确认；UI 只能操作已登记的变体，不能直接指定任意工作项。Polarion 服务端写入仍通过本地草稿 + 明确保存完成。

## 把空间留给正文与表格

“文字与段落”“表格”“插入与查找”分别使用一条功能行。“添加内容”、内容块和大纲在同一行内；空间不足时，按字体、文字、段落、表格、行列等名称收起必要的功能组。

[![功能示意：文字、表格与具名功能容器在单行内组织，使用虚构内容](docs/assets/readme-toolbar.svg)](docs/assets/readme-toolbar.svg)

*自绘图展示实际功能分组；不同示例状态并列呈现，不代表同时展开。真实布局验收覆盖 1440、1366、1024、768、390px × 三组工具栏，共 15 个场景。*

编辑器提供标题与段落、列表与待办、提示块、代码块、链接、图片、查找替换、内容块移动与复制；工程表格支持行列及全表选区、插入删除、移动、合并拆分、精确颜色与表格/单元格属性。

正文里的受保护宏在编辑器中显示为紧凑 chip，优先显示宏自身的可见文字；技术名称只保留在悬停提示里，保存仍原样写回原生宏。

## 从需求描述到可编辑配图

[![功能示意：可编辑的草稿审阅流程，包含条件分支和返回修改回路，全部内容虚构](docs/assets/readme-board.svg)](docs/assets/readme-board.svg)

*自绘的虚构草稿审阅流程，展示真实产品的预览和可编辑图形能力，不采用任何工程现场截图。*

画板右侧原生素材库随扩展内置 **70 个原创工程素材**，按流程、系统与接口、控制逻辑、热管理、泳道与角色、UML 结构、时序图元、数据流、便签标注与整图模板十类编排；整图模板含评审泳道、分层架构、状态机、时序交互、数据流与 V 模型，插入解组后即可编辑。

| 能力 | 行为 |
|---|---|
| AI 整图 | `kind=flow`、`swimlane`、`sequence`、`class`、`er`；生成草案先预览、再应用到可编辑画板，插入正文仍只改本地草稿 |
| 模板中心 | 6 个内置整图模板，缩略图预览后插入当前视口并选中，ID/绑定/分组全部重映射 |
| Mermaid | 粘贴 flowchart/sequence/class/state/ER 定义转可编辑图形；容器文字展开为绑定文字，`Ctrl+V` 可直接进入导入预览 |
| 快速连接 | 主菜单或 `C`，点起点→点目标自动生成绑定连线；`Esc` 退出 |
| 便签与对齐 | 一键便签、四色切换、多选对齐/分布；容器文字与关系标签随容器/箭头移动 |
| 复制图片 | 主菜单复制 PNG 到系统剪贴板；并发复制不会重复创建离屏文档 |
| 快捷键 | `?` 打开 27 条分组快捷键帮助；不再同时弹出两套帮助 |

生成器会校验画幅、标题、节点重叠、标签遮挡和关系线穿越；长 class/ER 标签按实际换行高度避让，sequence 长消息/长参与者名动态计算行高。放不下时返回布局提示，要求拆成概览和详图，而不是生成一张坏图。

## 保存机制

**本地自动保存保留草稿；“保存到 Polarion”才触发服务端写入。** AI 的正文工具修改共享草稿，选择 Agent 权限模式不会取消明确保存这一步。

![保存路径：本地草稿与审阅，经明确保存和状态检查后写入服务端；独立回读一致后更新当前原生页面，异常时保留草稿](docs/assets/readme-save.svg)

保存前检查原生编辑状态、工作项归属与服务端版本。写入正文和附件后，Host 独立回读核对结果；确认后更新当前原生文档模型和正文。已验证的 21R2 适配路径保留页面、编辑器、会话与滚动位置，保存过程中没有页面或 iframe 重载。

发生冲突时进入差异处理；写入结果不确定时保留草稿并要求先核对服务端。SOAP 接口的原子 CAS 保证尚未验证，因此不能把版本检查表述为完整的并发事务保证。

免刷新保存严格匹配已验证的 Polarion 21R2 构建；其他构建在远程保存前停止，需完成适配与验收。[保存与原生交替编辑验收](docs/整体精修与富文本验收_20261104.md) · [大型 LiveDoc 修复记录](docs/v0.2.6大文档保存修复.md)

## 会话效率与指令

- **批准方式**：默认“自动批准”，读取、草稿操作与本地命令自动执行；文件编辑限项目工作区，越界写入仍需确认。可切“请求批准”或“完全访问”；设置中可固定新会话默认值，任务开始时固定本轮权限。
- **运行中继续输入**：默认“排队”，当前任务结束后自动作为下一轮发送（最多 5 条，可取消）；“引导”优雅打断当前任务并保留对话上下文。两种方式都可在设置中设为默认。
- **预设指令**：分「随发送附加」与「通用指令库」。前者在输入框下拉选择后随消息发送，每次单独选择、默认不附加；后者由 Agent 按需求内容自动查阅，索引每轮随提示词下发。每条指令可挂多个本地 Markdown/文本文件，内容每次使用时重新读取。
- **消息操作**：复制回答、复制 Markdown、引用选中片段或整条回答、用同样请求重试；长会话只挂载最近 40 轮，可展开更早记录。
- **设置持久化**：字号 12–18px、共享草稿文件夹（Windows 原生选择器，保存时迁移为 JSON 文件）、指令增删改、Polarion 账号保存并连接；删除指令后保存会真正删除服务端记录。

[![功能示意：回答字号设置、即时预览与明确保存，使用虚构示例](docs/assets/readme-settings.svg)](docs/assets/readme-settings.svg)

## 本机与服务端如何协作

![系统架构：浏览器扩展经 Native Messaging 连接本地 Host，Host 管理草稿和 Claude Code；独立凭据进程通过 SOAP 访问 Polarion 正文与附件](docs/assets/readme-architecture.svg)

浏览器负责上下文、编辑与审阅；本地 Host 负责持久会话、草稿、Agent 运行和保存编排；Polarion 继续承载工作项正文与附件。模型请求按照本机 Claude Code 配置发送，“本地 Agent”描述的是 CLI 与工具运行位置，不表示模型推理离线运行。

<details>
<summary><strong>技术栈、数据位置与目录</strong></summary>

| 部分 | 实现 |
|---|---|
| 浏览器扩展 | TypeScript · React 19 · WXT · Shadow DOM |
| 内容编辑 | Tiptap 3 · Excalidraw · 源 HTML 映射 |
| 本地 Host | Node.js 24.22.2 · SQLite · Native Messaging |
| 协议与状态 | Zod 校验 · 上下文快照 · 草稿修订 · 运行事件 |
| Polarion 连接 | 独立凭据进程 · SOAP 正文与附件读写 · 保存后独立回读 |

会话、草稿与项目工作目录默认位于 `%LOCALAPPDATA%\Nanju\PolarionSidebar`。Polarion 连接读取已有 Windows DPAPI 凭据存储；凭据只进入独立的 Polarion 进程，不传入 AI 引擎环境。

共享草稿文件夹中的其他 JSON（如 `package.json`）会被忽略，不会被当作草稿；同目录的另一种路径写法不会触发迁移删除；目录暂时不可读时允许切走并保留原文件。

```text
apps/extension/          侧栏、富文本、需求总览与画板
apps/host/               Agent、草稿、变体与保存服务
packages/core/           HTML、差异、画板、引用与格式逻辑
packages/protocol/       校验协议与共享类型
packages/polarion-soap/  SOAP 适配器与上游许可证
scripts/                构建、安装、版本与开发探针
docs/                   规格、验证报告与自绘功能示意图
```

</details>

## 安装与更新

当前交付方式是**源码开发安装**，请选择自己有写权限的固定本地目录；已验证路径包含中文和空格的安装。GitHub Release 自动提供的源码压缩包不是可直接加载的扩展包；图形安装器与自动更新尚未交付。UNC 网络目录、超长路径和只读安装目录尚未验收。

### 环境准备

| 条件 | 要求 |
|---|---|
| 系统与工具 | Windows x64、Git、现有 Node.js 20.11+（20.x）或 22+ 与 npm，仅用于引导；Windows PowerShell、.NET Framework 4 编译器。后续安装、检查及运行使用项目私有 Node 24.22.2，无需把全局 Node 固定为 24 |
| 浏览器 | 可加载本地 Chrome MV3 扩展；本轮实测使用 Ego，Chrome/Edge 的完整矩阵尚未验收 |
| Claude Code | 本机已安装并认证；自动发现 PATH、原生安装或 npm 安装，可显式指定 CLI 路径 |
| Polarion | 当前适配的公司 21R2 实例及自己的账号/访问令牌；可独立配置本工具凭据，不要求先安装某个 MCP |
| Skills 与 MCP | 使用自己的配置；Diagram Design 原文与许可证已随产品提供，其它外部能力按需配置 |

### 首次安装

获取有访问权限的私有仓库。以下命令针对 `v0.5.0` 源码。复现其它版本时，在安装依赖前切换到 [Releases](https://github.com/suzike-dev/polarion-super-sidebar/releases) 中对应的 tag，并遵循该 tag 自带的 README；旧版本可能尚无下列新脚本。

```powershell
git clone https://github.com/suzike-dev/polarion-super-sidebar.git
cd polarion-super-sidebar
git switch --detach v0.5.0
node scripts/setup-runtime.mjs
$node = '.\.runtime\node-v24.22.2-win-x64\node.exe'
$npmCli = Join-Path (Split-Path (Get-Command npm.cmd).Source) 'node_modules/npm/bin/npm-cli.js'
if (!(Test-Path -LiteralPath $npmCli)) { throw '请将 $npmCli 设置为已安装 npm 的实际 npm-cli.js 路径。' }
& $node $npmCli ci --ignore-scripts
& $node scripts/version.mjs check
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/check.ps1

# 账号密码在安装后的扩展设置中配置；终端方式为可选：
# powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/configure-polarion-credentials.ps1
# 使用访问令牌时，在上条命令末尾增加 -AuthMode access_token。

./.runtime/node-v24.22.2-win-x64/node.exe scripts/diagnose-install.mjs --check-cli
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/install-dev-host.ps1
```

`setup-runtime.mjs` 下载并校验项目专用 Node 运行时，不修改全局 PATH；`check.ps1` 执行类型检查、305 项测试与构建；`install-dev-host.ps1` 为当前 Windows 用户注册 Native Messaging Host。首次安装尚未在设置中保存账号时，诊断可能报告凭据文件缺失；先完成安装，在设置中保存并连接后，再用 `--strict` 复查。

`$npmCli` 仅定位用户已安装的 npm，随后由项目私有 Node 执行；上面的定位适用于普通 Windows Node/npm 安装。如果工具管理器提供的是另一层 shim，请把变量设为该 npm 安装中的实际 `npm-cli.js`，无需修改系统 PATH。

上述 PowerShell 参数只应用于该次脚本进程，不修改用户或计算机的全局执行策略。诊断的 `--strict` 检查本机文件、构建产物、CLI 可执行性和凭据文件是否存在，**不证明 Claude 已登录、凭据能解密或 Polarion 账号权限可用**。可另做不联网解密检查：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/start-polarion-worker.ps1 -ValidateOnly
```

如果已安装的 CLI 未被发现，先用下文的 `-PrepareOnly -ClaudePath` 保存本工具路径，再重跑诊断并正式注册。使用自定义凭据文件时，直接运行 `-ValidateOnly` 也须加同一 `-CredentialPath`；这个检查脚本不会读取 launcher 配置。

凭据保存在当前用户的 `%LOCALAPPDATA%\Nanju\PolarionSidebar\credentials.json`，由 Windows CurrentUser DPAPI 加密。更换电脑或 Windows 账户应重新配置；无需复制开发者凭据、缓存或其它项目源码。已有兼容的 Polarion MCP 凭据可继续使用，配置本工具凭据不会覆盖它。替换本工具已有凭据需明确增加 `-Replace`，脚本会保留加密备份。

1. 在浏览器扩展管理页启用开发者模式，选择“加载已解压的扩展程序”。
2. 加载仓库中的 `apps/extension/.output/chrome-mv3` 目录。
3. 打开扩展页面 `chrome-extension://kmmphepmgnplcejfgiolhpfkgpcolcmp/diagnostics.html`，确认 Host 可连接，`extension` 与 `version` 一致（0.5.0）。
4. 打开已适配的 Polarion 文档，点击侧栏右上角设置，在“Polarion 账号”输入自己的用户名和密码，点击“保存并连接”。成功后即可打开编辑工作台，无需重启 Host。已用终端配置的账号可点“检查已保存的连接”。
5. 首次写回使用有授权的测试工作项，核对服务端回读与原生正文显示。

界面先验证 Polarion 登录，再原子替换本地加密凭据；登录或网络失败时保留原配置。密码以 Windows CurrentUser DPAPI 加密，不进入 AI 会话、普通设置数据库或命令行参数，提交后输入框清空。界面仅提供账号密码方式，访问令牌仍可用终端脚本配置。连接成功表示登录可用，不代表拥有所有项目的编辑权限。

### 更新已有开发安装

在保留本地改动的前提下更新源码，再执行以下检查与构建。使用发布 tag 安装的工作区，应先切换到目标发布 tag。

```powershell
node scripts/setup-runtime.mjs
$node = '.\.runtime\node-v24.22.2-win-x64\node.exe'
$npmCli = Join-Path (Split-Path (Get-Command npm.cmd).Source) 'node_modules/npm/bin/npm-cli.js'
if (!(Test-Path -LiteralPath $npmCli)) { throw '请将 $npmCli 设置为已安装 npm 的实际 npm-cli.js 路径。' }
& $node $npmCli ci --ignore-scripts
& $node scripts/version.mjs check
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/check.ps1
```

若浏览器仍加载早期的 `spikes/extension` 目录，构建后执行 `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/deploy-dev-extension.ps1`；直接加载 `.output/chrome-mv3` 的安装无需这一步。迁移安装目录时，先在旧目录撤销 Host 注册，再到新目录注册。

先在诊断页记下当前 Host 的 `pid`，等待 AI 任务结束，再关闭使用该扩展的浏览器以释放原生启动器，并在任务管理器中结束该 PID 对应的 Host。重新运行 `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/install-dev-host.ps1` 编译并更新启动器，再打开浏览器、重新加载扩展。下一次连接启动新版 Host；打开 Polarion 文档后在诊断页核对实际版本。**更新源码或 tag 不会自动替换正在运行的 Host 与扩展。**

<details>
<summary><strong>连接检查与卸载</strong></summary>

| 现象 | 检查位置 |
|---|---|
| Host 无法连接 | `diagnostics.html`；项目专用 Node、`dist/host` 构建与当前用户 Native Messaging 注册 |
| 扩展与 Host 版本不同 | 浏览器实际加载目录与运行中的 Host；完成重启和扩展重载后再核对 |
| Claude 无法启动 | `./.runtime/node-v24.22.2-win-x64/node.exe scripts/diagnose-install.mjs --check-cli --strict`；另检查 CLI 认证状态，特殊目录用安装器 `-ClaudePath` 指向实际 exe/js |
| 打开工作台提示 `POLARION_WORKER_STOPPED` 或凭据缺失 | 打开设置 → Polarion 账号，输入自己的账号密码，点击“保存并连接”。缺少凭据的提示提供“配置 Polarion 账号”入口。浏览器登录和 Codex 登录不会自动配置此凭据 |
| 检查凭据 | 运行 `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/start-polarion-worker.ps1 -ValidateOnly`；`configured` 和 `decryptable` 为 `true` 仅说明本机可解密，不验证账号或网络。自定义文件加 `-CredentialPath`，并确保与安装器配置一致 |
| 需求总览读取失败 | 先点总览右上角刷新；仍失败时确认账号可读取该文档，或换一篇文档排除单文档权限问题 |
| 原生保存适配不匹配 | 当前 Polarion 版本/构建；见[免刷新保存验收记录](docs/整体精修与富文本验收_20261104.md) |

Host 注册名为 `com.nanju.polarion.sidebar`。扩展身份来自 `apps/extension/identity.json` 的公钥，不应在更新时随意重新生成。

凭据文件已存在时配置脚本会拒绝覆盖。若确认需要替换本工具的凭据，可在配置命令末尾加 `-Replace`；原加密文件会备份。若安装时指定了自定义 `-CredentialPath`，请对该路径配置并检查，或重新安装以选择所需路径；默认路径的配置不会覆盖自定义路径。

安装器支持 `-DataDirectory`、`-ClaudePath`、`-CredentialPath`，只记录在本工具的 launcher 配置，不修改全局环境。需要仅编译而不注册时使用 `-PrepareOnly`。首次安装、迁移和隔离验证的完整命令见[跨电脑安装验收](docs/跨电脑安装验收_20261104.md)。

例如 CLI 与兼容 DPAPI 文件都位于自定义位置时，先准备配置，再检查，最后注册；请换成自己实际存在的绝对路径：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/install-dev-host.ps1 -PrepareOnly -ClaudePath 'D:\Tools\Claude Code\claude.exe' -CredentialPath 'D:\Private\polarion-credentials.json'
./.runtime/node-v24.22.2-win-x64/node.exe scripts/diagnose-install.mjs --check-cli --strict
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/start-polarion-worker.ps1 -CredentialPath 'D:\Private\polarion-credentials.json' -ValidateOnly
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/install-dev-host.ps1
```

同一安装重复运行时会保留已有 launcher 参数。自定义 `-DataDirectory` 后，默认命令不会自动把已有凭据迁过去；请在该目录配置 `credentials.json`，或同时指定 `-CredentialPath`。

卸载时，先在浏览器中移除扩展，再运行 `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/uninstall-dev-host.ps1` 撤销当前安装的 Host 注册。脚本保留本地草稿、会话、应用专用凭据和已有 Polarion MCP 凭据。

</details>

## 验收与边界

以下为有记录的实测范围，不代表所有规划功能均已完成。最新记录优先于历史报告中的旧布局、旧计数和旧缺口描述。README 中的配图均为功能示意；真实页面截图仅保留在本地验收材料中，不作为公开配图。

| 验证范围 | 已有结果 | 证据 |
|---|---|---|
| 自动检查 | 305/305 本机自动测试；Host/Extension 类型检查与构建通过；发布提交另经 Windows CI | 本轮自检（2026-11-05） |
| 需求分析总览 | 真实 SWR 文档 258 项、24 个分组块、零重叠；长分组切块、扁平章多列、Ctrl+F、阅读预览→编辑工作台、编辑中隐藏/恢复通过 | [设计方案](docs/软件需求分析总览_设计方案_20261105.md) |
| @ 引用与阅读预览 | 中文紧邻 `@`、全量列表、弹窗内搜索、Esc/失焦/滚动关闭、插入原生引用、单击引用打开预览通过 | 本轮真实页面自检 |
| 变体管理 | 创建/链接、默认变体捕获、变体保存、接入/撤销、跨机发现、详细配置往返；并发刷新去重、默认捕获回滚、撤销入口修正由新增测试覆盖 | [变体管理](docs/变体管理_20261105.md) |
| 编辑器与保存 | TEST-728 真实编辑、保存、独立回读、原生正文同步；撤销修改后再次保存；受保护宏原样写回 | 本轮真实页面自检 |
| 设置与指令 | 字号 15/13 保存重开；临时指令创建、删除、保存重开确认消失；账号、存储和指令页签可用 | [设置与指令验收](docs/设置与指令验收_20261105.md) |
| 画板素材与模板 | 70 项素材十类加载、素材库打开；6 个整图模板预览与插入；吸附壳按真实边界；模板 ID/绑定重映射 | [画板对标与提升](docs/画板对标与提升_20261105.md) |
| Mermaid 与画板交互 | 真实页面粘贴导入、容器文字绑定、快速连接提示、`?` 单套帮助、复制图片到剪贴板通过 | 本轮真实页面自检 |
| Agent 对话 | 真实 Claude Code 回合“自检通过”完成；流式状态、回答操作、上下文与会话历史正常 | 本轮真实页面自检 |
| 单行布局与交互 | 5 个视口 × 3 组工具栏；具名容器、键盘、表格、查找、内容块等实测 | [同轮验收记录](docs/单行工具栏与原生排版验收_20261104.md) |
| 原生排版 | 新增正文、标题、整数 pt 字号及默认行高已核对；作者显式样式保留 | [排版结果与限制](docs/单行工具栏与原生排版验收_20261104.md) |
| 保存与连续编辑 | 隔离工作项真实保存、独立回读、原生显示；免重载、滚动保留、与原生交替保存通过 | [整体精修与保存验收](docs/整体精修与富文本验收_20261104.md) |
| Agent 与画板历史闭环 | Claude 修改草稿、人工确认写回；画板源文件与 PNG 回读及再编辑 | [S3 分阶段验证记录](docs/S3运行验证_20261103.md) |
| 跨目录首次安装 | 隔离 HOME/AppData、空缓存、C 盘中文空格目录，实际下载、构建、Native Messaging 启动与健康通信通过；未冒充第二台设备验收 | [安装证据与边界](docs/跨电脑安装验收_20261104.md) |
| Agent 复杂图 | 真实 Skill 调用、九节点分支回路、紧凑画幅、放大预览、人工修改、明确保存、源/PNG 独立回读与重开通过 | [图形验收](docs/Agent绘图与规范验收_20261104.md) |
| 回答密度与权限偏好 | 默认自动批准；字号 12–18px、取消回滚、保存重开和默认 13px 已在真实页面验证 | [Agent 与界面验收](docs/发布前Agent验收_20261104.md) |

**仍为 partial 或未验证：**

- **AI 整图生成：** `swimlane`、`sequence`、`class`、`er` 的 DSL、布局和校验由自动测试覆盖；长文本标签与动态行高已修复，但完整真实生成（含 6 类/6 实体密集关系）仍需逐类浏览器验收。
- **HTML 与 Office 兼容：** 任意旧 HTML、特殊宏、复杂 Office 粘贴和自定义段间距的像素一致性；服务端 HTML 保留不等于原生画面完全一致。
- **Codex：** 适配尚未接入，不属于本次可用能力；已有模型配置与会话保留。
- **外部 Agent 能力：** MCP URL 登录表单尚未接入；本机 Skills、MCP 和终端命令仅对逐项实际执行的路径给出通过结论，不能据目录发现推断全部可用。
- **完整能力对标：** 电子表格工作簿、公式、筛选、冻结行列、多视图、多人实时协作，以及完整飞书文档/画板功能。
- **环境与规模：** 其他 Polarion 构建、三浏览器完整矩阵、大文档和复杂画板的完整性能目标。
- **工程系统覆盖：** 完整文档编排、全部 V 模型操作、字段、追踪与工作流等规划能力。当前属性入口仍使用 Polarion 原生界面。

[CI](https://github.com/suzike-dev/polarion-super-sidebar/actions) 执行无业务凭据的检查、测试与构建。真实登录态、Agent 账号、服务端写回和原生交互需单独验证。

## 文档与维护

| 阅读目的 | 入口 |
|---|---|
| 看需求总览的设计与边界 | [软件需求分析总览](docs/软件需求分析总览_设计方案_20261105.md) |
| 看变体、设置与指令 | [变体管理](docs/变体管理_20261105.md) · [设置与指令验收](docs/设置与指令验收_20261105.md) |
| 看画板对标 | [画板对标与提升](docs/画板对标与提升_20261105.md) |
| 看本轮交互与原生差异 | [单行工具栏与原生排版](docs/单行工具栏与原生排版验收_20261104.md) · [整体精修与免刷新保存](docs/整体精修与富文本验收_20261104.md) |
| 追溯保存修复 | [原生 HTML 写回](docs/v0.2.5原生HTML写回修复.md) · [大型 LiveDoc 保存](docs/v0.2.6大文档保存修复.md) |
| 理解规划与实施 | [功能规格](docs/Polarion超级侧边栏_功能规格_v0.1.md) · [编辑工作台规格](docs/编辑工作台对标与交付规格_v0.3.md) · [开发进度](docs/开发进度.md) |
| 安装、复现与发布 | [变更记录](CHANGELOG.md) · [版本管理](docs/VERSIONING.md) · [GitHub Releases](https://github.com/suzike-dev/polarion-super-sidebar/releases) |

由 Nanju 维护。私有工程仓库，未授予项目整体的开源许可。第三方源码沿用各自许可证：SOAP 适配器见 [UPSTREAM](packages/polarion-soap/UPSTREAM.md)；Diagram Design 见[固定来源与原文校验](resources/diagram-design/README.md)和 [MIT 许可证](resources/diagram-design/LICENSE)。历史规格包含规划能力，实施状态以对应验收报告为准。
