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
const quality = svg('从发现到复验：质量体检与门禁', '一套覆盖索引供所有检查；写入先提案、人工批准、服务端回读。示意图使用虚构数据。', `
${box(44, 96, 1112, 132, C.panel)}
${txt(66, 124, '① 发现', 13, C.accent, 700)}
${txt(66, 146, '编辑器行内体检 / 总览整册体检 / AI 预审', 11, C.sub)}
${pill(66, 160, '模糊词 21 词', C.soft)}${pill(178, 160, '无量化判据', C.soft)}${pill(296, 160, '多义务', C.soft)}${pill(392, 160, '单条过长', C.soft)}${pill(488, 160, '指代不明', C.soft)}${pill(584, 160, '缺触发条件', C.soft)}
${txt(760, 146, 'AI 预审问题卡', 11, C.sub)}
${box(760, 156, 232, 54, '#fbfcf8', C.line, 8)}
${txt(772, 174, 'blocker · 温度阈值三处不一致', 10, C.ink, 600)}
${txt(772, 190, '建议：统一为 25℃ 并回填表格与代码', 9, C.muted)}
${arrow(1010, 162, 1090, 162)}
${box(1092, 118, 48, 92, C.soft, C.line, 8)}
${txt(1116, 150, '覆盖', 10, C.sub, 600, 'middle')}
${txt(1116, 166, '索引', 10, C.sub, 600, 'middle')}
${txt(1116, 182, 'S1', 9, C.muted, 400, 'middle')}

${arrow(600, 232, 600, 262)}
${box(44, 264, 536, 188)}
${txt(66, 292, '② 判定：四道生命周期门禁', 13, C.accent, 700)}
${txt(66, 314, '质量体检 / 验证准则 / 上游链接 / 实现模块', 11, C.sub)}
${['质量体检  ✗ 1 条', '验证准则  ✓ 4/4', '上游链接  ✗ 4 条', '实现模块  ✗ 4 条'].map((s, i) => `${box(66 + (i % 2) * 244, 330 + Math.floor(i / 2) * 44, 228, 34, i === 0 ? '#fdf6ee' : C.soft, C.line, 8)}${txt(78 + (i % 2) * 244, 352 + Math.floor(i / 2) * 44, s, 11, i === 0 ? C.warn : C.sub, 600)}`).join('')}
${txt(66, 432, '门禁策略：逐门启停 + 质量分阈值（发版提醒）', 10, C.muted)}

${box(620, 264, 536, 188)}
${txt(642, 292, '③ 处置：提案与改写', 13, C.accent, 700)}
${box(642, 306, 492, 40, '#fbfcf8', C.line, 8)}${txt(654, 322, '提案 · 术语替换「尽快 → 300ms 内」', 10.5, C.ink, 600)}${txt(654, 338, '差异预览 → 批准 → 写回 → 回读一致', 9.5, C.muted)}
${box(642, 352, 492, 40, '#fbfcf8', C.line, 8)}${txt(654, 368, 'AI 按建议改 · 逐条给出改前/改后', 10.5, C.ink, 600)}${txt(654, 384, '改完人工审阅保存，草稿可撤销', 9.5, C.muted)}
${box(642, 398, 492, 36, C.soft, C.line, 8)}${txt(654, 421, 'AI 深度审阅：判据充分性 / 场景完整性 / 上下游矛盾', 10, C.sub)}

${arrow(600, 452, 600, 482, C.warn, 'arrow-warn')}
${box(44, 484, 1112, 88, C.panel)}
${txt(66, 512, '④ 复验与留痕', 13, C.accent, 700)}
${txt(66, 534, '重跑体检 → 剩余问题减少；门禁分数进基线快照，与上次对比；审批、写回、回读各留一条审计事件。', 11, C.sub)}
${box(880, 500, 254, 56, '#fbfcf8', C.line, 8)}${txt(892, 518, '基线快照', 10, C.muted, 600)}${txt(892, 536, '体检分 75→88 · 门禁 0/4→2/4', 10.5, C.accent2, 600)}

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
${txt(66, 124, '运行示例：评审 → 复查（检查步）→ 结论', 13, C.accent, 700)}
${box(66, 142, 170, 60, C.soft, C.line, 8)}${txt(82, 166, '① 修复需求', 11.5, C.ink, 600)}${txt(82, 184, '按检查结论修改', 9.5, C.muted)}
${arrow(238, 172, 268, 172)}
${box(270, 142, 190, 60, '#fbfcf8', C.line, 8)}${txt(286, 166, '② 复查（检查步）', 11.5, C.ink, 600)}${txt(286, 184, '末行结论 PASS/FAIL', 9.5, C.muted)}
${arrow(462, 172, 492, 172)}
${box(494, 142, 150, 60, C.soft, C.line, 8)}${txt(510, 166, '③ 结论', 11.5, C.ink, 600)}${txt(510, 184, '暂停等人工确认', 9.5, C.muted)}
${arrow(560, 204, 560, 246, C.warn, 'arrow-warn')}
${box(430, 248, 260, 40, '#fdf6ee', '#ecd9bd', 8)}${txt(442, 273, 'FAIL → 回到 ① 返工（上限 1–5 次）', 10.5, C.warn, 600)}
${arrow(430, 268, 366, 268, C.warn, 'arrow-warn')}
${arrow(366, 268, 240, 204, C.warn, 'arrow-warn')}
${txt(66, 316, '证据与轨迹', 11, C.accent, 700)}
${txt(66, 338, '每一步的状态、结果摘要、返工次数都落库；Host 重启后被打断的步骤转暂停，继续时不会静默跳过。', 10.5, C.sub)}
${txt(66, 362, '检查步缺结论标记视为「证据不足」，转人工而不是默认通过。', 10.5, C.sub)}

${box(824, 96, 332, 300)}
${txt(846, 124, '四种发起方式', 13, C.accent, 700)}
${['模板：三连审 / 巡检 / 查重合并 / 体检清零 / 起草', '目标：/wf:: 说出目标，自动拆解执行', '定时：每日 HH:mm，本地时区去重', '批量：最多 10 个工作项各开会话'].map((s, i) => `${box(846, 140 + i * 56, 288, 46, '#fbfcf8', C.line, 8)}${txt(858, 160 + i * 56, s, 10, C.ink, 500)}`).join('')}

${box(44, 420, 360, 170)}
${txt(66, 448, '宏', 12.5, C.accent, 700)}
${txt(66, 470, '录制当前会话最近 N 条普通指令，', 10.5, C.sub)}
${txt(66, 488, '一键重放；也可每日定时。', 10.5, C.sub)}
${txt(66, 516, '自动轮（工作流/预审）不会被录入。', 10, C.muted)}

${box(420, 420, 360, 170)}
${txt(442, 448, '自愈', 12.5, C.accent, 700)}
${txt(442, 470, '任务卡在「运行中」但引擎已无执行时，', 10.5, C.sub)}
${txt(442, 488, '120s 后显式失败并可重试，', 10.5, C.sub)}
${txt(442, 506, '不会永远停在预审中。', 10.5, C.sub)}
${txt(442, 532, '启动与每分钟各扫一次。', 10, C.muted)}

${box(796, 420, 360, 170)}
${txt(818, 448, '上下文', 12.5, C.accent, 700)}
${txt(818, 470, '同会话顺序执行；用户插话优先于下一步。', 10.5, C.sub)}
${txt(818, 488, '{{item}} / {{prev}} / {{steps.id}}', 10.5, C.mono)}
${txt(818, 514, '定义修改不影响在跑实例（启动时快照）。', 10, C.muted)}

${box(44, 616, 1112, 54, '#fbfcf8', C.line)}
${txt(66, 640, '边界：独立复审、并行汇总、团队共享与批量调度按路线图后续阶段推进；当前批量是「同流程 × 多工作项」。', 10.5, C.muted)}
`);

