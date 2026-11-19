# 交接 02：富文本编辑器全面升级 + Simulink 模型关联（v0.13.0 工作树）

- 交接时间：2026-11-19
- 状态：**已停工**（总负责人决定改为单会话开发）。工作树保留，未提交、未打 tag、未发布，未唤醒其他会话。
- 版本号已改为 0.13.0（package.json / apps/extension/wxt.config.ts / apps/host/service.ts health），仅为工作树状态，未发版。

## 一、最初目标（用户原话，保留关键段落）

> 富文本编辑器能力偏弱，出来的工作项排版，美化，布局，还有富文本能力都不太行，需要全面升级，这块你可以对标顶级的markdown工具，飞书文档，飞书表格等能力和亮点功能，全面提升，另外我期望每个项目的需求可以单独关联本地的simulink控制模型，接口表和数据字典（这一块你可以去我本地 D 盘里的 SVN，里面有对应的项目，比如 BE14 这个项目，你可以看他的模型文件里面，我期望关联的是最外层的这个整个项目模型文件。它里面包括十几个模块，每个模块里面都有模型、数据、字典，还有结果表和代码），这样，我如果需要模型跟需求进行关联的时候，就不用每次都给你指定模型在哪儿了，而且，因为模型分的是十几个模块，每个模块实现的功能不一样，在模型里对应的工作项可能也不一样：有些工作项在这个模块里实现，有的在其他模块里实现，也有的可能是跨模块实现的。

> 在这种情况下，我期望能为每一个工作项增加一个备注功能，用来备注该工作项是在对应模型的哪个模块实现的。并且这个备注支持多选，因为它可能是跨模块实现的。但是关联不是目的。关联主要是为了，比如我可以通过模型文件反向去优化或者细化我的需求，也可以基于需求跟我的模型进行一致性审查，这用处就多了，知识库这一块的关联，我感觉不用特意关联，因为 Claude Code 或者 Codex 已经装了 Obsidian MCP 这个工具，就可以直接读我本地的知识库了，所以第一阶段，咱们先做我上面提到的这些功能吧。

> 你先全局思考一下，看做成什么样子，不要瞎做。做完以后，要真正考虑到各种工程使用场景，保证这个功能在各种场景下都能用，而不是说只有在特定场景下才能用。

## 二、追加 / 修改与最终目标

1. 会话中追加：**"开发完了就多维度多使用场景测试，没问题就先结束，不要着急发版"**（因此没有发布动作）。
2. 会话最终指令：改为总负责人单会话开发，**立即停止原任务与一切构建/部署/浏览器操作**，只写本交接文档。
3. 最终目标（第一阶段范围）：
   - 编辑器：对标顶级 Markdown 工具/飞书文档，补齐排版、美化、布局与富文本能力，且写回 Polarion 仍为无损 HTML、原生视图可降级阅读。
   - 模型关联：项目级绑定本地 SVN 模型根目录（如 BE14 `D:\Work\SVN\45-SPE25-BQ1-TM-002\04_Software\04_ASW_Code\ModelandCode`，内含约 20 个模块目录，每模块模型/字典/接口表）；工作项级"实现模块"**多选**备注；支持按模块反查需求、需求↔模型一致性审查；知识库不接入（已有 Obsidian MCP）。

## 三、已做到哪一步（按代码路径）

### A. 富文本编辑器升级

核心包（packages/core）：
- `rich-schema.ts`：新增 `formula` / `formulaInline`（KaTeX，存 `data-tex`，块级 div / 行内 span）、`details` / `detailsSummary`（原生 `<details>`）；`calloutTones` 增加 `danger`；新增 `MarkdownInputs`（`- [ ] ` 待办、`==高亮==`）与 `MarkdownEnter`（`|a|b|` 回车建表、`$$..$$` 回车成块公式、行内 `$..$` 以 `$` 收尾成行内公式，数字开头/美元金额不触发）；全部节点带 `sid` 锚点。
- `rich-document.ts`：解析 `div/span[data-sidebar-formula]` 与 `details/summary`；序列化新增公式特例（`INVALID_FORMULA` 校验空/超 4000 字符）与 `details` 的 `open` 属性；`freshTags` 增加 details/detailsSummary；`detailsSummary` 走 inline 渲染；新增 `textContent` 辅助。未改动节点仍原始字节回写（无损）。
- `document-presentation.ts`：新增 details/detailsSummary 便携默认样式。
- `markdown-io.ts`（新）：`looksLikeMarkdown` 启发式判定；`markdownToHtml`（marked）支持标题/表格/列表/任务/代码/链接，转换 `==高亮==`、行内/块级公式，危险协议 `javascript:` 等中和。
- `code-highlight.ts`（新）：lowlight(v2) + 注册 MATLAB/Verilog/VHDL/TCL；`highlightToHtml`、`highlightLanguages`、统一森林色 `highlightThemeCss`。渲染层专属，存储仍是纯 `<code>`。
- `document-tidy.ts`（新）：表格预设 `plain / threeLine / zebra / minimal`、`applyTablePreset`、`tidyDocument`（首尾及连续空段清理、超宽图片限宽 1200px、无边框表补默认样式）、`tablePresetLabels`。
- 测试新增：`rich-formula.test.ts`（6 项）、`markdown-io.test.ts`（4 项）、`document-tidy.test.ts`（4 项），均通过。

