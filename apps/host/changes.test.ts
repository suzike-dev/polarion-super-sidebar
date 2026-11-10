import test from 'node:test';
import assert from 'node:assert/strict';
import {fieldAt} from './changes.ts';

const at = (value: string) => Date.parse(value);

test('fieldAt walks history backwards and stops at the requested time', () => {
  const history = [
    {revision: '3', date: '2026-11-10T09:00:00.000Z', diffs: [{field: 'description', before: '<p>B</p>', after: '<p>C</p>'}]},
    {revision: '2', date: '2026-11-10T08:00:00.000Z', diffs: [{field: 'description', before: '<p>A</p>', after: '<p>B</p>'}]},
  ];
  assert.equal(fieldAt(history, at('2026-11-10T07:00:00.000Z'), 'description', '<p>C</p>'), '<p>A</p>');
  assert.equal(fieldAt(history, at('2026-11-10T08:30:00.000Z'), 'description', '<p>C</p>'), '<p>B</p>');
  assert.equal(fieldAt(history, at('2026-11-10T09:30:00.000Z'), 'description', '<p>C</p>'), '<p>C</p>');
});

test('fieldAt accepts text objects and reconstructs title changes', () => {
  const history = [
    {revision: '2', date: '2026-11-10T09:00:00.000Z', diffs: [
      {field: 'title', before: '旧标题', after: '新标题'},
      {field: 'description', before: {content: '<p>旧正文</p>'}, after: {content: '<p>新正文</p>'}},
    ]},
  ];
  assert.equal(fieldAt(history, at('2026-11-10T07:00:00.000Z'), 'title', '新标题'), '旧标题');
  assert.equal(fieldAt(history, at('2026-11-10T07:00:00.000Z'), 'description', '<p>新正文</p>'), '<p>旧正文</p>');
});

test('fieldAt treats a first-time field write as empty before that revision', () => {
  const history = [
    {revision: '2', date: '2026-11-10T09:00:00.000Z', diffs: [{field: 'description', before: undefined, after: '<p>首次写入</p>'}]},
  ];
  assert.equal(fieldAt(history, at('2026-11-10T08:00:00.000Z'), 'description', '<p>首次写入</p>'), '');
});