/* 4) 驾驶舱 */
const cockpit = svg('驾驶舱、收件箱与时间线', '看数 → 干活不换页；每个数字都能点进对应视图。示意图使用虚构数据。', `
${box(44, 96, 1112, 150)}
${[['待审批', '1', '收件箱'], ['守望警报', '2', '模型工作台'], ['体检发现', '7', '整册体检'], ['门禁未决', '3', '评审台'], ['孤立条目', '4', '覆盖矩阵'], ['工作集', '5', '活队列'], ['事件', '15', '时间线']].map(([label, value, hint], i) => `${box(56 + i * 156, 108, 140, 100, i === 0 ? C.soft : '#fbfcf8', C.line, 9)}${txt(126 + i * 156, 152, value, 26, C.accent, 700, 'middle')}${txt(126 + i * 156, 174, label, 10.5, C.sub, 500, 'middle')}${txt(126 + i * 156, 192, '→ ' + hint, 9, C.faint, 400, 'middle')}`).join('')}
${txt(56, 234, '基线快照：11-19 09:20 体检分 75 · 孤立 4 · 门禁 0/4　→　11-19 18:05 体检分 88 · 孤立 1 · 门禁 2/4', 10.5, C.accent2, 600)}

${box(44, 264, 360, 300)}
${txt(66, 292, '收件箱 · 三签', 13, C.accent, 700)}
${['待审批：提案差异逐字对照，批准/拒绝', '动态与警报：守望警报、晨报、会议分诊', '时间线：文档级 / 一条需求的一生'].map((s, i) => `${box(66, 306 + i * 76, 316, 64, '#fbfcf8', C.line, 8)}${txt(78, 330 + i * 76, s.split('：')[0], 11, C.ink, 600)}${txt(78, 350 + i * 76, s.split('：')[1], 9.5, C.muted)}`).join('')}

${box(420, 264, 360, 300)}
${txt(442, 292, '智能工作集', 13, C.accent, 700)}
${txt(442, 312, '保存的动态查询 = 活队列，索引刷新自动变新', 10, C.muted)}
${['覆盖缺口', '孤立条目', '体检有发现', '关键词'].map((s, i) => `${box(442, 326 + i * 42, 316, 32, C.soft, C.line, 7)}${txt(454, 346 + i * 42, s, 10.5, C.sub, 600)}${txt(700, 346 + i * 42, '现算', 9, C.faint, 400, 'end')}`).join('')}
${txt(442, 520, '点条目直达；处理到空即关闭这一轮。', 10, C.muted)}
${txt(442, 540, '示例：覆盖缺口 4 条 → 处理后 1 条', 10, C.accent2, 600)}

${box(796, 264, 360, 300)}
${txt(818, 292, '命令与时间线', 13, C.accent, 700)}
${box(818, 306, 316, 44, '#fbfcf8', C.line, 8)}${txt(830, 324, 'Ctrl+Shift+P  命令面板', 11, C.ink, 600)}${txt(830, 340, '命令 + 工作项搜索，回车直达', 9.5, C.muted)}
${box(818, 358, 316, 44, '#fbfcf8', C.line, 8)}${txt(830, 376, '证据链导出 .md', 11, C.ink, 600)}${txt(830, 392, '模块（含疑似过期）+ 链接 + 历史轨迹', 9.5, C.muted)}
${box(818, 410, 316, 96, '#fbfcf8', C.line, 8)}
${['11-19 10:12  保存 · 修订 48', '11-19 11:59  基准 · 51 文件', '11-19 16:20  提案 · 已应用', '11-19 17:02  巡检 · 疑似过期 1'].map((s, i) => txt(830, 434 + i * 18, s, 9.5, i === 3 ? C.warn : C.muted, i === 3 ? 600 : 400)).join('')}

${box(44, 588, 1112, 78, '#fbfcf8', C.line)}
${txt(66, 614, '原则', 11, C.accent, 700)}
${txt(66, 636, 'Polarion 是唯一事实源：本地只存草稿、索引与事件缓存；所有写回都要服务端回读；定时与飞书发送是显式动作，可在设置中关闭。', 10.5, C.muted)}
`);

const assets = [['readme-quality.svg', quality], ['readme-trace.svg', trace], ['readme-workflow.svg', workflow], ['readme-cockpit.svg', cockpit]];
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