扩展端：
- `apps/extension/lib/editor-rich.ts`（新）：KaTeX 公式 NodeView（双击弹 TeX 编辑框，Enter 提交/Esc 取消）、`withFormulaViews()`（通过 `extension.extend({addNodeView})` 挂载——**注意：nodeViews 放在 editorProps 里不生效，已改为该方式**）、代码块高亮装饰插件（按 hast 类名计算行内 offset）。
- `apps/extension/ui/DraftEditor.tsx`：接入 `withFormulaViews`、Markdown 粘贴分支（在 TSV 表格分支后）、公式弹窗与状态、折叠块/徽章/表格样式预设/一键排版整理工具栏按钮、挂载 `ModuleNotePanel`。
- `apps/extension/ui/RichSurface.tsx`：预览图片点击灯箱（Esc/遮罩关闭）；`rich-preview.ts` 允许 details/summary/formula 等标签与属性，预览内注入代码高亮与 KaTeX(MathML)，补 details/任务列表/灯箱样式。
- `apps/extension/ui/AssistantMarkdown.tsx`：`remark-math` + `rehype-katex` + 代码高亮（AI 回答三处统一）。
- `apps/extension/ui/EditorDocTools.tsx`：斜杠命令新增危险提示块、折叠块、公式。
- `apps/extension/ui/FormatProperties.tsx`：提示色块四色（新增危险）。
- CSS：`rich-editor.css`、`rich-surface.css` 追加新样式；`workbench.content.tsx` 引入 `model-workbench.css` 与 `katex/dist/katex.min.css`。

### B. Simulink 模型关联（第一阶段）

- `packages/protocol/index.ts`：新增 `ModelModuleSchema`、`ModelRootSchema`、`ModelNoteMarkSchema`、`ModelNoteSchema`、`emptyModelNote()`；命令 `model.roots`、`model.roots.save`、`model.roots.scan`、`model.note.read`、`model.note.write`、`model.index.sync`、`model.trace.view`；视图类型 `ModelRootsView / ModelIndexView / ModelScanView / ModelTraceGroup / ModelTraceView`。
- `apps/host/model.ts`（新）：
  - `scanModelRoot(path)`：绝对路径校验；递归深度 ≤3；跳过 `.svn/.git/node_modules/build/bin/slprj` 等；按 `.slx/.mdl` 所在目录合并模块（Harness 合并进模块）；同目录 `<模块>_DD.sldd` / `_DD.xlsx` 关联为字典/接口表；识别 `.prj`；根级 `03_Data/*.sldd` 为公共字典；kind 分类 `module/integration/library/test/other`，library/test 默认 `excluded`；上限 500 模块/800 模型；错误码 `MODEL_ROOT_NOT_FOUND / NOT_DIRECTORY / NO_MODELS / TOO_MANY_MODELS`。
  - `Model` 类：`roots()`（Polarion `PSB-MODEL` 工作项 + gzip 附件 `sidebar-model.roots.json`，缓存兜底）、`rootsSave()`（冲突 `MODEL_ROOTS_CONFLICT`，沿用 typeCandidates 回退）、`noteRead/noteWrite()`（工作项附件 `sidebar-model.json`，回读校验）、`indexSync()`（`model.notes` 批量分页 → 本机 `model-index`）、`traceView()`（按模块分组/未标注/零需求）。
  - `modelContextDigest(store, projectId)`：会话注入摘要（根目录、前 40 模块、字典/接口表、各模块已关联需求数、覆盖计数）。
