import {test} from 'node:test';
import assert from 'node:assert/strict';
import {bindDiagramLabels} from './board-labels.ts';

const base = (id: string, type: string, x: number, y: number, width: number, height: number, extra: Record<string, unknown> = {}) => ({id, type, x, y, width, height, ...extra});

test('container labels become bound text elements and are removed from the container', () => {
  const rectangle = base('n1', 'rectangle', 100, 100, 160, 80, {label: {text: '开始', fontSize: 16, textAlign: 'center', color: '#123456'}, boundElements: null});
  const result = bindDiagramLabels([rectangle]);
  assert.equal(result.length, 2);
  const [container, text] = result as any[];
  assert.equal(container.label, undefined);
  assert.equal(text.type, 'text');
  assert.equal(text.text, '开始');
  assert.equal(text.containerId, 'n1');
  assert.equal(text.strokeColor, '#123456');
  assert.deepEqual(container.boundElements, [{id: 'n1-label', type: 'text'}]);
  assert.ok(text.x > container.x && text.x + text.width <= container.x + container.width, 'text is centred inside the container');
});

test('arrow labels are standalone text at the arrow midpoint', () => {
  const arrow = base('a1', 'arrow', 0, 0, 200, 40, {label: {text: '是'}});
  const result = bindDiagramLabels([arrow]) as any[];
  assert.equal(result.length, 2);
  assert.equal(result[0].label, undefined);
  assert.equal(result[1].type, 'text');
  assert.equal(result[1].containerId, null, 'arrow labels are not container-bound');
  assert.ok(Math.abs(result[1].x + result[1].width / 2 - 100) < 1, 'label is centred on the arrow box');
});

test('elements without a label are unchanged and empty labels are ignored', () => {
  const rect = base('r1', 'rectangle', 0, 0, 100, 50);
  const empty = base('r2', 'rectangle', 0, 0, 100, 50, {label: {text: '   '}});
  const result = bindDiagramLabels([rect, empty]);
  assert.equal(result.length, 2);
  assert.equal(result[0], rect);
  assert.equal(result[1], empty);
});
