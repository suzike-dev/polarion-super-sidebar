import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RichDocument } from './rich-document.ts';
import { richSchema } from './rich-schema.ts';
import { defaultRulePack, lintText, lintDocument, RulePackSchema, type RulePack } from './requirement-lint.ts';

test('内置默认规则包通过自身 Schema 校验', () => {
  const pack = RulePackSchema.parse(defaultRulePack());
  assert.equal(pack.lintRules.length, 6);
  assert.ok(pack.lintRules.every(rule => rule.enabled));
});

test('模糊词按位置命中且与义务词共存', () => {
  const issues = lintText('系统应快速响应用户操作', defaultRulePack());
  const fuzzy = issues.find(issue => issue.ruleId === 'fuzzy-default');
  assert.ok(fuzzy);
  assert.equal(fuzzy!.matchedText, '快速');
  assert.equal(fuzzy!.from, 3);
  assert.equal(fuzzy!.to, 5);
  assert.ok(issues.some(issue => issue.ruleId === 'no-criterion-default'));
});

test('有数量/时限词时不再报无验证准则', () => {
  const issues = lintText('系统应在 200ms 内完成车速上传', defaultRulePack());
  assert.ok(!issues.some(issue => issue.ruleId === 'no-criterion-default'));
  assert.ok(!issues.some(issue => issue.ruleId === 'fuzzy-default'));
});

test('非原子：多个义务且无分号或编号切分才报', () => {
  const pack = defaultRulePack();
  assert.ok(lintText('系统应采集车速，系统应过滤噪声', pack).some(issue => issue.ruleId === 'non-atomic-default'));
  assert.ok(!lintText('系统应采集车速；系统应过滤噪声', pack).some(issue => issue.ruleId === 'non-atomic-default'));
  assert.ok(!lintText('1. 应采集车速\n2. 应过滤噪声', pack).some(issue => issue.ruleId === 'non-atomic-default'));
});

test('指代词命中', () => {
  const issues = lintText('系统应满足上述要求', defaultRulePack());
  const anaphora = issues.find(issue => issue.ruleId === 'anaphora-default');
  assert.equal(anaphora?.matchedText, '上述');
});

test('术语表：别名命中给标准词建议，最长匹配优先', () => {
  const pack = RulePackSchema.parse({ ...defaultRulePack(), glossary: [{ term: '刹车助力', aliases: ['制动助力', 'BrakeBoost'] }] });
  const issues = lintText('制动助力与 BrakeBoost 均指刹车助力，助力不单独算别名', pack);
  const hits = issues.filter(issue => issue.ruleId === 'glossary:刹车助力');
  assert.equal(hits.length, 2);
  assert.ok(hits.every(issue => issue.suggestion === '刹车助力'));
  // 标准词自身与更短的普通词（助力）不产生命中。
  assert.ok(!issues.some(issue => issue.matchedText === '刹车助力'));
  assert.ok(!issues.some(issue => issue.matchedText === '助力'));
});

test('标准词内的短别名不再高亮，混排时只标出独立旧词', () => {
  const pack = RulePackSchema.parse({ glossary: [{ term: '验收示例信号', aliases: ['示例信号'] }] });
  const hits = lintText('验收示例信号、示例信号', pack);
  assert.deepEqual(hits.map(({ matchedText, from, to }) => [matchedText, from, to]), [['示例信号', 7, 11]]);
  assert.deepEqual(lintText('验收示例信号、验收示例信号', pack), []);
});

test('重叠词按完整标准拼写与最长别名判定，大小写建议保留原始 UTF-16 位置', () => {
  const pack = RulePackSchema.parse({ glossary: [
    { term: '验收信号', aliases: ['旧信号', '验收信号', 'RPM'] },
    { term: '验收长信号', aliases: ['旧信号扩展'] },
    { term: 'RPM', aliases: ['rpm'] },
    { term: '车速', aliases: ['车速信号'] },
  ] });
  const text = 'İ😀｜旧信号扩展｜旧信号｜RPM｜rpm｜车速信号｜验收信号';
  const hits = lintText(text, pack);
  assert.deepEqual(hits.map(hit => [hit.matchedText, hit.suggestion]), [
    ['旧信号扩展', '验收长信号'], ['旧信号', '验收信号'], ['rpm', 'RPM'], ['车速信号', '车速'],
  ]);
  for (const hit of hits) assert.equal(text.slice(hit.from, hit.to), hit.matchedText);
});

