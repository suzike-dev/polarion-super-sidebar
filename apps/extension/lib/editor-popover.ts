/** Keep tool forms inside the visible editor, including the short editor above a docked assistant. */
export function editorPopoverPlacement(frame:{left:number;right:number;top:number;bottom:number},anchorBottom:number,viewport:{width:number;height:number},contentHeight:number){
  const left=Math.max(8,Math.min(frame.left+8,viewport.width-16));
  const right=Math.max(left+1,Math.min(frame.right-8,viewport.width-8));
  const upper=Math.max(8,Math.min(frame.top+8,viewport.height-16));
  const lower=Math.max(upper+1,Math.min(frame.bottom-8,viewport.height-8));
  const height=Math.min(460,lower-upper,contentHeight);
  const top=Math.max(upper,Math.min(anchorBottom+6,lower-height));
  return {left,top,width:Math.min(414,right-left),maxHeight:Math.min(460,lower-top)};
}
