/* 生成 README 新功能配图：自绘矢量示意（虚构数据），输出 SVG + PNG。 */
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const dep = 'C:/Users/Lenovo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const requireBundled = createRequire(path.join(dep, 'sharp/package.json'));
const sharp = requireBundled('sharp');

const outDir = path.resolve(__dirname, '../assets');
const W = 1200, H = 700;
const C = { bg: '#f5f7f2', panel: '#ffffff', line: '#dbe4d8', soft: '#eef2e7', ink: '#1b272e', sub: '#4c5a4d', muted: '#7d8579', faint: '#a2ab9d', accent: '#2f4a34', accent2: '#4f7d52', lime: '#d8ebad', warn: '#c98a2b', danger: '#a1503c', info: '#356c7c' };
const esc = v => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const font = "Microsoft YaHei, Noto Sans CJK SC, sans-serif";

function svg(title, sub, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">
<defs>
<style>
.t{font-family:${font};fill:${C.ink}}
.sub{font-family:${font};fill:${C.muted};font-size:12px}
.h{font-size:17px;font-weight:700}
.card{fill:${C.panel};stroke:${C.line};stroke-width:1}
.mono{font-family:Consolas,'Microsoft YaHei UI',monospace}
</style>
<marker id="arrow" markerWidth="9" markerHeight="7" refX="8" refY="3.5" orient="auto"><path d="M0 0 L9 3.5 L0 7" fill="${C.accent2}"/></marker>
<marker id="arrow-warn" markerWidth="9" markerHeight="7" refX="8" refY="3.5" orient="auto"><path d="M0 0 L9 3.5 L0 7" fill="${C.warn}"/></marker>
</defs>
<rect width="${W}" height="${H}" fill="${C.bg}"/>
<text x="44" y="48" class="t h">${esc(title)}</text>
<text x="44" y="70" class="sub">${esc(sub)}</text>
${body}
</svg>`;
}
const box = (x, y, w, h, fill = C.panel, stroke = C.line, r = 10, extra = '') => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${stroke}" ${extra}/>`;
const txt = (x, y, s, size = 12, color = C.ink, weight = 400, anchor = 'start') => `<text x="${x}" y="${y}" font-family="${font}" font-size="${size}" fill="${color}" font-weight="${weight}" text-anchor="${anchor}">${esc(s)}</text>`;
const pill = (x, y, s, fill, color = C.ink) => `${box(x, y, Math.max(36, s.length * 11 + 16), 20, fill, 'none', 10)}${txt(x + 8, y + 14, s, 10, color, 600)}`;
const arrow = (x1, y1, x2, y2, color = C.accent2, marker = 'arrow') => `<path d="M${x1} ${y1} L${x2} ${y2}" stroke="${color}" stroke-width="1.6" fill="none" marker-end="url(#${marker})"/>`;

/* 1) 质量闭环 */
const quality = svg('从发现到复验：质量体检与门禁', '整册体检按大纲读工作项正文，门禁按项目覆盖索引判定。示意图使用虚构数据。', `
${box(44, 96, 1112, 132, C.panel)}
${txt(66, 124, '① 发现', 13, C.accent, 700)}
${txt(66, 146, '编辑器行内体检 / 总览整册体检 / AI 预审', 11, C.sub)}
${pill(66, 160, '模糊词', C.soft)}${pill(178, 160, '无量化判据', C.soft)}${pill(296, 160, '职责不原子', C.soft)}${pill(392, 160, '单条过长', C.soft)}${pill(488, 160, '指代不明', C.soft)}${pill(584, 160, '缺触发条件', C.soft)}
${txt(760, 146, 'AI 预审问题卡', 11, C.sub)}
${box(760, 156, 232, 54, '#fbfcf8', C.line, 8)}
${txt(772, 174, '阻断 · 同一阈值的三处写法不一致', 10, C.ink, 600)}
${txt(772, 190, '建议对照参数表核实原值', 9, C.muted)}
${arrow(1010, 162, 1090, 162)}
${box(1092, 118, 48, 92, C.soft, C.line, 8)}
${txt(1116, 158, '待处置', 10, C.sub, 600, 'middle')}
${txt(1116, 176, '问题卡', 10, C.sub, 600, 'middle')}

${arrow(600, 232, 600, 262)}
${box(44, 264, 536, 188)}
${txt(66, 292, '② 判定：四道生命周期门禁', 13, C.accent, 700)}
${txt(66, 314, '质量体检 / 验证准则 / 上游链接 / 实现模块', 11, C.sub)}
${['质量体检  ✗ 1 条', '验证准则  ✓ 4/4', '上游链接  ✗ 4 条', '实现模块  ✗ 4 条'].map((s, i) => `${box(66 + (i % 2) * 244, 330 + Math.floor(i / 2) * 44, 228, 34, i === 0 ? '#fdf6ee' : C.soft, C.line, 8)}${txt(78 + (i % 2) * 244, 352 + Math.floor(i / 2) * 44, s, 11, i === 0 ? C.warn : C.sub, 600)}`).join('')}
${txt(66, 432, '门禁策略：逐门启停 + 质量分阈值（发版提醒）', 10, C.muted)}

${box(620, 264, 536, 188)}
${txt(642, 292, '③ 处置：提案与改写', 13, C.accent, 700)}
${box(642, 306, 492, 40, '#fbfcf8', C.line, 8)}${txt(654, 322, '预览替换 · 全文 2 处「就绪标记」改为「就绪标志」', 10.5, C.ink, 600)}${txt(654, 338, '核对差异后点「确认并保存到 Polarion」，本条已有草稿修改也会写回。', 9.5, C.sub)}
${box(642, 352, 492, 40, '#fbfcf8', C.line, 8)}${txt(654, 368, '体检发现可选「AI 改写」，预审问题卡可选「AI 按建议改」', 10.5, C.ink, 600)}${txt(654, 384, '在会话中查看修改对照，审阅草稿后保存。', 9.5, C.sub)}
${box(642, 398, 492, 36, C.soft, C.line, 8)}${txt(654, 421, 'AI 深检本条 · 核对判据、场景和上下游一致性', 10, C.sub)}

${arrow(600, 452, 600, 482, C.warn, 'arrow-warn')}
${box(44, 484, 1112, 88, C.panel)}
${txt(66, 512, '④ 复验与留痕', 13, C.accent, 700)}
${txt(66, 534, '重新体检当前文档，按编号核对剩余发现。通过全部启用门禁的条目数也可在基线快照里对比。', 11, C.sub)}
${box(880, 500, 254, 56, '#fbfcf8', C.line, 8)}${txt(892, 518, '基线快照', 10, C.muted, 600)}${txt(892, 536, '体检分 75→88 · 门禁全过 0/4→2/4', 10.5, C.accent2, 600)}

${box(44, 592, 1112, 74, '#fbfcf8', C.line)}
${txt(66, 618, '数据来源与边界', 11, C.accent, 700)}
${txt(66, 640, '行内体检 = 内置严格基线 + 项目词表/术语；判据充分性与场景完整性交给 AI 预审。0 命中只是下限筛查，不代表质量达标。', 10.5, C.muted)}
`);

/* 2) 追溯 */
const trace = svg('需求 ↔ 模型：双向追溯与一致性巡检', '绑定一次本地模型目录，按内容指纹发现哪一侧变了。示意图使用虚构数据。', `
${box(44, 96, 500, 250)}
${txt(66, 124, '需求侧', 13, C.accent, 700)}
${txt(66, 146, '当前文档 · 4 条（虚构）', 10.5, C.muted)}
${['SPE-示例 101 高压上电判定', 'SPE-示例 102 热管理退出', 'SPE-示例 103 故障降级', 'SPE-示例 104 CAN 唤醒'].map((s, i) => `${box(66, 158 + i * 42, 456, 34, i === 1 ? '#fdf6ee' : '#fbfcf8', C.line, 7)}${txt(78, 180 + i * 42, s, 10.5, C.ink, i === 1 ? 600 : 400)}${i === 1 ? txt(460, 180 + i * 42, '疑似过期', 9.5, C.warn, 700) : ''}`).join('')}

${box(576, 96, 580, 250)}
${txt(598, 124, '模型侧 · 本地 SVN 目录（示例）', 13, C.accent, 700)}
${txt(598, 146, '19 个模块 · 51 个文件指纹 · 基准 11-19 11:59', 10.5, C.muted)}
${['HPMode.slx  △ 内容变化', 'Power.slx   一致', 'Com_Lib.slx 一致', '接口表 _DD.xlsx 一致'].map((s, i) => `${box(598, 158 + i * 42, 536, 34, i === 0 ? '#fdf6ee' : '#fbfcf8', C.line, 7)}${txt(610, 180 + i * 42, s, 10.5, i === 0 ? C.warn : C.sub, i === 0 ? 600 : 400)}`).join('')}

${arrow(548, 220, 572, 220)}${arrow(572, 260, 548, 260)}
${txt(560, 204, '反查需求', 9, C.muted, 400, 'middle')}
${txt(560, 278, '实现模块', 9, C.muted, 400, 'middle')}

${box(44, 368, 360, 210)}
${txt(66, 396, '① 基准', 12.5, C.accent, 700)}
${txt(66, 418, '把当前模型文件内容指纹，', 10.5, C.sub)}
${txt(66, 436, '和已关联需求的修订时间，', 10.5, C.sub)}
${txt(66, 454, '一起拍成快照。', 10.5, C.sub)}
${txt(66, 484, 'SHA-256 · 51 文件 · 只读', 10, C.muted)}
${box(66, 498, 316, 34, C.soft, C.line, 7)}${txt(78, 520, '不会修改 SVN 或模型文件', 10, C.accent2, 600)}

${box(420, 368, 360, 210)}
${txt(442, 396, '② 巡检', 12.5, C.accent, 700)}
${txt(442, 418, '模型变了 → 关联需求标疑似过期', 10.5, C.sub)}
${txt(442, 436, '需求变了 → 提示模型需同步', 10.5, C.sub)}
${txt(442, 454, '两侧都变 → 需人工裁决以哪侧为准', 10.5, C.sub)}
${txt(442, 484, '可手动触发，也可按日定时', 10, C.muted)}
${box(442, 498, 316, 34, C.soft, C.line, 7)}${txt(454, 520, 'AI 里说「巡检一致性」即同源结果', 10, C.accent2, 600)}

${box(796, 368, 360, 210)}
${txt(818, 396, '③ 修复与复验', 12.5, C.accent, 700)}
${txt(818, 418, 'AI 读模型与需求正文，列出差异', 10.5, C.sub)}
${txt(818, 436, '位置：模块 / 信号 / 参数 / 条目章节', 10.5, C.sub)}
${txt(818, 454, '给出两种方向：以需求为准 / 以模型为准', 10.5, C.sub)}
${txt(818, 484, '改完回读，再跑一次巡检', 10, C.muted)}
${box(818, 498, 316, 34, C.soft, C.line, 7)}${txt(830, 520, '影响面：模块 · 上下游 · 验证链接', 10, C.accent2, 600)}

${box(44, 604, 1112, 62, '#fbfcf8', C.line)}
${txt(66, 628, '覆盖矩阵与初关联', 11, C.accent, 700)}
${txt(66, 648, '每条需求可展开上游 / 下游 / 验证的具体条目；未标注需求可让 AI 先关联一版，人工再修正（低置信列待人工确认）。', 10.5, C.muted)}
`);

/* 3) 工作流 */
const workflow = svg('工作流编排：检查步、返工与自动化', '顺序流 + 检查步；目标驱动拆解后可保存复用。示意图使用虚构数据。', `
${box(44, 96, 760, 300)}
${txt(66, 124, '运行示例 · 修复 → 复查（检查步）→ 汇总结论', 13, C.accent, 700)}
${box(66, 142, 170, 60, C.soft, C.line, 8)}${txt(82, 166, '① 修复需求', 11.5, C.ink, 600)}${txt(82, 184, '按检查结论修改', 9.5, C.muted)}
${arrow(238, 172, 268, 172)}
${box(270, 142, 190, 60, '#fbfcf8', C.line, 8)}${txt(286, 166, '② 复查（检查步）', 11.5, C.ink, 600)}${txt(286, 184, '末行给出检查结论', 9.5, C.muted)}
${txt(477, 162, 'PASS', 9, C.accent2, 600, 'middle')}${arrow(462, 172, 492, 172)}
${box(494, 142, 150, 60, C.soft, C.line, 8)}${txt(510, 166, '③ 汇总结论', 11.5, C.ink, 600)}${txt(510, 184, '结果写入会话', 9.5, C.muted)}
${arrow(365, 204, 365, 246, C.warn, 'arrow-warn')}
${box(235, 248, 260, 40, '#fdf6ee', '#ecd9bd', 8)}${txt(247, 273, 'FAIL → 回到 ① 返工（上限 1–5 次）', 10.5, C.warn, 600)}
<path d="M235 268 H151 V204" stroke="${C.warn}" stroke-width="1.6" fill="none" marker-end="url(#arrow-warn)"/>
${txt(66, 316, '运行轨迹', 11, C.accent, 700)}
${txt(66, 338, '展开「步骤与结果」核对状态、摘要和返工次数。有对应会话时可点「查看会话全文」。', 10.5, C.sub)}
${txt(66, 362, '缺少结论、NEED_MANUAL 或返工耗尽时，流程暂停等人工处理。', 10.5, C.sub)}

${box(824, 96, 332, 300)}
${txt(846, 124, '「设计」页常用操作', 13, C.accent, 700)}
${['「安装内置模板」后，在定义行点「运行」', '在「说出目标」填入任务，点「拆解并执行」', '「定时」选每天的时间，再点「保存定时」', '「批量」输入编号，去重后点「开始批量」'].map((s, i) => `${box(846, 140 + i * 56, 288, 46, '#fbfcf8', C.line, 8)}${txt(858, 160 + i * 56, s, 10, C.ink, 500)}`).join('')}

${box(44, 420, 360, 170)}
${txt(66, 448, '宏', 12.5, C.accent, 700)}
${txt(66, 470, '「录制」当前会话最近 1–10 条普通指令。', 10.5, C.sub)}
${txt(66, 488, '展开「查看指令」核对原文，再点「重放」。', 10.5, C.sub)}
${txt(66, 516, '自动轮（工作流/预审）不会被录入。', 10, C.muted)}

${box(420, 420, 360, 170)}
${txt(442, 448, '批量运行会话', 12.5, C.accent, 700)}
${txt(442, 470, '编号去重后最多 10 项，运行附注随各自的会话发送。', 10.5, C.sub)}
${txt(442, 488, '点回执中的工作项编号打开对应会话。', 10.5, C.sub)}
${txt(442, 516, '「查看运行轨迹」可核对各项执行结果。', 10, C.muted)}

${box(796, 420, 360, 170)}
${txt(818, 448, '上下文', 12.5, C.accent, 700)}
${txt(818, 470, '同会话顺序执行；用户插话优先于下一步。', 10.5, C.sub)}
${txt(818, 488, '{{item}} / {{prev}} / {{steps.s1}}', 10.5, C.sub)}
${txt(818, 514, '定义修改不影响在跑实例（启动时快照）。', 10, C.muted)}

${box(44, 616, 1112, 54, '#fbfcf8', C.line)}
${txt(66, 640, '对话里输入 /wf:名称 可运行已有流程，输入 /wf::目标 可拆解并执行。想再次使用拆解结果时，在「动态拆解」里点「保存复用」。', 10.5, C.muted)}
`);

/* 4) 驾驶舱 */
const cockpit = svg('驾驶舱、收件箱与时间线', '点指标看明细，关闭后回到原指标卡。示意图使用虚构数据。', `
${box(44, 96, 1112, 150)}
${[
  ['待审批提案', '1', '本文档可审批提案'], ['守望警报', '2', '收件箱 · 仅警告'],
  ['体检发现', '7', '项目最近体检报告'], ['AI 预审未决', '3', '只看未决问题'],
  ['孤立条目', '4', '只看孤立条目'], ['工作流', '2', '工作流定义'],
  ['工作集', '4', '智能工作集'], ['项目事件（近500条）', '15', '项目事件流'],
].map(([label, value, hint], i) => `${box(56 + i * 137, 108, 128, 100, i === 0 ? C.soft : '#fbfcf8', C.line, 9)}${txt(120 + i * 137, 152, value, 26, C.accent, 700, 'middle')}${txt(120 + i * 137, 174, label, 10.5, C.sub, 500, 'middle')}${txt(120 + i * 137, 192, '→ ' + hint, 9, C.muted, 400, 'middle')}`).join('')}
${txt(56, 234, '基线快照：11-19 09:20 体检分 75 · 孤立 4 · 门禁 0/4　→　11-19 18:05 体检分 88 · 孤立 1 · 门禁 2/4', 10.5, C.accent2, 600)}

${box(44, 264, 360, 300)}
${txt(66, 292, '收件箱 · 三签', 13, C.accent, 700)}
${['待审批：查看差异、拒绝或「批准并应用」', '动态与警报：守望警报、晨报、会议分诊、项目事件流', '时间线：项目近 400 条事件，可按正在编辑的工作项筛选'].map((s, i) => `${box(66, 306 + i * 76, 316, 64, '#fbfcf8', C.line, 8)}${txt(78, 330 + i * 76, s.split('：')[0], 11, C.ink, 600)}${txt(78, 350 + i * 76, s.split('：')[1], 9.5, C.muted)}`).join('')}

${box(420, 264, 360, 300)}
${txt(442, 292, '智能工作集', 13, C.accent, 700)}
${txt(442, 312, '保存查询条件，每次展开时重新读取结果。', 10, C.muted)}
${[['覆盖缺口', '覆盖索引'], ['孤立条目', '覆盖索引'], ['体检有发现', '最近整册报告'], ['关键词', '覆盖索引']].map(([label, source], i) => `${box(442, 326 + i * 42, 316, 32, C.soft, C.line, 7)}${txt(454, 346 + i * 42, label, 10.5, C.sub, 600)}${txt(746, 346 + i * 42, source, 10, C.sub, 400, 'end')}`).join('')}
${txt(442, 520, '点结果中的编号打开阅读预览。', 10, C.sub)}
${txt(442, 540, '体检结果也列出正文读取失败的工作项。', 10, C.sub)}

${box(796, 264, 360, 300)}
${txt(818, 292, '命令与时间线', 13, C.accent, 700)}
${box(818, 306, 316, 44, '#fbfcf8', C.line, 8)}${txt(830, 324, 'Ctrl+Shift+P  命令面板', 11, C.ink, 600)}${txt(830, 340, '命令 + 工作项搜索，回车直达', 9.5, C.muted)}
${box(818, 358, 316, 44, '#fbfcf8', C.line, 8)}${txt(830, 376, '证据链导出 .md', 11, C.ink, 600)}${txt(830, 392, '模块（含疑似过期）+ 链接 + 历史轨迹', 9.5, C.muted)}
${box(818, 410, 316, 96, '#fbfcf8', C.line, 8)}
${['11-19 10:12  保存 · 修订 48', '11-19 11:59  基准 · 51 文件', '11-19 16:20  提案 · 已应用', '11-19 17:02  巡检 · 疑似过期 1'].map((s, i) => txt(830, 434 + i * 18, s, 9.5, i === 3 ? C.warn : C.muted, i === 3 ? 600 : 400)).join('')}

${box(44, 588, 1112, 78, '#fbfcf8', C.line)}
${txt(66, 614, '统计口径', 11, C.accent, 700)}
${txt(66, 635, '体检按有发现的工作项计数，含正文读取失败的条目。AI 预审未决取项目最近 20 次预审中仍待处置的问题卡。', 10.5, C.sub)}
${txt(66, 653, '覆盖缺口表示至少缺一项，孤立条目表示上游链接、实现模块和验证链接三项都空。', 10.5, C.sub)}
`);


/* 8) 需求模板库：模板即真实工作项 */
const templates = svg('需求模板库：模板就是真实工作项', '5 类必备模板存放在 library 项目的模板文档里；编辑模板等于编辑工作项，插入时按副本写入。示意使用虚构数据。', `
${box(44, 96, 352, 470)}
${txt(66, 124, '模板库（library 项目）', 13, C.accent, 700)}
${txt(66, 144, '5 类必备 + 可扩展自定义类别', 10, C.muted)}
${[['场景类', '介入 / 退出型功能', '内置'], ['计算类', '查表 / 公式计算', '内置'], ['算法类', '闭环 / 策略算法', '内置'], ['状态机类', '多状态跳转', '内置'], ['混合类', '复合逻辑', '内置']].map((row, i) => {
  const y = 160 + i * 58;
  return `${box(60, y, 320, 50, '#fbfcf8', C.line, 8)}
${txt(74, y + 21, row[0], 11, C.ink, 700)}${txt(74, y + 38, row[1], 9.5, C.muted)}
${pill(300, y + 15, row[2], C.soft, C.accent2)}`;
}).join('')}
${box(60, 456, 320, 44, '#f7faf5', C.line, 8)}
${txt(74, 474, '可新增自定义类别', 10.5, C.ink, 600)}${txt(74, 490, '类别可扩展，如「诊断类」', 9.5, C.muted)}

${box(412, 96, 360, 470)}
${txt(434, 124, '插入模板：三步流程', 13, C.accent, 700)}
${['① 在光标处新建工作项', '② 按原生 Save 保存', '③ 选模板点「插入模板」'].map((s, i) => {
  const y = 150 + i * 74;
  return `${box(432, y, 320, 60, '#fbfcf8', C.line, 8)}
${txt(446, y + 24, s, 11, C.ink, 700)}${txt(446, y + 44, ['用 Polarion 原生方式，位置即光标处', '获得正式编号后即可写入', '正文立即生效，无需刷新'][i], 9.5, C.muted)}`;
}).join('')}
${arrow(560, 210, 560, 224)}${arrow(560, 284, 560, 298)}
${box(432, 384, 320, 76, '#f7faf5', C.line, 8)}
${txt(446, 406, '光标自动识别', 11, C.ink, 700)}
${txt(446, 424, '位置与目标条目自动带入；未识别时', 9.5, C.muted)}
${txt(446, 440, '橙色提示并允许手填条目标 ID。', 9.5, C.muted)}
${box(432, 472, 320, 76, '#fdf8f2', '#e8d3b4', 8)}
${txt(446, 494, '安全边界', 11, C.warn, 700)}
${txt(446, 512, '目标正文非空白即拒绝写入；', 9.5, C.sub)}
${txt(446, 528, '模板原件永不被改动（写入副本）。', 9.5, C.sub)}

${box(788, 96, 348, 470)}
${txt(810, 124, '插入结果：与模板同构的正文', 13, C.accent, 700)}
${box(806, 140, 312, 30, C.soft, 'none', 6)}${txt(818, 160, '1. 功能描述', 10.5, C.accent, 700)}
${box(806, 178, 312, 52, '#fbfcf8', C.line, 6)}
${txt(818, 196, '功能 ID  FC-QUICKCOOL-01   ASIL  QM', 9, C.ink)}
${txt(818, 214, '需求来源  HMI 交互规范 / 整车定义', 9, C.muted)}
${box(806, 238, 312, 76, '#fbfcf8', C.line, 6)}
${txt(818, 256, '2. 输入接口表', 10, C.accent, 700)}
${['信号名称        信号值        数据类型', 'ICCQuickCoolSwt  0x1: ON      uint8', 'SC_AmbTemp_deg   -40~60 degC  sfloat'].map((s, i) => txt(818, 274 + i * 16, s, 8.5, i ? C.sub : C.muted, i ? 400 : 600)).join('')}
${box(806, 322, 312, 60, '#fbfcf8', C.line, 6)}
${txt(818, 340, '3. 输出接口表', 10, C.accent, 700)}
${txt(818, 358, 'AcQuickCoolStsDisp   0x1: On   uint8', 8.5, C.sub)}
${box(806, 390, 312, 76, '#fbfcf8', C.line, 6)}
${txt(818, 408, '4. 标定量表', 10, C.accent, 700)}
${txt(818, 426, 'CTC_QuickCoolAmbMin_c   -5 degC', 8.5, '#b45309', 700)}
${txt(818, 444, 'CTC_QuickCoolSwtDly_c   200 ms', 8.5, '#b45309', 700)}
${box(806, 474, 312, 76, '#f7faf5', C.line, 6)}
${txt(818, 492, '5. 需求条目（EARS）', 10, C.accent, 700)}
${txt(818, 510, 'REQ-QC-01  WHEN 开关=ON … 系统应 …', 8.5, C.sub)}
${txt(818, 526, 'REQ-QC-02  IF 环温 ≥ -5 ℃ … 应 …', 8.5, C.sub)}

${box(44, 588, 1112, 78, '#fbfcf8', C.line)}
${txt(66, 614, '与工作项同构', 11, C.accent, 700)}
${txt(66, 635, '模板是 Polarion 里的真实工作项：打开编辑即进入副文本编辑工作台，保存走工作项保存链路（服务端回读校验）。', 10.5, C.sub)}
${txt(66, 653, '插入时实时读取模板当前正文：在设置里改完模板并保存，下一次插入立即生效；写入的是副本，模板原件不受影响。', 10.5, C.sub)}
`);

const assets = [['readme-quality.svg', quality], ['readme-trace.svg', trace], ['readme-workflow.svg', workflow], ['readme-cockpit.svg', cockpit], ['readme-templates.svg', templates]];
(async () => {
  for (const [name, content] of assets) {
    const svgPath = path.join(outDir, name);
    fs.writeFileSync(svgPath, content, 'utf8');
    const pngPath = svgPath.replace(/\.svg$/, '.png');
    await sharp(Buffer.from(content)).png().toFile(pngPath);
    const { size } = fs.statSync(pngPath);
    console.log(name, '->', path.basename(pngPath), Math.round(size / 1024) + 'KB');
  }
})();
