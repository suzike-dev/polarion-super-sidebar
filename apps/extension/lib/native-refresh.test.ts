import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { nativeWorkItemRefresh } from './native-refresh.ts';

const workItemId = 'QA-10';
const id = 'polarion_wiki macro name=module-workitem;params=id=' + workItemId;
const title = 'Sample section';
const reference = (target: string, label = '') => `<span class="polarion-rte-link" data-type="workItem" data-item-id="${target}" data-option-id="long">${label}</span>`;
const storedRefs = reference('QA-21') + ' / ' + reference('QA-22');
const displayedRefs = reference('QA-21', '<span class="polarion-no-style-cleanup"><a>QA-21 Linked item</a></span>') + ' / ' +
  reference('QA-22', '<span class="polarion-no-style-cleanup"><span><img></span><span>Item does not exist</span></span>');
const stored = '<p>Sample text</p><table><tbody><tr><th><p></p></th><td><p>Cell value</p></td></tr></tbody></table>' +
  '<ol><li><p></p><ul><li><p>Nested item</p></li></ul></li></ol><p>See ' + storedRefs + '</p>';
const displayed = '<span>Sample text<br></span><table><tbody><tr><th><br></th><td>Cell value</td></tr></tbody></table>' +
  '<ol><li></li><ul><li>Nested item<br></li></ul></ol><span>See ' + displayedRefs + '</span>';
const card = (content: string) => `<div id="${id}" class="polarion-dle-workitem-basic-internal"><span class="polarion-dle-workitem-icon-container">icon</span><span id="polarion_editor_fields_container_start">${workItemId}</span>${content}<span id="polarion_editor_fields_container_end">status</span></div>`;
// The native title field includes the generated item number; its trailing BR is
// inside the title span. The description may start with a bare text node.
const titledCard = (content: string, text = title) => `<div id="${id}" class="polarion-dle-workitem-basic-internal"><span class="polarion-dle-workitem-icon-container"></span><span id="polarion_editor_field=title" class="polarion-dle-workitem-title"><span id="polarion_editor_fields_container_start" class="polarion-dle-workitem-fields-start">${workItemId} – </span>${text}<br></span>${content}<table id="polarion_editor_fields_container_end" contenteditable="false"><tr><td>Status</td></tr></table></div>`;
const heading = (text: string, level = 1, live = false) => {
  const tag = level > 6 ? 'div' : `h${level}`;
  return `<${tag} id="${id}"${level > 6 ? ` class="heading-${level}"` : ''}><span class="polarion-dle-workitem-icon-container${live ? '-decorations' : ''}">${live ? '<img>' : 'icon'}</span><span id="polarion_editor_fields_container_start" class="polarion-dle-workitem-fields-start">1.2.3</span>${text}</${tag}>`;
};
const mismatch = { ok: false, error: 'NATIVE_REFRESH_CONTENT_MISMATCH' };

type Options = {
  phase?: 'check' | 'refresh';
  expectedHtml?: string;
  reply?: string;
  nativeId?: string;
  mountedHtml?: string;
  documentHtml?: string;
  setup?: (runtime: Record<string, unknown>, top: Window) => void;
  afterPaint?: string;
  suspendedFrames?: 'visible' | 'hidden';
  afterInstall?: (doc: Document) => void;
  duringRead?: (read: number, doc: Document, win: Window) => void;
};

/** Run the serialized MAIN-world entry point. Only the two native reads and
 * the pinned GWT model/DOM installation are simulated. */
