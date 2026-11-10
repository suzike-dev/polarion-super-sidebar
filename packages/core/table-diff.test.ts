import test from 'node:test';
import assert from 'node:assert/strict';
import {diffTable} from './table-diff.ts';

const table = (rows: string) => `<table><tbody>${rows}</tbody></table>`;
const header = '<tr><th>IO</th><th>值</th></tr>';

test('table keeps unchanged rows gray and highlights only the changed cell', () => {
  const diff = diffTable(table(header + '<tr><td>A</td><td>30</td></tr>'), table(header + '<tr><td>A</td><td>35</td></tr>'));
  assert.equal(diff.changed, true);
  assert.match(diff.before, /data-cw-row="same"/);
  assert.match(diff.before, /data-cw-cell="changed">30</);
  assert.match(diff.after, /data-cw-cell="changed"/);
  assert.match(diff.after, /data-cw-cell="changed">35</);
  assert.doesNotMatch(diff.before, /data-cw-row="removed"/);
});

test('added row is green on the after side with an aligned placeholder on the before side', () => {
  const diff = diffTable(table(header + '<tr><td>A</td><td>30</td></tr>'), table(header + '<tr><td>A</td><td>30</td></tr><tr><td>B</td><td>40</td></tr>'));
  assert.equal(diff.changed, true);
  assert.match(diff.after, /data-cw-row="added"/);
  assert.match(diff.before, /data-cw-row="gap"/);
});

test('identical tables are not marked changed', () => {
  const diff = diffTable(table(header + '<tr><td>A</td><td>30</td></tr>'), table(header + '<tr><td>A</td><td>30</td></tr>'));
  assert.equal(diff.changed, false);
  assert.match(diff.before, /data-cw-row="same"/);
});
