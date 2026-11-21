import { test } from 'node:test';
import assert from 'node:assert/strict';
import { builtinRequirementTemplates, builtinTemplateById, templateCategories } from './requirement-templates.ts';

test('内置模板：5 类齐全，骨架章节完整', () => {
  assert.equal(builtinRequirementTemplates.length, 5);
  assert.deepEqual(templateCategories.map(c => c.key), builtinRequirementTemplates.map(t => t.category));
  for (const template of builtinRequirementTemplates) {
    assert.ok(template.html.includes('<h3>1. 功能描述</h3>'), template.id + ' 缺少功能描述章节');
    assert.ok(template.html.includes('<h3>2. 输入接口表</h3>'), template.id + ' 缺少输入接口表章节');
    assert.ok(template.html.includes('<h3>3. 输出接口表</h3>'), template.id + ' 缺少输出接口表章节');
    assert.ok(template.html.includes('<h3>4. 标定量表</h3>'), template.id + ' 缺少标定量表章节');
    assert.ok(template.html.includes('color:#B45309'), template.id + ' 正文缺少标定量高亮样式');
    assert.ok(template.html.includes('REQ-'), template.id + ' 缺少 EARS 编号需求条目');
    assert.ok(/(验证准则|性能指标)/.test(template.html), template.id + ' 缺少验证准则章节');
    assert.ok(template.html.includes('开放问题'), template.id + ' 缺少开放问题章节');
    assert.ok(template.usageNote.length > 10, template.id + ' 缺少使用时机说明');
    assert.equal(builtinTemplateById(template.id), template);
  }
});

test('内置模板：信号命名遵循 SPE-TMS V2.1（模块前缀 + Act/Des + 类型后缀）', () => {
  const expected = [
    ['req-tpl-calculation', /CTC_DuctTempDes_deg/],
    ['req-tpl-algorithm', /ACLC_CmpSpdDes_rpm/],
    ['req-tpl-state-machine', /SS_ECCOperMod_enm/],
  ] as const;
  for (const [id, pattern] of expected) {
    const template = builtinTemplateById(id)!;
    assert.match(template.html, pattern);
  }
});
