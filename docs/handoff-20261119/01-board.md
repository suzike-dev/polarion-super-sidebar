# 画板能力与美化交接（2026-11-19）

> 交接背景：用户决定改为**总负责人单会话开发**，本会话（画板会话）立即停工。
> 本文档只做交接，不含任何产品代码改动。工作树原样保留，未提交、未部署、未发布。

---

## 1. 最初目标（用户原话）

> 「绘图能力有点太差，出来的图一点也不好看，功能少，无论是排版布局，美化，配色都差远了，你看一下我本地的绘图技能,叫做 `$archify`，它出图的效果非常好，我期望我们参考它的配图审美，结构和逻辑，全面提升画板的能力和功能点，另外 AI 出来的画板图每次插入 Polarion 工作项都是插在最前边，没法插入指定位置，这块也同步修复了」

拆成两件事：

1. **对标 archify 全面提升画板**：审美（排版/美化/配色）、结构（图种与语义体系）、功能点。
2. **修复插入位置**：AI 生成的画板图总是插在工作项最前面，无法插入指定位置。

调研结论（已确认）：
- archify 的设计语言 = 小 JSON 规范 → 布局引擎 → 语义化 SVG/HTML；核心是**每类元素一个独立色相（淡染填充 + 中饱和描边）、双层文字、边界框、边变体、结论卡片、右上 eyebrow**。
- 我们原实现只有 `tone: neutral|accent` 两档、全部白框 + 单一蓝灰，archify 的语义类型系统完全没接进来 —— 这是「不好看」的根因。
- 「插在最前」的根因：需求配图会**自动**打开草稿 + 画板（`DraftEditor.tsx` 的 `requestedBoard` effect），此时编辑器刚挂载、光标从未被用户设置，bookmark = 文档开头（位置 0），插入自然落在最前。

## 2. 追加与删改（按时间顺序，保留原话）

| 轮次 | 用户原话 | 处理结果 |
| --- | --- | --- |
| 追加 1 | 「跟 `$archify` 比较还是有很多不足，继续优化美化」 | 第二轮美化：六色相类型色板、节点类型圆点、分组胶囊、图例/图注 footer、emphasis 边圆点起点、时序参与者类型色、`placeLabel` 取消强制大写 |
| 追加 2 | 「绘图时我期望尽量横向长度绘图，优先使用横向空间，避免高度拉的太长，否则不容易在一屏上看全貌图」 | **横向优先**：`direction` 省略时默认 `right`；auto 画幅优先 wide（1280×720）；分层列距 104 给边标签留段长；退火代价新增「rank 方向一致性」罚；router 新增同侧端口变体让回边走外环 |
| 追加 3 | 「但是你线条的流向和链接有点乱哦」 | 定位两处：① 连线贴着分组框虚线平行走 ② 分组聚拢把**跨层**成员拉成同列，导致主线被迫 U 形绕行。修复：组框内边距 20→28（顶部 36→44）；`groupPairs` 只对**同 rank** 成员生效；rank 方向罚 6000→9000 |
| 追加 4 | 「继续美化」 | 第三轮：时序图激活条 + 生命线虚线、图种标签回归右上角（`kind-tag`，零垂直占用）、图例形态化（边类型用线段样例）、泳道交替底色、类图/ER 标题栏底色、**节点宽度按文字内容自适应**、**画幅高度按内容收缩**（仅 `size=auto`） |
| 追加 5 | 「逻辑框图，架构图，原理图，流程图，算法原理图等等呢」 | 新增两个图种：**`architecture`（架构图专称，类型化组件 + 边界分组）**、**`tree`（层级图/功能分解，总线式树，单根无环，禁止连线标签）**；并在工具描述、`boards.ts` limits、`POLARION-ADAPTER.md` 写入「需求说法 → 图种」映射表 |
| 追加 6 | 「逻辑框图，架构图，原理图，流程图，算法原理图等等呢这些能力增加了？」 | 已答复：能力已增加（代码 + 测试完成），但**AI 生成侧尚未重建 Host，用户实际用到的仍是旧渲染**，详见第 5 节 |

最终目标（收敛后）：**画板出一张「专业工程配图」水准的可编辑图** —— 横向一屏、语义配色、语义文字层级、干净正交走线、带图例图注，且能插入正文指定位置。

## 3. 已做到哪一步

### 3.1 代码路径（本会话改动，全部未提交）

**画板专属文件（可安全继续改）**

