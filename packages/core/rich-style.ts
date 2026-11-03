const allowed = /^(?:color|background-color|font-size|font-family|font-weight|font-style|text-decoration|text-align|text-indent|vertical-align|line-height|width|min-width|max-width|height|padding(?:-[a-z]+)?|margin(?:-[a-z]+)?|border(?:-[a-z]+)?|border-collapse|border-spacing|white-space|break-inside|page-break-inside|list-style-type)\s*:/i;
export function safeStyle(input?: string | null) {
  return (input ?? '').split(';').filter(d => allowed.test(d.trim()) && !/[<>\\]|url\s*\(|expression|@|behavior/i.test(d)).join(';');
}
export function styleValues(input?: string | null): Record<string, string> {
  return Object.fromEntries(safeStyle(input).split(';').flatMap(d => { const i=d.indexOf(':'); return i<0?[]:[[d.slice(0,i).trim().toLowerCase(),d.slice(i+1).trim()]]; }));
}
/** Change only properties edited by the user; retain original vendor styles. */
export function mergeSourceStyle(original: string, before?: string | null, after?: string | null) {
  const old=styleValues(before), next=styleValues(after);
  const changed=new Set([...Object.keys(old),...Object.keys(next)].filter(k=>old[k]!==next[k]));
  if(!changed.size)return original;
  const declarations=original.split(';').filter(d=>d.trim()&&!changed.has(d.slice(0,d.indexOf(':')).trim().toLowerCase()));
  for(const key of changed)if(next[key])declarations.push(`${key}:${next[key]}`);
  return declarations.join(';');
}
export function patchStyle(original: string | null | undefined, patch: Record<string,string|null>) {
  const values=styleValues(original);
  for(const [key,value] of Object.entries(patch)) { if(value===null||value==='')delete values[key];else values[key]=value; }
  return safeStyle(Object.entries(values).map(([k,v])=>`${k}:${v}`).join(';'));
}
