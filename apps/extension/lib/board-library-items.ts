import type {LibraryItem, LibraryItems} from '@excalidraw/excalidraw/types';
import type {BoardElement} from '../../../packages/core/board-changes';

// Original editable vector artwork; no third-party icon or image assets are used.
// Stable IDs are installation identities, not content hashes: a user's saved copy wins.
export const BOARD_LIBRARY_VERSION = 1;
export const BOARD_LIBRARY_COUNT = 36;
export const BOARD_LIBRARY_CATEGORIES = ['流程', '系统与接口', '控制逻辑', '热管理'] as const;
const palette = {ink:'#292f32', muted:'#687176', accent:'#356c7c', tint:'#e9f0f1', paper:'#ffffff', neutral:'#f5f6f5'};
const created = Date.UTC(2026,10,4);
const seed = (text:string) => {let value=2166136261;for(const char of text)value=Math.imul(value^char.charCodeAt(0),16777619);return (value>>>0)%2147483646+1;};

class Artwork {
  readonly elements:BoardElement[]=[];
  readonly id:string;
  constructor(id:string){this.id=id;}
  base(type:string,x:number,y:number,width:number,height:number):BoardElement {
    const id=this.id+'-'+this.elements.length;
    const element:BoardElement={id,type,x,y,width,height,angle:0,strokeColor:palette.ink,backgroundColor:'transparent',fillStyle:'solid',strokeWidth:2,strokeStyle:'solid',roughness:0,opacity:100,groupIds:[],frameId:null,index:null,roundness:null,seed:seed(id),version:1,versionNonce:seed(id+'nonce'),isDeleted:false,boundElements:[],updated:created,link:null,locked:false};
    this.elements.push(element);return element;
  }
  text(text:string,x:number,y:number,width:number,size=18,container:BoardElement|null=null){
    const height=text.split('\n').length*size*1.25;
    const element=Object.assign(this.base('text',x,y,width,height),{text,originalText:text,fontSize:size,fontFamily:2,textAlign:'center',verticalAlign:container?'middle':'top',containerId:container?.id??null,autoResize:false,lineHeight:1.25,strokeWidth:1});
    if(container)container.boundElements.push({id:element.id,type:'text'});
    return element;
  }
  node(text:string,x=0,y=0,width=160,height=64,type='rectangle',accent=false){
    const node=Object.assign(this.base(type,x,y,width,height),{backgroundColor:accent?palette.tint:palette.paper,strokeColor:accent?palette.accent:palette.muted,roundness:type==='rectangle'?{type:3,value:8}:null});
    if(text){const inset=type==='diamond'?width*.25:type==='ellipse'?width*.2:16;this.text(text,x+inset,y+(height-text.split('\n').length*22.5)/2,width-2*inset,18,node);}
    return node;
  }
  line(points:[number,number][],color=palette.muted):BoardElement{
    const [x,y]=points[0]!;return Object.assign(this.base('line',x,y,Math.max(...points.map(p=>p[0]))-Math.min(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))-Math.min(...points.map(p=>p[1]))),{points:points.map(p=>[p[0]-x,p[1]-y]),strokeColor:color,lastCommittedPoint:null,startBinding:null,endBinding:null,startArrowhead:null,endArrowhead:null});
  }
  arrow(from:BoardElement,to:BoardElement,points:[number,number][],start=[1,.5],end=[0,.5]){
    const arrow=this.line(points);arrow.type='arrow';Object.assign(arrow,{startBinding:{elementId:from.id,focus:0,gap:8,fixedPoint:start},endBinding:{elementId:to.id,focus:0,gap:8,fixedPoint:end},endArrowhead:'arrow',elbowed:true,roundness:{type:2},fixedSegments:points.slice(2,-1).map((p,i)=>({index:i+2,start:arrow.points[i+1],end:arrow.points[i+2]})),startIsSpecial:false,endIsSpecial:false});
    from.boundElements.push({id:arrow.id,type:'arrow'});to.boundElements.push({id:arrow.id,type:'arrow'});return arrow;
  }
  caption(text:string,x:number,y:number,width:number){
    const mask=this.base('rectangle',x,y,width,28);Object.assign(mask,{backgroundColor:palette.paper,strokeColor:'transparent',strokeWidth:0});this.text(text,x+4,y+4,width-8,16,mask);return mask;
  }
  symbolLabel(text:string){this.text(text,0,100,160);}
  finish(name:string,category:string):LibraryItem {
    // A library item is a movable group; users can enter or ungroup it to edit parts.
    for(const element of this.elements){element.groupIds=[this.id+'-group'];element.customData={boardLibrary:{id:this.id,category,version:BOARD_LIBRARY_VERSION}};}
    // Connectors behind nodes; text and labels retain their native bindings.
    return {id:this.id,name:category+' · '+name,status:'published',created,elements:[...this.elements.filter(e=>e.type==='arrow'),...this.elements.filter(e=>e.type!=='arrow')] as unknown as LibraryItem['elements']};
  }
}

