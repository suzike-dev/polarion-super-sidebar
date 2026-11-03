const key='__polarionSidebarTrustedEvents';
function events():WeakSet<Event>{const scope=globalThis as unknown as Record<string,unknown>;return(scope[key]??=new WeakSet<Event>()) as WeakSet<Event>;}
// This set lives in the extension's isolated world, not the page's JavaScript world.
export function markUserEvent(event:Event){events().add(event);}
export function isUserEvent(event:Event){return event.isTrusted||events().has(event);}