- `apps/host/polarion-worker.ts`：新增 `model.note.read` / `model.note.write`（附件白名单 `sidebar-model.json`，写后回读逐字比对）与 `model.notes`（分页查询工作项，只对带 `sidebar-model.json` 的附件取内容，最多 30 页，partial 标记）；`change.write` 附件白名单新增 `sidebar-model.roots.json`。
- `apps/host/polarion.ts`：Remote 接口与 `Polarion` 类新增 `modelNoteRead/modelNoteWrite/modelNotes`。
- `apps/host/service.ts`：接入 `Model` 字段与 7 个 case；`model.roots.scan` 直接调 `scanModelRoot`。
- `apps/host/engine.ts`：新增 MCP 工具 `model_trace`（action: overview / requirements / note_read / note_write），加入 ownNames；`enginePrompt(...)` 追加 `modelContextDigest`。
- `apps/host/prompt.ts`：`enginePrompt` 新增第 6 参数 `modelContext` 与 `modelBlock` 注入（明确告诉 AI 不要追问模型位置）。
- `apps/host/editor-capabilities.ts`：`EDITOR_TOOL_NAMES` 与描述加入 `model_trace`（契约测试要求）。
- `apps/host/model.test.ts`：存在且 3/3 通过（扫描、错误码、摘要）。

扩展端 UI：
- `apps/extension/ui/ModelWorkbench.tsx`（新）+ `model-workbench.css`（新）：绑定目录（`dialog.pickFolder` + `model.roots.scan`）、重扫 diff（新增/消失模块，消失模块备注保留）、模块勾选纳入/排除、保存配置、同步需求备注、按模块分组展开需求、未标注清单、零需求模块高亮。
- `apps/extension/ui/ModuleNotePanel.tsx`（新）：工作项「实现模块」chips + 多选面板（按 root 分组，支持跨模块多选、搜索、清除、保存），挂载在 `WorkItemReader.tsx` 与 `DraftEditor.tsx`（变体编辑时不显示）。
- `apps/extension/ui/App.tsx`：`model` 覆盖层状态、头部 Boxes 按钮、`toggleModel`、三个大工作台互斥、路由切换与进入编辑时收起/恢复。
- `apps/extension/entrypoints/workbench.content.tsx`：引入新 CSS 与 KaTeX CSS。

### C. 文档与版本

- `CHANGELOG.md`：新增 `[0.13.0] - 2026-11-19` 条目（模型关联 + 编辑器升级 + 验证摘要）。
- `README.md`：版本徽章与导语改为 0.13.0；新增「需求 ↔ Simulink 模型：绑定一次，处处可用」「富文本升级：Markdown 输入、公式与表格样式」两节；验收表新增模型关联与富文本两行；边界补充模型深度与公式/折叠块兼容说明。
- 依赖新增：`marked@16`、`katex@0.16`、`lowlight@2`、`@types/lowlight@2`、`remark-math@6`、`rehype-katex@7`。

## 四、实测 / 未测清单

### 已实测（自动）
- `npm test`：**442/442 通过**（含本批新增公式无损往返 6、Markdown 转换 4、表格预设/排版 4、模型扫描与摘要 3）。
- `npm run check:host`：通过（并行会话收敛后）。
- `npm run build:host`：通过。
- `npm run build:extension`：通过；确认产物含 `chunks/katex-*.js`，KaTeX 字体以 base64 内联进 `content-scripts/workbench.css`（Shadow DOM 可用）。
- `scanModelRoot` 对真实 BE14 `ModelandCode` 目录手测：33 个 `.slx` → 21 个模块；逐模块字典/接口表正确；`Model_Plat.prj` 与 `03_Data/TMS_DataType.sldd` 识别；`00_TMS_Lib`、`01_UnitTest`、`04_Test/01_Simu` 自动排除；`19_IntegrateMode` 判为 integration。

### 未实测（必须补）
- **真实浏览器全功能**（本轮最大缺口）：模型工作台打开/绑定目录（原生选择框）/重扫/保存/同步/追溯展开；工作项备注多选保存与回读、多人并发；编辑器内公式渲染与双击编辑、Markdown 快捷输入与粘贴、代码高亮、折叠块、表格四预设、徽章、排版整理、灯箱；AI 回答公式渲染；`model_trace` 在实际会话中的调用与注入摘要效果。
- 保存链路的端到端：新节点（公式/折叠块）写入 Polarion 后原生视图显示、回读等价、原生页面刷新。
- 历史文档兼容：含宏/未知结构的旧工作项打开编辑器无回归（rich-document 直写字节路径未破坏，但未用真实旧文档逐项走查）。