async function refresh(options: Options = {}) {
  const href = 'https://polarion.pufafen.com/polarion/#/project/synthetic';
  const dom = new JSDOM('<button id="gwt-debug-toolbar-save" class="Button-disabled"></button><iframe id="gwt-debug-polarion-DLE-area-debug-id"></iframe><iframe id="com.polarion.UI"></iframe>', { url: href, runScripts: 'outside-only' });
  try {
    const win = dom.window;
    const [frame, runtime] = win.document.querySelectorAll('iframe');
    Object.defineProperty(frame!, 'src', {value: href + '/6CFA8B41DF5960703FD822D08642B011.cache.html'});
    frame!.contentWindow!.scrollTo = () => {};
    const doc = frame!.contentDocument!;
    const nativeId = options.nativeId ?? id;
    const documentHtml = options.documentHtml ?? `<div id="${nativeId}" name="wi-placeholder"></div>`;
    doc.body.innerHTML = options.mountedHtml ?? documentHtml;
    Object.defineProperty(win.document, 'hidden', {value: options.suspendedFrames === 'hidden'});
    win.cancelAnimationFrame = () => {};
    win.requestAnimationFrame = callback => {
      if (options.suspendedFrames) return 1;
      if (options.afterPaint !== undefined) doc.body.innerHTML = options.afterPaint;
      callback(0); return 1;
    };
    const editor = { i: {q: {}}, p: {}, C: {} };
    let reads = 0, adoptions = 0, replacements = 0;
    const fresh = { w: {a: 'current revision'}, p: {}, i: {C: documentHtml} };
    const entry = { f: nativeId, g: options.reply ?? card(displayed) };
    const requestedIds: string[] = [];
    class NativeValue {}
    const methods = {
      ieu: {D: {d: {a: {e: editor}}}}, Sql: () => false, RYh: () => ({}), JEh: NativeValue,
      Wsi: class { constructor(key: string) { requestedIds.push(key); } }, lte() {}, g5r() {}, lmo() {}, EXh: NativeValue, $Bi: NativeValue,
      img(_service: unknown, _request: unknown, callback: { Zd(value: unknown): void }) {
        reads++;
        options.duringRead?.(reads, doc, win as unknown as Window);
        callback.Zd(reads === 1 ? fresh : { f: {a: [entry]} });
      },
      Wlw: NativeValue, bmw: class { d = 0; e = {a: {d: 1}}; },
      amw(iterator: {d: number}) { iterator.d++; return entry; },
      AXh() { adoptions++; doc.body.innerHTML = documentHtml; },
      SWh(_model: unknown, callback: {Up(transaction: unknown): void}) { callback.Up({}); },
      hWh: (_transaction: unknown, key: string) => key === nativeId && doc.getElementById(key) ? {d: {k: {}}} : null,
      uGi(_part: unknown, html: string) { replacements++; doc.getElementById(nativeId)!.outerHTML = html; },
      wsi() { options.afterInstall?.(doc); }, xsi: NativeValue,
    };
    options.setup?.(methods, win as unknown as Window);
    Object.assign(runtime!.contentWindow!, methods);
    const invoke = win.eval(`(${nativeWorkItemRefresh.toString()})`) as typeof nativeWorkItemRefresh;
    const result = await invoke({ href, workItemId, phase: options.phase ?? 'refresh', expectedHtml: options.expectedHtml ?? stored, expectedTitle: title });
    return { result: JSON.parse(JSON.stringify(result)), reads, requestedIds, adoptions, replacements, renderedTag: doc.getElementById(nativeId)?.localName };
  } finally { dom.window.close(); }
}

test('numbered title and footer are native fields; bare description text, tables and lists must still match', async () => {
  const content = `${title} is also body text<div>Matrix</div><table><tr><td>A</td><td>B</td></tr></table><br>Steps<br><ol><li>First</li><li>Second</li></ol>`;
  const run = await refresh({expectedHtml: content, reply: titledCard(content), afterPaint: titledCard(content).replace('icon-container"', 'icon-container-decorations"')});
  assert.deepEqual(run.result, {ok: true});
  for (const bad of [titledCard(content.replace(`${title} is`, 'is')), titledCard(content, 'Previous section'), titledCard(content.replace('<td>B</td>', '<td></td>'))]) {
    const before = await refresh({expectedHtml: content, reply: bad});
    assert.deepEqual(before.result, mismatch);
    assert.equal(before.adoptions, 0);
    const after = await refresh({expectedHtml: content, reply: titledCard(content), afterPaint: bad});
    assert.deepEqual(after.result, {ok: true, degraded: true});
    assert.equal(after.adoptions, 1);
  }
});

