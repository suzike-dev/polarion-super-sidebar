/** Portable defaults for newly authored content. Existing source styles win. */
// Whole point presets avoid LiveDoc's rounding and adjacent-size normalization.
export const headingSizes = [20, 18, 16, 14, 12, 11] as const;
export function documentNodeStyle(type: string, attrs: Record<string, any> = {}) {
  const text = "font-family:'Segoe UI',Selawik,'Open Sans',Arial,sans-serif;font-size:10pt;line-height:1.5;color:#000000";
  const styles: Record<string, string> = {
    paragraph: `${text};margin:0`,
    heading: `${text};font-size:${headingSizes[Number(attrs.level ?? 1)-1] ?? 20}pt;font-weight:600;line-height:${Number(attrs.level??1)<=3?'1.2':'1.5'};margin:0`,
    bulletList: `${text};padding-left:26px;margin:10px 0`,
    orderedList: `${text};padding-left:26px;margin:10px 0`,
    blockquote: `${text};border-left:3px solid #87a9d4;background-color:#f6f9fd;padding:12px 17px;margin:16px 0`,
    table: 'border-collapse:collapse;width:100%',
    tableCell: `${text};border:1px solid #cbd6e5;padding:9px 11px;vertical-align:top`,
    tableHeader: `${text};border:1px solid #cbd6e5;padding:9px 11px;vertical-align:top;background-color:#edf3fb;font-weight:600;text-align:left`,
    horizontalRule: 'border:0;border-top:1px solid #d7e1ed;margin:22px 0',
    code: 'background-color:#eef2f7;padding:2px 5px;color:#af4e66;font-size:.92em;font-family:Consolas,monospace',
  };
  return styles[type] ?? '';
}