test('禁用术语直接警示且无替换建议', () => {
  const pack = RulePackSchema.parse({ ...defaultRulePack(), glossary: [{ term: '脚刹', aliases: [], forbidden: true }] });
  const issue = lintText('驾驶员踩下脚刹', pack).find(item => item.ruleId === 'glossary-forbidden:脚刹');
  assert.ok(issue);
  assert.equal(issue!.suggestion, undefined);
});

test('同一别名有两个目标或目标禁用时，保留警示并禁止自动替换', () => {
  const pack = RulePackSchema.parse({ glossary: [
    { term: '标准甲', aliases: ['shared', '标准乙'] }, { term: '标准乙', aliases: ['SHARED'] },
    { term: '禁用名', aliases: ['旧禁名'], forbidden: true },
  ] });
  const hits = lintText('ShArEd｜标准乙｜旧禁名｜禁用名', pack);
  assert.deepEqual(hits.map(hit => hit.matchedText), ['ShArEd', '旧禁名', '禁用名']);
  assert.ok(hits.every(hit => hit.suggestion === undefined));
});

test('停用规则不再命中', () => {
  const pack = defaultRulePack();
  pack.lintRules = pack.lintRules.map(rule => rule.id === 'fuzzy-default' ? { ...rule, enabled: false } : rule);
  assert.ok(!lintText('系统应快速响应', pack).some(issue => issue.ruleId === 'fuzzy-default'));
});

test('Polarion 的 DIV 和表格内仍高亮精确的术语位置', () => {
  const doc = richSchema.nodeFromJSON(new RichDocument('<div><p>应快速响应</p><table><tr><td>应快速恢复</td></tr></table></div>').document);
  const matches = lintDocument(doc, defaultRulePack()).filter(issue => issue.matchedText === '快速');
  assert.equal(matches.length, 2);
  for (const issue of matches) assert.equal(doc.textBetween(issue.from!, issue.to!), '快速');
});

test('lintDocument 给出 PM 位置且跨段评估条目级规则', () => {
  const doc = richSchema.nodeFromJSON(new RichDocument('<p>系统应快速响应</p><p>系统应在 200ms 内完成上传</p>').document);
  const issues = lintDocument(doc, defaultRulePack());
  const fuzzy = issues.find(issue => issue.ruleId === 'fuzzy-default');
  assert.ok(fuzzy && fuzzy.from !== undefined && fuzzy.to !== undefined);
  assert.equal(doc.textBetween(fuzzy!.from!, fuzzy!.to!), '快速');
  // 两段各有一个义务词、无分号编号：条目级非原子仍应报出。
  assert.ok(issues.some(issue => issue.ruleId === 'non-atomic-default'));
  // 无范围问题排在最后。
  assert.equal(issues.find(issue => issue.from === undefined)?.ruleId, 'non-atomic-default');
});

test('严格基线 v2：缺触发条件与单条过长可命中，量化判据收紧后裸时间词不再豁免', () => {
  const pack = defaultRulePack();
  // 缺触发条件：只有义务没有“当/若/检测到”。
  assert.ok(lintText('系统应退出高压状态，并在 300ms 内完成下电。', pack).some(issue => issue.ruleId === 'no-condition-default'));
  assert.ok(!lintText('当检测到碰撞信号时，系统应在 300ms 内切断高压。', pack).some(issue => issue.ruleId === 'no-condition-default'));
  // 单条过长（>140 字无切分）。
  const long = '系统应' + '持续监测电池温度并在超过阈值时进入保护'.repeat(8) + '。';
  assert.ok(lintText(long, pack).some(issue => issue.ruleId === 'long-sentence-default'));
  // 收紧后：裸“之前/之后”不再算量化判据。
  assert.ok(lintText('系统应在碰撞之前完成断电。', pack).some(issue => issue.ruleId === 'no-criterion-default'));
  assert.ok(!lintText('系统应在碰撞后 100ms 内完成断电。', pack).some(issue => issue.ruleId === 'no-criterion-default'));
});