export function createBoardLibraryItems():LibraryItems {
  const items:LibraryItem[]=[];
  const add=(category:string,key:string,name:string,draw:(a:Artwork)=>void)=>{const a=new Artwork('pss-builtin-v1-'+key);draw(a);items.push(a.finish(name,category));};
  const flow=(key:string,name:string,draw:(a:Artwork)=>void)=>add('流程',key,name,draw);
  const system=(key:string,name:string,draw:(a:Artwork)=>void)=>add('系统与接口',key,name,draw);
  const control=(key:string,name:string,draw:(a:Artwork)=>void)=>add('控制逻辑',key,name,draw);
  const thermal=(key:string,name:string,draw:(a:Artwork)=>void)=>add('热管理',key,name,draw);

  flow('start','开始',a=>{a.node('开始',0,0,144,64,'ellipse',true);});
  flow('end','结束',a=>{a.node('结束',0,0,144,64,'ellipse');});
  flow('process','处理步骤',a=>{a.node('处理步骤');});
  flow('decision','条件判断',a=>{a.node('条件成立？',0,0,224,120,'diamond');});
  flow('subprocess','子流程',a=>{a.node('子流程');a.line([[12,0],[12,64]]);a.line([[148,0],[148,64]]);});
  flow('input-output','输入输出',a=>{const shape=a.line([[24,0],[184,0],[160,64],[0,64],[24,0]]);shape.backgroundColor=palette.paper;a.text('输入 / 输出',24,20,136);});
  flow('branch','条件分支',a=>{const d=a.node('条件？',0,0,176,112,'diamond'),yes=a.node('执行',256,24,120,64),no=a.node('保持',28,192,120,64);a.arrow(d,yes,[[184,56],[248,56]]);a.arrow(d,no,[[88,120],[88,184]],[.5,1],[.5,0]);a.caption('是',192,20,48);a.caption('否',104,136,48);});
  flow('retry','循环复检',a=>{const check=a.node('检查',0,0,128,64),step=a.node('处理',224,0,128,64);a.arrow(check,step,[[136,32],[216,32]]);a.arrow(step,check,[[288,72],[288,128],[64,128],[64,72]],[.5,1],[.5,1]);a.caption('复检',144,140,64);});

  system('component','软件组件',a=>{a.node('软件组件',0,0,192,96);a.node('',164,12,16,12);a.node('',164,32,16,12);});
  system('boundary','系统边界',a=>{const b=a.node('',0,0,256,152);b.strokeStyle='dashed';b.backgroundColor='transparent';a.caption('系统边界',12,4,104);a.node('内部组件',40,64,176,64);});
  system('input-port','输入接口',a=>{const port=a.node('输入',0,16,80,48),body=a.node('组件',160,0,128,80);a.arrow(port,body,[[88,40],[152,40]]);});
  system('output-port','输出接口',a=>{const body=a.node('组件',0,0,128,80),port=a.node('输出',208,16,80,48);a.arrow(body,port,[[136,40],[200,40]]);});
  system('request-response','请求应答',a=>{const client=a.node('调用方',0,0,128,112),server=a.node('服务方',288,0,128,112);a.arrow(client,server,[[136,32],[280,32]],[1,.2857],[0,.2857]);const reply=a.arrow(server,client,[[280,80],[136,80]],[0,.7143],[1,.7143]);reply.strokeStyle='dashed';a.caption('请求',176,-4,64);a.caption('应答',176,88,64);});
  system('message-bus','消息总线',a=>{const bus=a.node('消息总线',0,152,352,48),one=a.node('节点 A',0,0,128,64),two=a.node('节点 B',224,0,128,64);a.arrow(one,bus,[[64,72],[64,144]],[.5,1],[64/352,0]);a.arrow(two,bus,[[288,72],[288,144]],[.5,1],[288/352,0]);});
  system('data-store','数据存储',a=>{a.node('',0,16,160,80);a.node('',0,0,160,32,'ellipse');a.line([[0,80],[0,96],[16,108],[144,108],[160,96],[160,80]]);a.text('数据存储',16,44,128);});
  system('layers','分层架构',a=>{const application=a.node('应用层',0,0,224,48,'rectangle',true),service=a.node('服务层',0,80,224,48),driver=a.node('驱动层',0,160,224,48);a.arrow(application,service,[[112,56],[112,72]],[.5,1],[.5,0]);a.arrow(service,driver,[[112,136],[112,152]],[.5,1],[.5,0]);});

  control('gain','增益',a=>{a.node('增益\nK',0,0,144,88);});
  control('limit','限幅',a=>{a.node('限幅',0,0,160,64);a.text('下限 ≤ 输出 ≤ 上限',0,80,192,16);});
  control('filter','一阶滤波',a=>{a.node('一阶滤波',0,0,176,64);a.text('1 / (τs + 1)',0,80,176,16);});
  control('hysteresis','滞回开关',a=>{a.node('滞回开关',0,0,176,64);a.text('开启阈值 / 关闭阈值',0,80,192,16);});
  control('delay','延时确认',a=>{a.node('延时确认',0,0,176,64);a.text('条件持续 t ≥ T',0,80,176,16);});
  control('pi','PI 控制器',a=>{a.node('PI 控制器',0,0,176,64,'rectangle',true);a.text('Kp + Ki / s',0,80,176,16);});
  control('priority','优先级仲裁',a=>{const a1=a.node('请求 A',0,0,112,56),a2=a.node('请求 B',0,120,112,56),out=a.node('优先级\n仲裁',224,48,144,80,'rectangle',true);a.arrow(a1,out,[[120,28],[176,28],[176,68],[216,68]],[1,.5],[0,.25]);a.arrow(a2,out,[[120,148],[176,148],[176,108],[216,108]],[1,.5],[0,.75]);});
  control('feedback','反馈控制环',a=>{const c=a.node('控制器',0,0,144,64,'rectangle',true),p=a.node('被控对象',256,0,160,64),s=a.node('传感器',128,152,144,64);a.arrow(c,p,[[152,32],[248,32]]);a.arrow(p,s,[[336,72],[336,184],[280,184]],[.5,1],[1,.5]);a.arrow(s,c,[[120,184],[72,184],[72,72]],[0,.5],[.5,1]);a.caption('反馈',8,120,64);});

  thermal('battery','动力电池',a=>{a.node('',16,8,128,80);a.line([[56,8],[56,88]]);a.line([[100,8],[100,88]]);a.line([[0,32],[16,32]]);a.line([[144,32],[160,32]]);a.text('＋',20,16,32,20);a.text('−',108,16,32,20);a.symbolLabel('动力电池');});
  thermal('motor','电驱总成',a=>{a.node('M',32,8,96,80,'ellipse');a.line([[128,48],[156,48]]);a.line([[0,48],[32,48]]);a.symbolLabel('电驱总成');});
  thermal('compressor','压缩机',a=>{a.node('',32,8,96,80,'ellipse');a.line([[52,28],[108,48],[52,68],[52,28]]);a.line([[0,48],[32,48]]);a.line([[128,48],[160,48]]);a.symbolLabel('压缩机');});
  thermal('pump','循环水泵',a=>{a.node('',40,8,80,80,'ellipse');const arrow=a.line([[60,48],[104,48]],palette.accent);arrow.endArrowhead='arrow';a.line([[0,48],[40,48]]);a.line([[120,48],[160,48]]);a.symbolLabel('循环水泵');});
  thermal('three-way-valve','三通阀',a=>{a.node('',48,16,64,64,'ellipse');a.line([[0,48],[48,48]]);a.line([[112,48],[160,48]]);a.line([[80,80],[80,96]]);a.text('3',60,36,40,20);a.symbolLabel('三通阀');});
  thermal('heat-exchanger','换热器',a=>{a.node('',24,8,112,80);a.line([[0,28],[48,28],[48,68],[112,68],[112,28],[160,28]]);a.line([[0,68],[32,68],[32,44],[128,44],[128,68],[160,68]]);a.symbolLabel('换热器');});
  thermal('heater','电加热器',a=>{a.node('',24,8,112,80);a.line([[0,48],[40,48],[48,28],[64,68],[80,28],[96,68],[112,48],[160,48]],palette.accent);a.symbolLabel('电加热器');});
  thermal('radiator','散热器',a=>{a.node('',24,8,112,80);for(const x of [40,56,72,88,104,120])a.line([[x,16],[x,80]]);a.line([[0,28],[24,28]]);a.line([[136,68],[160,68]]);a.symbolLabel('散热器');});
  thermal('fan','冷却风扇',a=>{a.node('',40,8,80,80,'ellipse');a.node('',72,40,16,16,'ellipse');a.line([[80,40],[60,16],[48,40],[72,48]]);a.line([[88,48],[112,28],[112,60],[88,56]]);a.line([[80,56],[84,84],[56,72],[72,52]]);a.symbolLabel('冷却风扇');});
  thermal('expansion-valve','膨胀阀',a=>{a.line([[16,16],[144,80],[144,16],[16,80],[16,16]]);a.line([[0,48],[16,48]]);a.line([[144,48],[160,48]]);a.line([[80,0],[80,32]]);a.symbolLabel('膨胀阀');});
  thermal('temperature-sensor','温度传感器',a=>{a.node('T',48,8,64,64,'ellipse');a.line([[80,72],[80,88],[144,88]]);a.symbolLabel('温度传感器');});
  thermal('coolant-loop','冷却子回路（示意）',a=>{const pump=a.node('水泵',0,0,112,64),load=a.node('热负载',208,0,128,64),hx=a.node('换热器',208,160,128,64);a.arrow(pump,load,[[120,32],[200,32]]);a.arrow(load,hx,[[272,72],[272,152]],[.5,1],[.5,0]);a.arrow(hx,pump,[[200,192],[56,192],[56,72]],[0,.5],[.5,1]);a.caption('冷却液',60,116,80);a.text('子回路示意 · 按项目确认',0,248,336,16);});
  return items;
}
