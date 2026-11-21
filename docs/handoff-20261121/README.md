# 交接文档 · 2026-11-21 批次（AI 初关联重构 + 平台模块目录 + 主题系统 + 全量令牌化）

> 交接人：总负责人会话。下一站：用户将转另一个会话做**全功能检查**。
> 工作树基线：v0.13.1（HEAD=667e16a）+ 11-20 晚批次（未提交）+ 本批次（未提交）。全程未提交、未发版。

---

## 一、本批次交付内容

### 1. AI 初关联重构（用户诉求：先懂模型再读需求，不许盲猜）
- `apps/host/model.ts` `autolinkPrompt()` 重写为**三阶段流程**：
  - 阶段一：`model_trace(action=overview)` 通览全部模块 + `action=requirements` 看重点模块已关联样例 → 归纳「模块职责表」，未形成职责表不许进入下一阶段
  - 阶段二：`peek_work_item` 逐条读**全部**待关联工作项正文（截断 1200→2400 字，`apps/host/polarion.ts:308` + `apps/host/editor-capabilities.ts` 工具描述已同步）
  - 阶段三：双向匹配（证据须来自两侧），可多模块；无证据不关联
- 返回值新增 `mode: 'models' | 'platform'`；错误文案改为引导「绑定模型目录**或**维护平台模块目录」
- 单测：`apps/host/model.test.ts` 12/12（含新平台目录测试）；全量 620/0 + app-runtime 37/37

### 2. 平台模块目录（需求先于模型的项目）
- **全局配置**：store key `model-platform-catalog`（id='global'），跨项目共用
- **哨兵根**：`PLATFORM_ROOT_ID = '00000000-0000-4000-8000-000000000001'`（UUID 格式过 schema）标签「平台模块」；`platformRoot()` 生成合成根
- **新 RPC**：`model.platform.get` / `model.platform.save`（协议+service+Model 类）；`model.roots.forNote`（ModuleNotePanel 专用标注视图：无配置根时返回平台兜底根）
- **联动改造**：`traceView` 无配置根（或索引含平台标注）时追加平台分组；`modelContextDigest` 同理兜底；「AI 初关联」「同步需求备注」按钮不再因无根目录禁用
- **UI**：ModelWorkbench 空态（无根目录项目）显示「维护平台模块目录」卡：textarea 一行一个 `名称｜key｜类型`（类型=功能模块/集成模型/库/测试），保存全局目录
- **边界**：平台卡只在**无配置根目录的项目**显示；有根项目行为不变（真机已验 ModelandCode_EPI 18 模块项目正常）

### 3. 主题系统（十套，默认深林绿保留）
- **机制**：`SettingsSchema.theme`（protocol enum 十值，默认 `'forest'`）→ App `activeTheme` 状态 → 根节点 `data-theme` 属性 → `ui/themes.css` 令牌组覆盖（特异性压过 `:host`）→ 全部界面统一变色
- **实时预览**：设置面板打开期间 `config.theme` 即时生效；取消（关闭不保存）自动还原；保存才持久化（与 assistantFontSize 同管线；App.tsx `toggleSettings` 与 `saveSettings` 两处 `setActiveTheme`）
- **十套**：forest 深林绿·默认（无覆盖块）/ porcelain 月白 / paper 宣纸 / bamboo 竹青 / autumn 秋香 / sky 天青 / tangerine 缇色 / rouge 詾脂 / indigo 黛青 / lotus 藕荷（后九套元数据 `ui/themes.ts`，色卡迷你预览用 swatch）
- **对比度硬规则**：正文对 surface ≥4.5:1、弱化文字 ≥3:1、按钮白字对 accent ≥4.5:1；青柠药丸与红/黄/绿语义色**全主题恒定**，状态语义不漂移

### 4. 全量令牌化清扫（主题「只变一部分」的根治）
- 用户真机反馈后执行：23 个组件 CSS + visual-polish 组件区共 **800+ 处硬编码色**收纳进令牌
- 深色语义色精确映射（accent/positive/warning/danger/info 全家）；浅色按色相/亮度分桶（绿系 L≥93.5→subtle / 88-93.5→hover / 82-88→line；暖黄→warning-soft；红→danger-soft；蓝紫→info-soft；中性灰与正文墨色保留）；聚焦边框绿→`color-mix(accent 38-42%, #fff)`
- **新增令牌**：`--ui-positive-soft/-ink`、`--ui-warning-soft/-ink`、`--ui-info-soft/-ink`、`--ui-hover/-press`（visual-polish `:host`）
- 变更对比 diff 红绿语义因语义令牌全主题恒定而不受影响
- **不走主题**：画板 board.html、诊断页（独立视觉身份）；需求总览的章色带 hsl(var(--h)) 是数据色（设计保留）