test('the write check verifies the document even when the target is only an inline reference and the refresh method is unavailable', async () => {
  const mountedHtml = '<h2>Other section</h2>' + reference(workItemId);
  const pre = await refresh({phase: 'check', mountedHtml, setup(runtime) { delete runtime.$Bi; }});
  assert.deepEqual(pre.result, {ok: true});
  assert.equal(pre.reads, 0);
  assert.equal(pre.adoptions, 0);
  const post = await refresh({mountedHtml});
  assert.deepEqual(post.result, {ok: false, error: 'NATIVE_ITEM_NOT_LOADED'});
  assert.equal(post.adoptions, 0);
});

test('dirty and unverifiable native state block both phases even if the requested item is absent', async () => {
  for (const phase of ['check', 'refresh'] as const) {
    for (const [error, setup] of [
      ['NATIVE_EDITOR_DIRTY', (runtime) => { runtime.Sql = () => true; }],
      ['NATIVE_EDITOR_UNKNOWN', (_runtime, top) => { top.document.getElementById('gwt-debug-toolbar-save')!.className = 'Button-enabled'; }],
      ['NATIVE_EDITOR_UNKNOWN', (runtime) => { delete runtime.RYh; }],
    ] as [string, NonNullable<Options['setup']>][]) {
      const run = await refresh({phase, mountedHtml: '', setup});
      assert.deepEqual(run.result, {ok: false, error});
      assert.equal(run.reads, 0);
      assert.equal(run.adoptions, 0);
    }
  }
});

test('layout and level parameters identify the exact native part fetched at the fresh revision', async () => {
  for (const nativeId of [id + '|layout=1', id + '|level=1']) {
    const run = await refresh({nativeId, reply: titledCard(displayed).replace(id, nativeId)});
    assert.deepEqual(run.result, {ok: true});
    assert.deepEqual(run.requestedIds, [nativeId]);
    assert.equal(run.replacements, 1);
  }
  for (const other of [id + '1', id + '|project=other', id + '|new=1']) {
    const run = await refresh({documentHtml: `<div id="${other}"></div>`});
    assert.deepEqual(run.result, {ok: false, error: 'NATIVE_ITEM_NOT_LOADED'});
    assert.equal(run.adoptions, 0);
  }
});

test('a native heading beyond H6 keeps its title and level from the document response', async () => {
  const options = {expectedHtml: '', reply: titledCard(''), documentHtml: heading(title, 7)};
  const run = await refresh({...options, afterPaint: heading(title, 7, true)});
  assert.deepEqual(run.result, {ok: true, projection: 'heading'});
  assert.equal(run.replacements, 0);
  for (const afterPaint of [heading(title, 8), heading('Previous section', 7), titledCard('')]) {
    assert.deepEqual((await refresh({...options, afterPaint})).result, {ok: true, projection: 'heading', degraded: true});
  }
});

test('native refresh compares the two reference targets across table and nested list rendering', async () => {
  const run = await refresh();
  assert.deepEqual(run.result, {ok: true});
  assert.equal(run.replacements, 1);
});

test('a LiveDoc heading keeps the verified document title while the item card verifies its saved description', async () => {
  const run = await refresh({documentHtml: heading(title), afterPaint: heading(title, 1, true)});
  assert.deepEqual(run.result, {ok: true, projection: 'heading'});
  assert.equal(run.adoptions, 1);
  assert.equal(run.replacements, 0);
  assert.equal(run.renderedTag, 'h1');
});

test('a valid heading cannot mask a stale description or a changed reference target in the item read', async () => {
  for (const stale of [displayed.replace('Cell value', 'Old value'), displayed.replace('data-item-id="QA-22"', 'data-item-id="QA-23"')]) {
    const run = await refresh({documentHtml: heading(title), reply: card(stale)});
    assert.deepEqual(run.result, mismatch);
    assert.equal(run.adoptions, 0);
  }
});

