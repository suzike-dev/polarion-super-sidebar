# Polarion 侧栏 Agent 编辑能力

能力契约由 `apps/host/editor-capabilities.ts` 提供；`get_editor_capabilities` 按需返回详情，节点、marks 和属性从当前 `richSchema` 自动导出。`context` 仅返回简要路线和本轮草稿元数据，避免每轮重复完整 schema。

已有本轮 target/draftId/revision 时直接使用。缺少文本节点身份才 `read_draft`，随后 `replace_text`；六位十六进制颜色或增加粗体优先 `format_text`，必须保留精确选区或明确全文范围。段落、标题、列表、表格、取消粗体和其他排版用 `read_rich_document` → `update_rich_document`，必要时先查 `topic=rich`。不要为普通正文编辑先探索目录、写脚本或绕道 Bash；正常代码、数据分析和原生命令/Skills/MCP 读取仍保留。

rich JSON 中保留来源 `sid`、`sourceText`、`sourceSpan`、所有 protected 对象和未修改的原文。新内容不复制或伪造来源身份。工程数值、单位、条件和用户范围不得为了排版被删改。schema 中出现属性不等于其所有值均可写回，实际可写字段、值域及特殊限制以能力工具的 `writable` 与 `adapterCaveat` 为准。

新增内容优先采用产品的原生默认排版与整数 pt，作者已有显式样式优先保留。能力工具的 `nativeDisplay` 直接引用当前正文/标题默认样式。服务端 HTML 回读一致不等于字体、段距或颜色像素完全相同；目标电脑的可用字体和 Polarion 原生转换仍会影响显示。编辑器、阅读预览与原生页面需分别观察，不能反复盲调数值或承诺未经页面验证的完全一致。

已知实测限制：21R2 原生视图把一个带 `text-align:center;line-height:1.75` 的段落转换成居中的 `div`，行高为 20px；服务端 HTML 仍完整保留原值。居中通过，原生行距未完全复现。这是具体样本，不是所有段落固定 20px 的通则；不能不断重写同一行距试图修复原生规范化。

新需求正文可加入已存在工作项的本地草稿；这不创建服务端工作项。当前 Agent 工具没有服务端新建工作项或 save 入口。正文保存由用户在界面明确发起，经服务端回读一致后才可称保存完成。冲突与回读不确定状态不能被本地修改掩盖，须走界面冲突审阅/回读流程。

任意 HTML/CSS 执行、直接远程写入、任意图片 URL 导入和 Mermaid 自动渲染写回不属于 rich JSON 能力。用户明确需要的 Mermaid/HTML 代码示例可作为普通 codeBlock 文本保留，不能冒充可编辑图。新增普通图片可使用已经导入、同 origin/project、state=ready、extraction=image 的有效资产；符合这些条件的对话图片附件也可使用，并不要求绑定单一草稿。不能编造资产 ID 或任意图片 URL；尚未导入的图片可走编辑器导入。画板预览资产仍遵守独立的画板归属规则。表格 colwidth 的 null 表示未设置/保留，不承诺清除原有 data-colwidth 或 width。

图形继续遵循 diagram-design Skill 及当前图形上下文返回的实际规范、profile 和产品限制。现有对象走 `read_board` → `propose_board_changes`；新图走 `read_board_generation_context` → `propose_board_generation`；需求配图走 `read_requirement_diagram_context` → `propose_board_generation`。预览提案、应用画板、插入正文草稿和保存服务端是不同状态。

参数或能力错误先检查一次对应能力 topic，再修正参数或给出可用替代；不能用相同参数无限重试。`STALE_DRAFT` 应读取新基线并保留并发修改；选区找不到或不唯一时重新定位，不偷偷扩大范围。`REMOTE_CONFLICT` 与 `READBACK_REQUIRED` 留在产品明确的审阅和回读流程中处理。