## 二、修改文件清单（本批次）
- Host：`apps/host/model.ts`（平台目录+两阶段提示词+trace/digest）、`polarion.ts`（peek 2400）、`service.ts`（3 个新 RPC handler）、`editor-capabilities.ts`（peek 描述）、`engine.ts`（model_trace 描述）
- 协议：`packages/protocol/index.ts`（SettingsSchema.theme、model.platform.get/save、model.roots.forNote）
- 扩展：`ui/themes.ts`、`ui/themes.css`（新文件）；`App.tsx`（activeTheme+data-theme）、`SettingsPanel.tsx`（主题色卡）、`settings-panel.css`（.sp-theme* 色卡样式）、`ModelWorkbench.tsx`（平台目录卡+按钮解禁）、`ModuleNotePanel.tsx`（forNote）、`model-workbench.css`（平台卡样式）、`visual-polish.css`（新令牌+动效+令牌化）、其余 22 个组件 CSS（令牌化清扫）
- 测试：`apps/host/model.test.ts`（+平台目录/两阶段测试）、`apps/host/store.test.ts`（settings 形状补 theme + useRequirementTemplates 字段）

## 三、验证状态
| 项 | 结果 |
|---|---|
| host tsc / extension tsc | 0 错误 |
| 全量测试 | 620 ✔ / 0 ✖（含 app-runtime 37/37）|
| 双端构建 | 通过；扩展已部署 `spikes/extension` |
| 真机·主题 | 10 套色卡渲染、天青切换→保存→重开持久化、取消还原、全部表面跟随（计算色验证）✓ |
| 真机·模型工作台 | 有根项目（ModelandCode_EPI）矩阵/巡检/按钮正常 ✓；AI 初关联/同步按钮无根时可用 ✓ |
| **真机·AI 初关联真实跑** | **未验**（会启动真 AI run 并写备注，留给全功能检查）|
| **真机·平台目录端到端** | **未验**（需无根目录项目实操，见下节清单）|
| 真机·模块备注面板 | RPC 层已由单测+新 Host 确认；编辑工作台内实测**未验** |

## 四、留给全功能检查的清单（建议顺序）
1. **主题**：十套逐一切换，重点看：各浮层工作台（总览/变更/模型/收件箱/驾驶舱/评审台/命令面板/阅读预览/经验沉淀/设置）+ 编辑工作台 chrome + 变量抽屉；每套主题下文字清晰度；保存/取消/重开三条路径
2. **平台模块目录端到端**：找一个无模型路径项目（如 SPE_TEST_001/test 等）打开模型关联工作台 → 应显示平台目录卡 → 维护目录（录几个真实平台模块）→ 同步需求备注 → 追溯矩阵出现「平台模块」分组 →（可选）AI 初关联真跑一轮，会话里检查是否先 overview 再逐条读需求
3. **AI 初关联真跑**（有根项目）：点 AI 初关联 → 观察会话过程符合三阶段 → 结果在模型工作台「同步需求备注」后矩阵可见 → 人工修正入口正常
4. **回归抽查**：编辑工作台（含模块备注角标）、变更管理、需求总览、提案收件箱、驾驶舱、命令面板（Ctrl+Shift+P）、阅读预览、经验沉淀、变体抽屉在默认主题下视觉无异常（CSS 大清扫后的回归面）
5. 老规矩：每项功能真实浏览器亲手走通且可见（DOM 存在≠可用）

## 五、并发会话注意事项（重要）
- **另一个会话正在同一工作树并行开发「需求模板插入」功能**（capture.content.ts 浮动按钮、App.tsx openTemplateEditor、SettingsSchema.useRequirementTemplates）。本会话已代为修正 store.test.ts 的 settings 形状断言（theme + useRequirementTemplates 两个字段并存）。**转会话后注意 git 状态可能继续变化，动手前先看 `git status`**
- **发布顺序铁律（本次踩坑）**：必须**先重建重启 Host、后重载扩展**。扩展先上而旧 Host 还活着 → 旧 Host 剥掉 settings 新字段（保存后回退默认）+ 新 RPC 不存在（模型备注读取报错，用户当场撞见）
- Host 重启：全杀 server.mjs / polarion-worker.mjs / native-bridge.mjs 三件套（孤儿 server 会挂起 RPC），然后刷新 Polarion 页让 Chrome 原生消息重拉全套
- 被自动化反复导航的 Polarion 标签页会卡在「正在加载...」→ 侧栏因 `App.tsx:933` `!target||!pageReady` 空渲染——**像回归其实是标签页卡死，开新页即愈**；侧栏只在 `#/project/<id>/wiki/<文档路径>` 路由渲染
- 本会话中出现过多次「长内容编辑中途截断损坏文件」事故（均已当场修复并验证）；后续会话编辑长块时建议小步分批

## 六、环境现状
- Host：已重启为新代码（含全部新 RPC），浏览器连接 online
- 扩展：最新构建已部署 `spikes/extension`，真机已重载
- 设置：默认主题已恢复 forest；平台模块目录当前为**空**（等用户维护真实平台模块）
- 测试截图：`spikes/theme-cards.png`（默认主题色卡）、`spikes/theme-rouge.png`、`spikes/sky-final.png`（天青全表面跟随）、`spikes/sky-sidebar.png`、`spikes/sky-model-workbench.png`
- 未提交、未发版；CHANGELOG/README 未动（按发布门槛在发版时统一做）