## 五、阻塞与下一具体动作

1. **构建/类型检查阻塞（当前第一优先）**：`npm run build:extension` 重新生成了 `apps/extension/.wxt/tsconfig.json`，其中 `noUncheckedIndexedAccess: true`，导致 `npm run check:extension` 现在报出 `packages/core/block-ops.ts` 等既有文件的索引访问错误（如 `richSchema.nodes.heading` possibly undefined）。这不是本批新逻辑引入，但会卡发布门槛。下一步：跑一次完整 `check:extension` 收齐错误清单，统一用收窄断言（`!`）或局部类型修正；或与总负责人确认是否在 wxt 生成配置中关闭该选项。
2. **NodeView 修复尚未复验**：`withFormulaViews()` 改动发生在停工前最后一次类型检查中途，尚未重新跑 `check:extension` / `build:extension` / 浏览器确认公式渲染。下一步：先修第 1 项，再构建并做一次编辑器冒烟（插入公式→显示排版→双击改 TeX→保存→预览）。
3. **Host 新命令需重建并重启**：`model.*` 命令与 `model_trace` 工具加入后必须 `npm run build:host` 并重启 Host 进程（旧进程可能杀不掉，注意端口/子进程），否则扩展侧调用返回旧错误（如 `invalid_union`）。
4. **浏览器验收**：按既有开发环加载 `spikes/extension`，重载扩展需新页 + 双刷新；先做模型工作台空态→绑定真实 BE14 目录→标注一个测试工作项→同步→追溯，再逐项走编辑器新能力；测试后清理测试工作项与本地草稿。
5. **残余风险（建议下一轮评估）**：`markdownToHtml` 未主动剥离原始 HTML 中的 `script/iframe`，目前依赖 PMParser 只按 schema 映射（不会执行），建议在 `markdown-io.ts` 增加显式标签剥离并补测试；`MarkdownEnter` 在 IME 组合输入、段落中间回车的行为仅按逻辑规避，未实测。

## 六、共享文件改动（与并行会话重叠，务必先合并/比对）

本会话直接修改、且并行会话也在改动的文件：
- `packages/protocol/index.ts`（模型 schema、命令、视图类型）
- `packages/core/rich-schema.ts`、`packages/core/rich-document.ts`、`packages/core/document-presentation.ts`
- `apps/extension/ui/App.tsx`、`apps/extension/ui/DraftEditor.tsx`、`apps/extension/ui/editor-toolbar.css` 相关（未改该 CSS）
- `apps/extension/entrypoints/workbench.content.tsx`
- `apps/host/service.ts`、`apps/host/engine.ts`、`apps/host/polarion.ts`、`apps/host/polarion-worker.ts`、`apps/host/editor-capabilities.ts`
- `package.json`（版本 + 依赖）、`package-lock.json`（新增依赖）
- `README.md`、`CHANGELOG.md`

本会话新增、无重叠的独立文件：
- `packages/core/markdown-io.ts`、`code-highlight.ts`、`document-tidy.ts` 及三个对应测试
- `apps/host/model.ts`、`apps/host/model.test.ts`（test 由并行会话补写）
- `apps/extension/lib/editor-rich.ts`、`apps/extension/ui/ModelWorkbench.tsx`、`ModelNotePanel.tsx`、`model-workbench.css`

注意：停工前工作树有 58+ 个文件处于未提交修改（并行会话的 workflow / quality-lint / board / session-events 等），本会话未提交任何内容；`DraftEditor.tsx` 曾被并行会话多次改写，最终改动以工作树为准。

## 七、给接手者的最短路径

1. `git status` + `git diff` 比对上述共享文件，确认并行会话改动已收敛。
2. 修 `.wxt/tsconfig.json` 引出的 `check:extension` 错误 → 两端 tsc → 两端 build。
3. `build:host` 后重启 Host，按第 5 节第 4 条做真实浏览器验收（模型流程 + 编辑器新能力）。
4. 全绿后再由总负责人决定是否发布；**本会话未做且不得补做的动作：commit、tag、GitHub Release、唤醒其他会话**。