| 文件 | 改动要点 |
| --- | --- |
| `packages/core/board-generation.ts` | 核心。六色相 `BOARD_NODE_TYPES`（process/data/user/external/security/focal）、`BOARD_ACCENT='#2f6f4f'`、`BOARD_ACCENT_TINT`、`KIND_LABELS`；节点 `type`/`sub` 字段与两级文字渲染 + 类型圆点 `node-dot`；边 `variant`（solid/dashed/emphasis，emphasis 为深绿加粗 + `dot` 起点）；`groups` 虚线边界 + 白底胶囊 `group-chip`；右上角 `kind-tag`；左下 `summary-note`、右下紧凑图例（`legend-item`/`legend-swatch`，边类型用 `line` 线段样例）；`kind=state` 状态机（实心圆起始/双环终态/胶囊，禁自环）；`kind=tree` 总线式层级（单根、边数 = 节点数-1、禁止连线标签）；`kind=architecture` 走 flow 管线；**横向优先**（`direction` 默认 right、frames 优先 wide）；**内容自适应节点宽度** `measureNodes()`；**画幅收缩** `settleFrame()`（仅 auto，下限 480）；预算 nodes 12 / edges 16 / focal 2 / states 8 / transitions 16 / groups 4；`renderFlowNodes()` 共享渲染器 |
| `packages/core/board-routing.ts` | `placeLabel` 取消英文强制大写（保留模型原文）；`preferredSides` 新增 variant 4–7 的**同侧端口**（回边走整齐外环），`attempt % 8` 覆盖 8 种变体 |
| `packages/core/board-interactions.ts` | 新增 `applyNodeType(elements, ids, type)`：给选中形状刷语义类型色，锁定元素（canvas/legend）不重涂 |
| `resources/diagram-design/POLARION-ADAPTER.md` | 写入类型角色映射、边变体语义、分组胶囊、图例自动、state/tree 规则、横向优先、图种路由 |

**画板 UI**

| 文件 | 改动要点 |
| --- | --- |
| `apps/extension/entrypoints/board/main.tsx` | 选中形状时显示「类型色」色板工具条（`applySelectionNodeType`）；`selectedKinds` 增加 `shape` |
| `apps/extension/ui/DraftEditor.tsx` | **插入位置修复**：`hasUserSelection`（点击/键盘置位）→ `openBoard` 记 `manual` → 手动打开时插光标处，否则进入**放置模式**（`pendingBoard` 提示条 + `handleClick` 在点击处插入 + 「插入到末尾 / 插入到开头」快捷按钮 + 插入后选中并滚动） |
| `apps/extension/ui/compact-workspace.css` | `.board-placement` 提示条样式（深绿左边框） |

**AI 工具与文档**

| 文件 | 改动要点 |
| --- | --- |
| `apps/host/board-tools.ts` | `propose_board_generation` 描述重写：新字段（type/sub/variant/groups/legend/states/transitions）、图种映射表（流程/架构/逻辑框图/原理图/算法原理图 → flow/architecture；组织结构/功能分解 → tree）、横向优先指引、预算更新 |
| `apps/host/boards.ts` | `readGenerationForRun` 的 `limits` 英文文本同步（12/16、type/sub、groups、tree/state、横向优先） |

**新增 spike（untracked，仅验收用，可保留或删除）**

- `spikes/board-preview/index.html`、`main.tsx`、`app.js`、`app.css`、`*.woff2`
- 独立渲染页，用真实 Excalidraw 渲染 8 个用例并导出 PNG；`app.js` 是 esbuild 产物（IIFE，因 `file://` 禁 ESM；字体用 `--loader:.woff2=file`）

### 3.2 已实测通过

- **单测**：`packages/core/board-generation.test.ts` 39 个全过；board 三件套（generation/routing/interactions）53 个全过。新增用例覆盖：语义类型色、副标签、边变体、分组帧与胶囊、图例与图注、状态机（形状/校验）、tree（布局/单根/环/禁止标签）、architecture（kind-tag + 分组 + 类型色）、横向优先（默认 right、显式 down 仍纵向）、12/16 预算。
- **类型检查**：`tsc --noEmit`（host）与 `-p apps/extension/tsconfig.json` 对**本会话改动文件**全过（另有报错均来自并行会话的 untracked 文件：`editor-rich.ts`、`code-highlight.ts`）。
- **真实浏览器渲染**（spike 页 + ego-browser 截图 + 图像复核）：
  - 语义流程图：六色可辨、两级文字、类型圆点、分组胶囊、图例、图注、主路径深绿加粗带圆点；
  - 架构图：5 列一行、四条边全为**水平直线**、分组胶囊、图例线段样例、右上「架构图」标签、画幅无死白；
  - 层级图：单根在左、三个子节点堆叠、孙节点更右、总线折线正交、类型色与图例正确；
  - 状态机：横向左起实心点 → 胶囊 → 右端双环终态，转移线正交带白底标签；
  - 泳道/时序/类图/ER：早期整页截图结构正确（v3 的激活条/图例线段/类图标题栏**未做逐项近景复核**）。

### 3.3 未测（必须补）

