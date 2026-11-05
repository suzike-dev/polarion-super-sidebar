import type {LibraryItem, LibraryItems} from '@excalidraw/excalidraw/types';
import type {BoardElement} from '../../../packages/core/board-changes';
import {elementsBounds} from '../../../packages/core/board-templates.ts';

// Original editable vector artwork; no third-party icon or image assets are used.
// Stable IDs are installation identities, not content hashes: a user's saved copy wins.
export const BOARD_LIBRARY_VERSION = 2;
export const BOARD_LIBRARY_COUNT = 70;
export const BOARD_LIBRARY_CATEGORIES = ['流程', '系统与接口', '控制逻辑', '热管理', '泳道与角色', 'UML 结构', '时序图元', '数据流', '便签标注', '整图模板'] as const;
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
  finish(name:string,category:string,shell:true|'skip'=true):LibraryItem {
    // A library item is a movable group; users can enter or ungroup it to edit parts.
    for(const element of this.elements){element.groupIds=[this.id+'-group'];element.customData={boardLibrary:{id:this.id,category,version:BOARD_LIBRARY_VERSION}};}
    // Excalidraw only binds arrows to rectangle/diamond/ellipse/text/image shapes, never to
    // line art. A solid white shell behind the artwork gives every asset one full-extent
    // snap target so connectors attach anywhere over it and follow the group.
    const body:BoardElement[]=[...this.elements.filter(e=>e.type==='arrow'),...this.elements.filter(e=>e.type!=='arrow')];
    if(shell==='skip')return {id:this.id,name:category+' · '+name,status:'published',created,elements:body as unknown as LibraryItem['elements']};
    const bounds=elementsBounds(this.elements);
    const shield=this.base('rectangle',Math.floor(bounds.left)-4,Math.floor(bounds.top)-4,Math.ceil(bounds.right)-Math.floor(bounds.left)+8,Math.ceil(bounds.bottom)-Math.floor(bounds.top)+8);
    Object.assign(shield,{backgroundColor:'#ffffff',strokeColor:'transparent',strokeWidth:0,customData:{boardLibrary:{id:this.id,category,version:BOARD_LIBRARY_VERSION},role:'bind-shell'}});
    shield.groupIds=[this.id+'-group'];
    return {id:this.id,name:category+' · '+name,status:'published',created,elements:[shield,...body] as unknown as LibraryItem['elements']};
  }
}

/** Lane frames and whole-diagram templates keep no bind shell: connectors there
 * should target the nodes inside, not the frame around them. */
export const BOARD_LIBRARY_SHELL_EXEMPT=['lane-vertical','lane-horizontal','lane-grid','tpl-review','tpl-arch','tpl-state','tpl-sequence','tpl-dfd','tpl-vmodel'] as const;

