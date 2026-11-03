import type {TextFormat} from '../../packages/core/format-document.ts';
// Only standalone, explicit formatting commands qualify. Complex requests use the agent.
export function formatIntent(prompt:string):TextFormat|null{
 const p=prompt.trim().replace(/[。！!]$/,'');
 const color=p.match(/^(?:请)?(?:(?:把|将)?(?:选中(?:的)?|所选|这段)?(?:文本|文字|字体)(?:的)?(?:颜色)?)(?:改成|改为|设为|设置为|变成)(黑色|红色|蓝色|绿色|灰色|#[\da-fA-F]{6})$/);
 if(color){const colors:Record<string,string>={'黑色':'#000000','红色':'#dc2626','蓝色':'#2563eb','绿色':'#15803d','灰色':'#64748b'};return{color:colors[color[1]!]??color[1]!.toLowerCase()};}
 if(/^(?:请)?(?:把|将)?(?:选中(?:的)?|所选|这段)?(?:文字|文本|字体)?(?:加粗|设为粗体)$/.test(p))return{bold:true};
 return null;
}