1. **AI 生成链路**：`propose_board_generation` 走 Host 侧 `generateBoardDiagram`，**必须 `npm run build:host` + 重启 Host 进程**才会用上新渲染。本会话未做（并行会话正在改 `engine.ts`/`service.ts`/`editor-capabilities.ts`，重建会打包其中间态）。
2. **真实 Polarion 环境**：插入位置放置模式（点击正文插入 / 末尾 / 开头）、插入后选中滚动、类型色工具条，**只做了类型检查，未在真实文档里操作过**。按项目验收标准「每项功能须在真实浏览器亲手走通且可见」尚未达标。
3. **全量测试**：一次全量 430/431，唯一失败 `capability tool is read-only...`（`apps/host/editor-capabilities.test.ts`）属并行会话中间态，非画板改动。
4. v3 新增视觉项（时序激活条、泳道交替底色、类/ER 标题栏、图例线段）未逐项近景验收。

## 4. 阻塞与下一具体动作

### 阻塞

1. **Host 未重建重启**（上表第 1 项）：并行会话占用 host 构建，且旧 Host 进程可能杀不掉（见项目记忆 `polarion-detached-host-server-pitfall`）。
2. **工作树强耦合**：`git status` 有 40+ 个并行会话未提交改动，画板文件与共享文件混在一起，暂不能安全提交。
3. **一次 `git stash` / `git stash pop` 插曲**：早期为判断失败用例是否既有问题，做过一次 stash+pop（已成功恢复，工作树未丢改动），但期间并行会话改动被短暂移出。若发现异常丢失，优先查 stash 记录 `9fcef109`。

### 下一具体动作（建议顺序）

1. 单会话开发者接管后，先确认宿主与工作树：`npm run check:host`、`npm run check:extension`，把并行会话遗留的 ts 错误（`editor-rich.ts`、`code-highlight.ts`）清掉。
2. `npm run build:host`，确认旧 Host 进程已退出（`polarion-worker` / bridge 双查），再启动新 Host。
3. 真实 Polarion 里跑六图种 AI 生成：flow / architecture / tree / state / swimlane / sequence / class / er 各一张，肉眼验收横向一屏、类型色、图例、走线。
4. 真实文档编辑器验插入位置：AI 配图 → 放置提示条 → 点击正文中间插入；再测「插入到末尾 / 开头」；再测手工打开画板（应先点过正文）应直接插光标处。
5. 选中形状验类型色工具条（6 个色点，锁定元素不重涂）。
6. 全量 `npm test`，把 `editor-capabilities` 失败修掉或确认归属。
7. 通过后再谈提交；提交时把画板改动与并行会话改动**分开**暂存。

## 5. 共享文件改动（与其他会话有交叉风险）

| 文件 | 本会话改了什么 | 风险 |
| --- | --- | --- |
| `apps/extension/ui/DraftEditor.tsx` | 放置模式（`hasUserSelection`/`pendingBoard`/`placeBoard`/`handleClick`/`handleKeyDown` 置位/提示条 JSX/`finishBoardInsert`） | **高**。该文件被并行会话同时修改（富文本/图片/块编辑），合并时逐段核对，尤其 `editorProps` 与 `onSelectionUpdate` |
| `apps/extension/ui/compact-workspace.css` | 仅新增 `.board-placement` 一条规则 | 低（纯追加） |
| `apps/host/board-tools.ts`、`apps/host/boards.ts` | 画板工具描述与 limits 文本 | 中。host 目录并行会话在动，重建 Host 前先确认这些描述未被覆盖 |
| `packages/core/board-*.ts` | 画板核心 | 低（画板专属），但 `board-interactions.ts` 新增了对 `board-generation.ts` 的 import（`BOARD_NODE_TYPES`），形成模块依赖，改色板要同步两处使用者 |
| `resources/diagram-design/POLARION-ADAPTER.md` | 追加说明段落 | 低。注意上游 `skill/` 资源是 sha256 锁定的，**只能改 adapter/profile，不能改 skill 原文件** |

### 验收脚手架（可复用）

- 重新构建：`cd spikes/board-preview && npx esbuild main.tsx --bundle --format=iife --outfile=app.js --jsx=automatic --conditions=production,browser --loader:.woff2=file --loader:.woff=file`
- 打开：`file:///E:/Agentic_Engineering/Codex/Polarion%20%E8%B6%85%E7%BA%A7%E4%BE%A7%E8%BE%B9%E6%A0%8F%E5%B7%A5%E5%85%B7%E5%BC%80%E5%8F%91/spikes/board-preview/index.html`
- ego-browser 脚本：`C:\Users\Lenovo\ego\board-preview-20261119\round-01.mjs`（整页）、`round-07.mjs`（架构图/层级图近景）

---

**停工状态**：本会话已停止一切构建、部署、浏览器操作与代码改动；工作树原样保留（含上述未提交改动与 untracked 的 spike 目录），未提交、未发布、未唤醒其他会话。
