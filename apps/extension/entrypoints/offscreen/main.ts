import {browser} from 'wxt/browser';
// Offscreen documents may write image data to the system clipboard even when the
// embedding page's permissions policy blocks the API inside cross-origin iframes.
browser.runtime.onMessage.addListener((message: unknown, sender: {id?: string}) => {
  if ((message as {type?: string})?.type !== 'offscreen-copy-image' || sender.id !== browser.runtime.id) return;
  const dataUrl = String((message as {dataUrl?: string}).dataUrl ?? '');
  return (async () => {
    if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(dataUrl)) throw Error('INVALID_IMAGE_DATA');
    const bytes = Uint8Array.from(atob(dataUrl.slice(dataUrl.indexOf(',') + 1)), ch => ch.charCodeAt(0));
    await navigator.clipboard.write([new ClipboardItem({'image/png': new Blob([bytes], {type: 'image/png'})})]);
    return {ok: true};
  })().catch(error => ({ok: false, error: String((error as Error)?.message ?? error)}));
});