export function createBoardLibraryItems():LibraryItems {
  const items:LibraryItem[]=[];
  const add=(category:string,key:string,name:string,draw:(a:Artwork)=>void)=>{const a=new Artwork('pss-builtin-v1-'+key);draw(a);items.push(a.finish(name,category,(BOARD_LIBRARY_SHELL_EXEMPT as readonly string[]).includes(key)?'skip':true));};
  const flow=(key:string,name:string,draw:(a:Artwork)=>void)=>add('流程',key,name,draw);
  const system=(key:string,name:string,draw:(a:Artwork)=>void)=>add('系统与接口',key,name,draw);
  const control=(key:string,name:string,draw:(a:Artwork)=>void)=>add('控制逻辑',key,name,draw);
  const thermal=(key:string,name:string,draw:(a:Artwork)=>void)=>add('热管理',key,name,draw);
  const lane=(key:string,name:string,draw:(a:Artwork)=>void)=>add('泳道与角色',key,name,draw);
  const uml=(key:string,name:string,draw:(a:Artwork)=>void)=>add('UML 结构',key,name,draw);
  const seq=(key:string,name:string,draw:(a:Artwork)=>void)=>add('时序图元',key,name,draw);
  const dfd=(key:string,name:string,draw:(a:Artwork)=>void)=>add('数据流',key,name,draw);
  const note=(key:string,name:string,draw:(a:Artwork)=>void)=>add('便签标注',key,name,draw);
  const template=(key:string,name:string,draw:(a:Artwork)=>void)=>add('整图模板',key,name,draw);

  flow('start','开始',a=>{a.node('开始',0,0,144,64,'ellipse',true);});
  flow('end','结束',a=>{a.node('结束',0,0,144,64,'ellipse');});
  flow('process','处理步骤',a=>{a.node('处理步骤');});
  flow('decision','条件判断',a=>{a.node('条件成立？',0,0,224,120,'diamond');});
  flow('subprocess','子流程',a=>{a.node('子流程');a.line([[12,0],[12,64]]);a.line([[148,0],[148,64]]);});
  flow('input-output','输入输出',a=>{const shape=a.line([[24,0],[184,0],[160,64],[0,64],[24,0]]);shape.backgroundColor=palette.paper;a.text('输入 / 输出',24,20,136);});
  flow('branch','条件分支',a=>{const d=a.node('条件？',0,0,176,112,'diamond'),yes=a.node('执行',256,24,120,64),no=a.node('保持',28,192,120,64);a.arrow(d,yes,[[184,56],[248,56]]);a.arrow(d,no,[[88,120],[88,184]],[.5,1],[.5,0]);a.caption('是',192,20,48);a.caption('否',104,136,48);});
  flow('retry','循环复检',a=>{const check=a.node('检查',0,0,128,64),step=a.node('处理',224,0,128,64);a.arrow(check,step,[[136,32],[216,32]]);a.arrow(step,check,[[288,72],[288,128],[64,128],[64,72]],[.5,1],[.5,1]);a.caption('复检',144,140,64);});
  // Standard flowchart symbols (aligned with common engineering chart toolkits).
  flow('document','文档',a=>{const shape=a.line([[0,16],[160,16],[160,72],[120,82],[80,70],[40,82],[0,72],[0,16]]);shape.backgroundColor=palette.paper;a.text('文档',16,24,128);});
  flow('prepare','准备',a=>{const shape=a.line([[32,0],[168,0],[200,32],[168,64],[32,64],[0,32],[32,0]]);shape.backgroundColor=palette.paper;a.text('准备',36,20,128);});
  flow('manual-input','手动输入',a=>{const shape=a.line([[0,0],[160,0],[128,64],[32,64],[0,0]]);shape.backgroundColor=palette.paper;a.text('输入',28,18,104);});
  flow('display','显示',a=>{const shape=a.line([[24,0],[160,0],[160,64],[24,64],[0,32],[24,0]]);shape.backgroundColor=palette.paper;a.text('显示',36,20,104);});
  flow('merge','合并',a=>{const shape=a.line([[0,0],[160,0],[80,64],[0,0]]);shape.backgroundColor=palette.paper;a.text('合并',48,12,64);});

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

  // Swimlanes and actors: process ownership frames plus a reusable actor glyph.
  lane('lane-vertical','纵向泳道',a=>{a.node('泳道名称',0,0,160,40,'rectangle',true);const body=a.node('',0,40,160,280);body.backgroundColor='transparent';});
  lane('lane-horizontal','横向泳道',a=>{a.node('角色',0,0,48,280,'rectangle',true);const body=a.node('',48,0,272,280);body.backgroundColor='transparent';});
  lane('lane-grid','泳道组（2×2）',a=>{const names=['甲方','乙方','工程','评审'];for(let i=0;i<2;i++)for(let j=0;j<2;j++){const x=j*216,y=i*184;a.node(names[i*2+j]!,x,y,168,36,'rectangle',true);const body=a.node('',x,y+36,168,140);body.backgroundColor='transparent';}});
  lane('actor','参与者',a=>{a.node('',56,0,32,32,'ellipse');a.line([[72,32],[72,88]]);a.line([[40,52],[104,52]]);a.line([[72,88],[48,120]]);a.line([[72,88],[96,120]]);a.text('参与者',0,128,160);});

  // UML structure: three-compartment boxes and the four relation connectors.
  uml('class','类（三段）',a=>{a.node('',0,0,176,120);a.line([[0,40],[176,40]]);a.line([[0,80],[176,80]]);a.text('类名',8,8,160,18);a.text('+ 属性: 类型',8,46,160,16);a.text('+ 操作(参数)',8,86,160,16);});
  uml('interface','接口',a=>{a.node('',0,0,176,88);a.line([[0,40],[176,40]]);a.text('«interface»',8,10,160,16);a.text('+ 操作()',8,48,160,16);});
  uml('composition','组合关系',a=>{a.node('整体',0,24,96,48);a.node('部分',216,24,96,48);a.line([[100,48],[118,37],[136,48],[118,59],[100,48]]).backgroundColor=palette.ink;a.line([[136,48],[216,48]]);});
  uml('aggregation','聚合关系',a=>{a.node('整体',0,24,96,48);a.node('部分',216,24,96,48);a.line([[100,48],[118,37],[136,48],[118,59],[100,48]]).backgroundColor=palette.paper;a.line([[136,48],[216,48]]);});
  uml('inherit','继承关系',a=>{a.node('子类',0,24,96,48);a.node('父类',224,24,96,48);a.line([[100,48],[192,48]]);a.line([[192,37],[216,48],[192,59],[192,37]]).backgroundColor=palette.paper;});
  uml('dependency','依赖关系',a=>{const one=a.node('使用方',0,24,112,48),two=a.node('被依赖',216,24,112,48);const dep=a.arrow(one,two,[[120,48],[208,48]]);dep.strokeStyle='dashed';});

  // Sequence primitives: lifelines, activations and message kinds.
  seq('lifeline','参与者与生命线',a=>{a.node('参与者',0,0,128,44,'rectangle',true);const life=a.line([[64,44],[64,192]]);life.strokeStyle='dashed';});
  seq('message','同步消息',a=>{a.node('A',0,0,96,40,'rectangle',true);a.node('B',224,0,96,40,'rectangle',true);const one=a.line([[48,40],[48,160]]);one.strokeStyle='dashed';const two=a.line([[272,40],[272,160]]);two.strokeStyle='dashed';const act1=a.node('',40,72,16,56);act1.backgroundColor=palette.tint;const act2=a.node('',264,72,16,56);act2.backgroundColor=palette.tint;a.arrow(act1,act2,[[56,100],[264,100]]);a.text('消息()',112,74,96,16);});
  seq('return','返回消息',a=>{a.node('A',0,0,96,40,'rectangle',true);a.node('B',224,0,96,40,'rectangle',true);const one=a.line([[48,40],[48,144]]);one.strokeStyle='dashed';const two=a.line([[272,40],[272,144]]);two.strokeStyle='dashed';const act1=a.node('',40,64,16,48);act1.backgroundColor=palette.tint;const act2=a.node('',264,64,16,48);act2.backgroundColor=palette.tint;const reply=a.arrow(act1,act2,[[56,88],[264,88]]);reply.strokeStyle='dashed';a.text('返回值',112,62,96,16);});
  seq('self','自调用',a=>{a.node('A',0,0,96,40,'rectangle',true);const life=a.line([[48,40],[48,136]]);life.strokeStyle='dashed';const act=a.node('',40,56,16,48);act.backgroundColor=palette.tint;a.arrow(act,act,[[56,72],[104,72],[104,104],[56,104]],[1,.333],[1,1]);a.text('调用()',112,80,96,16);});
  seq('fragment','循环片段',a=>{const frame=a.node('',0,0,240,128);frame.backgroundColor='transparent';frame.strokeStyle='dashed';a.node('',0,0,72,28,'rectangle',true);a.text('loop',8,4,56,16);a.text('条件 [每次]',80,4,152,16);a.node('',24,64,16,40);a.node('',184,64,16,40);});

  // Data-flow primitives (Yourdon/DeMarco style).
  dfd('dfd-process','加工',a=>{a.node('加工\nP1',0,0,128,88,'ellipse',true);});
  dfd('store','数据存储',a=>{a.line([[24,12],[136,12]]);a.line([[24,52],[136,52]]);a.line([[24,4],[24,60]]);a.line([[136,4],[136,60]]);a.text('D1 数据',40,20,112,16);});
  dfd('entity','外部实体',a=>{a.node('外部实体',0,0,144,64);a.line([[6,0],[6,64]]);a.line([[138,0],[138,64]]);});
  dfd('flow-arrow','数据流',a=>{const from=a.node('',0,24,64,32),to=a.node('',224,24,64,32);a.arrow(from,to,[[72,40],[216,40]]);a.caption('数据流名称',88,4,112);});

  // Sticky notes and callouts for lightweight annotation.
  note('note-amber','便签 · 琥珀',a=>{const paper=a.node('记录要点…',0,0,160,120);Object.assign(paper,{backgroundColor:'#f6ecc9',strokeColor:'#c2a35e'});a.line([[128,120],[160,88]]);});
  note('note-blue','便签 · 青灰',a=>{const paper=a.node('待确认…',0,0,160,120);Object.assign(paper,{backgroundColor:'#e3edf0',strokeColor:'#6e8f9a'});a.line([[128,120],[160,88]]);});
  note('note-green','便签 · 灰绿',a=>{const paper=a.node('结论…',0,0,160,120);Object.assign(paper,{backgroundColor:'#e9f0e4',strokeColor:'#84997a'});a.line([[128,120],[160,88]]);});
  note('bubble','对话气泡',a=>{a.node('说明内容',0,0,160,88);a.line([[24,88],[16,112],[44,88]]);});

  // Whole-diagram templates: insert, ungroup and edit as a starting point.
  template('tpl-review','评审流程（泳道）',a=>{
    a.node('编写方',0,0,152,36,'rectangle',true);const body1=a.node('',0,36,152,300);body1.backgroundColor='transparent';
    a.node('评审方',168,0,152,36,'rectangle',true);const body2=a.node('',168,36,152,300);body2.backgroundColor='transparent';
    const draft=a.node('编写草稿',24,64,104,56),submit=a.node('提交评审',24,160,104,56),check=a.node('评审\n通过？',196,140,96,96,'diamond'),publish=a.node('修订发布',24,268,104,56);
    a.arrow(draft,submit,[[76,128],[76,152]],[.5,1],[.5,0]);
    a.arrow(submit,check,[[136,188],[188,188]]);
    a.arrow(check,publish,[[244,244],[76,244],[76,260]],[.5,1],[.5,0]);a.caption('否，修改',128,214,88);
    a.arrow(check,body2,[[244,244],[244,286]],[.5,1],[.5,.833]);a.caption('是，归档',252,214,64);
  });
  template('tpl-arch','系统架构（分层）',a=>{
    const app=a.node('应用层 HMI',0,0,240,48,'rectangle',true),logic=a.node('控制逻辑层',0,96,240,48),driver=a.node('驱动 / IO 层',0,192,240,48);
    a.arrow(app,logic,[[120,56],[120,88]],[.5,1],[.5,0]);a.arrow(logic,driver,[[120,152],[120,184]],[.5,1],[.5,0]);
    const sensor=a.node('传感器',288,192,104,48),actuator=a.node('执行器',288,96,104,48);
    a.arrow(sensor,driver,[[280,216],[248,216]],[0,.5],[1,.5]);a.arrow(logic,actuator,[[248,120],[280,120]],[1,.5],[0,.5]);
    a.caption('信号输入',240,160,72);a.caption('控制输出',240,68,72);
  });
  template('tpl-state','状态机',a=>{
    const start=a.node('开始',0,112,96,48,'ellipse',true),idle=a.node('待机',160,112,112,56),run=a.node('运行',344,112,112,56,'rectangle',true),fault=a.node('故障',344,248,112,56);
    a.arrow(start,idle,[[104,140],[152,140]]);
    a.arrow(idle,run,[[216,104],[216,52],[400,52],[400,104]],[.5,0],[.5,0]);a.caption('启动指令',244,20,96);
    a.arrow(run,idle,[[336,140],[280,140]],[0,.5],[1,.5]);a.caption('停止',288,108,48);
    a.arrow(run,fault,[[400,176],[400,240]],[.5,1],[.5,0]);a.caption('异常',408,196,48);
    a.arrow(fault,idle,[[336,276],[216,276],[216,176]],[0,.5],[.5,1]);a.caption('复位',252,282,48);
  });
  template('tpl-sequence','时序交互',a=>{
    a.node('用户',0,0,96,40,'rectangle',true);a.node('界面',168,0,96,40,'rectangle',true);a.node('服务',336,0,96,40,'rectangle',true);
    for(const x of [48,216,384]){const life=a.line([[x,40],[x,264]]);life.strokeStyle='dashed';}
    const actU=a.node('',40,72,16,160),actI1=a.node('',208,72,16,72),actS=a.node('',376,88,16,32),actI2=a.node('',208,176,16,72);
    for(const act of [actU,actI1,actS,actI2])act.backgroundColor=palette.tint;
    a.arrow(actU,actI1,[[56,88],[208,88]],[1,.1],[0,.222]);a.text('操作请求',96,66,96,16);
    a.arrow(actI1,actS,[[224,104],[376,104]],[1,.444],[0,.5]);a.text('调用',272,82,64,16);
    const back=a.arrow(actS,actI1,[[376,112],[224,112]],[0,.75],[1,.556]);back.strokeStyle='dashed';a.text('返回结果',268,118,96,16);
    const update=a.arrow(actI2,actU,[[208,216],[56,216]],[0,.556],[1,.9]);update.strokeStyle='dashed';a.text('更新显示',96,194,96,16);
  });
  template('tpl-dfd','数据流',a=>{
    const source=a.node('需求方',0,64,112,56),parse=a.node('解析\nP1',168,52,120,80,'ellipse',true),plan=a.node('排期\nP2',168,184,120,80,'ellipse',true),team=a.node('开发组',0,196,112,56);
    const store=a.node('',336,12,120,48);store.backgroundColor='transparent';store.strokeStyle='dashed';
    a.line([[336,20],[456,20]]);a.line([[336,52],[456,52]]);a.text('D1 需求库',344,24,104,16);
    a.arrow(source,parse,[[120,92],[160,92]]);a.caption('原始需求',116,60,88);
    a.arrow(parse,store,[[296,92],[316,92],[316,36],[328,36]],[1,.5],[0,.5]);a.caption('写入',300,4,56);
    a.arrow(store,plan,[[396,68],[396,176],[228,176]],[.5,1],[.5,0]);a.caption('读取需求',404,112,88);
    a.arrow(plan,team,[[160,224],[120,224]],[0,.5],[1,.5]);a.caption('排期结果',116,192,88);
  });
  template('tpl-vmodel','V 模型',a=>{
    const req=a.node('需求分析',0,0,144,48,'rectangle',true),design=a.node('系统设计',56,104,144,48),code=a.node('软件实现',184,208,144,48),integ=a.node('集成测试',312,104,144,48),system=a.node('系统测试',368,0,144,48);
    a.arrow(req,design,[[72,56],[72,76],[128,76],[128,96]],[.5,1],[.5,0]);a.caption('分解',84,52,48);
    a.arrow(design,code,[[128,160],[128,176],[256,176],[256,200]],[.5,1],[.5,0]);a.caption('实现',140,156,48);
    a.arrow(code,integ,[[336,232],[384,232],[384,160]],[1,.5],[.5,1]);a.caption('组装',340,238,48);
    a.arrow(integ,system,[[384,96],[384,76],[440,76],[440,56]],[.5,0],[.5,1]);a.caption('验证',452,82,48);
    const confirm=a.arrow(req,system,[[152,24],[360,24]],[1,.5],[0,.5]);confirm.strokeStyle='dashed';a.caption('确认需求',216,0,80);
    const verify=a.arrow(design,integ,[[208,128],[304,128]],[1,.5],[0,.5]);verify.strokeStyle='dashed';a.caption('验证设计',224,100,80);
  });
  return items;
}
