// Both content scripts share the extension's isolated world. A forwarded click is valid only during its dispatch.
function activeClicks(): WeakSet<Event> {
  const scope = globalThis as typeof globalThis & { __polarionSidebarTrustedEvents?: WeakSet<Event> };
  return scope.__polarionSidebarTrustedEvents ??= new WeakSet<Event>();
}

export function dispatchUserClick(target: EventTarget, original: MouseEvent, copy: UIEvent) {
  if (!original.isTrusted || original.type !== 'click' || copy.type !== 'click') return target.dispatchEvent(copy);
  const clicks = activeClicks();
  clicks.add(copy);
  try { return target.dispatchEvent(copy); }
  finally { clicks.delete(copy); }
}

export function isUserEvent(event: Event) {
  return event.type === 'click' && (event.isTrusted || activeClicks().has(event));
}
