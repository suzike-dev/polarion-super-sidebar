export const workbenchHost = 'polarion-super-sidebar';

/** Listen on the page for outside focus and on the open workbench root for isolated keys. */
export function listenWorkbenchKeydown(page: Window | Document, listener: (event: KeyboardEvent) => void, inside: 'capture' | 'bubble' = 'bubble') {
  const root = document.querySelector(workbenchHost)?.shadowRoot;
  const isolated = (event: Event) => {
    // A composed event already took the page path. Local Escape handlers get first refusal in bubble phase.
    if (!event.composed && !event.defaultPrevented) listener(event as KeyboardEvent);
  };
  const capture = inside === 'capture';
  page.addEventListener('keydown', listener as EventListener, true);
  root?.addEventListener('keydown', isolated, capture);
  return () => {
    page.removeEventListener('keydown', listener as EventListener, true);
    root?.removeEventListener('keydown', isolated, capture);
  };
}
