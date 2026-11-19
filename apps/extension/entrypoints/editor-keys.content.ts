import { defineContentScript } from 'wxt/utils/define-content-script';
import { dispatchUserClick } from '../lib/ui-event-trust';
import { workbenchHost } from '../lib/workbench-keyboard';

function workbenchTarget(event: Event) {
  if (!event.isTrusted) return;
  const path = event.composedPath();
  if (path.some(node => node instanceof ShadowRoot && node.host.localName === workbenchHost)) return path[0];
}

function isolateKey(event: KeyboardEvent) {
  const target = workbenchTarget(event);
  if (!target) return;
  event.stopImmediatePropagation();
  const copy = new KeyboardEvent(event.type, {
    bubbles: true, composed: false, cancelable: event.cancelable, view: event.view,
    key: event.key, code: event.code, location: event.location, repeat: event.repeat, isComposing: event.isComposing,
    ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey, altKey: event.altKey,
  });
  for (const key of ['keyCode', 'charCode', 'which'] as const) Object.defineProperty(copy, key, { value: event[key] });
  Object.defineProperty(copy, 'getModifierState', { value: event.getModifierState.bind(event) });
  const accepted = target.dispatchEvent(copy);
  const saveShortcut = event.type === 'keydown' && !event.isComposing && !event.altKey && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's';
  if (!accepted || saveShortcut) event.preventDefault();
}

function isolateClick(event: MouseEvent) {
  const target = workbenchTarget(event);
  if (!target) return;
  event.stopImmediatePropagation();
  // A MouseEvent named click would run HTML activation again, including the checkbox's pre-click toggle.
  // Notify the shadow tree synchronously; let the original perform or cancel its own default action once.
  const copy = new UIEvent(event.type, { bubbles: true, composed: false, cancelable: event.cancelable, view: event.view, detail: event.detail });
  for (const key of ['button', 'buttons', 'clientX', 'clientY', 'screenX', 'screenY', 'pageX', 'pageY', 'offsetX', 'offsetY', 'movementX', 'movementY', 'relatedTarget', 'which', 'ctrlKey', 'metaKey', 'shiftKey', 'altKey'] as const) {
    Object.defineProperty(copy, key, { value: event[key] });
  }
  Object.defineProperty(copy, 'getModifierState', { value: event.getModifierState.bind(event) });
  if (!dispatchUserClick(target, event, copy)) event.preventDefault();
}

export default defineContentScript({
  matches: ['https://polarion.pufafen.com/polarion/*'], runAt: 'document_start', allFrames: false,
  main(ctx) {
    // Polarion registers capture shortcuts on window before the workbench mounts.
    for (const type of ['keydown', 'keyup', 'keypress'] as const) ctx.addEventListener(window, type, isolateKey, { capture: true });
    for (const type of ['click', 'dblclick'] as const) ctx.addEventListener(window, type, isolateClick, { capture: true });
  },
});