test('a stale document title fails before adoption and a stale visible title or level fails after it', async () => {
  const before = await refresh({documentHtml: heading('Old section')});
  assert.deepEqual(before.result, {ok: true, projection: 'heading', degraded: true});
  assert.equal(before.adoptions, 1);
  for (const afterPaint of [heading('Old section'), heading(title, 2), card(displayed)]) {
    const after = await refresh({documentHtml: heading(title), afterPaint});
    assert.deepEqual(after.result, {ok: true, projection: 'heading', degraded: true});
    assert.equal(after.adoptions, 1);
  }
});

test('a clean card response still fails when the installed body is stale', async () => {
  const run = await refresh({afterPaint: card(displayed.replace('Nested item', 'Old item'))});
  assert.deepEqual(run.result, {ok: true, degraded: true});
  assert.equal(run.adoptions, 1);
});

for (const visibility of ['visible', 'hidden'] as const) {
  test(`a ${visibility} tab with suspended frames verifies the installed DOM and native input`, {timeout: 3000}, async () => {
    const run = (afterInstall?: Options['afterInstall']) => refresh({suspendedFrames: visibility, afterInstall});
    const [current, stale, edited] = await Promise.all([
      run(), run(doc => { doc.body.innerHTML = card('Stale body'); }),
      run(doc => { doc.body.dispatchEvent(new doc.defaultView!.Event('input', {bubbles: true})); }),
    ]);
    assert.deepEqual(current.result, {ok: true});
    assert.deepEqual(stale.result, {ok: true, degraded: true});
    assert.deepEqual(edited.result, {ok: false, error: 'NATIVE_EDITOR_DIRTY'});
  });
}

test('empty, reference-only and plain text descriptions require an exact body match', async () => {
  for (const [expectedHtml, content] of [
    ['', 'previous value'], [storedRefs, ' / '], [storedRefs, displayedRefs.replace('data-item-id="QA-21"', 'data-item-id="QA-22"')],
    [storedRefs, displayedRefs.replace('data-item-id="QA-21"', 'data-scope="elsewhere" data-item-id="QA-21"')],
    ['<a href="/one">More</a>', '<a href="/two">More</a>'],
    ['<p>Sample</p>', 'Sample with obsolete suffix'], ['<p>status</p>', ''],
    ['<table><tr><td>A</td><td>B</td></tr></table>', '<table><tr><td>AB</td><td></td></tr></table>'],
    ['<ul><li>A<ul><li>B</li></ul></li></ul>', '<ul><li>A</li><li>B</li></ul>'],
  ]) {
    const run = await refresh({expectedHtml, reply: card(content!)});
    assert.deepEqual(run.result, mismatch);
    assert.equal(run.adoptions, 0);
  }
  assert.deepEqual((await refresh({expectedHtml: '', reply: card('<br>')})).result, {ok: true});
  assert.deepEqual((await refresh({expectedHtml: storedRefs, reply: card(displayedRefs)})).result, {ok: true});
});

test('input in the iframe is protected even before GWT marks the native Save button dirty', async () => {
  const run = await refresh({duringRead(read, doc) {
    if (read === 2) doc.body.dispatchEvent(new doc.defaultView!.Event('input', {bubbles: true}));
  }});
  assert.deepEqual(run.result, {ok: false, error: 'NATIVE_EDITOR_DIRTY'});
  assert.equal(run.adoptions, 0);
  assert.equal(run.replacements, 0);
});

test('a native edit while the last read is in flight prevents adoption', async () => {
  const run = await refresh({duringRead(read, _doc, win) {
    if (read === 2) win.document.getElementById('gwt-debug-toolbar-save')!.className = 'Button-enabled';
  }});
  assert.deepEqual(run.result, {ok: false, error: 'NATIVE_EDITOR_UNKNOWN'});
  assert.equal(run.adoptions, 0);
  assert.equal(run.replacements, 0);
});
