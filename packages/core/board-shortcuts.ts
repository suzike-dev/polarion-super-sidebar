/** Board shortcut catalogue shared by the help dialog and tests.
 * Only keys verified in this product build are listed — no guessed native bindings. */
export type ShortcutGroup={title:string;items:{keys:string;label:string}[]};
export const BOARD_SHORTCUTS:ShortcutGroup[]=[
  {title:'工具',items:[
    {keys:'1',label:'选择'},
    {keys:'2',label:'矩形'},
    {keys:'3',label:'菱形'},
    {keys:'4',label:'椭圆'},
    {keys:'5',label:'箭头（唯一可吸附的连线）'},
    {keys:'6',label:'线条（不参与吸附）'},
    {keys:'7',label:'自由书写'},
    {keys:'8',label:'文字'},
    {keys:'9',label:'插入图像'},
    {keys:'0',label:'橡皮'},
    {keys:'H',label:'抓手（平移画布）'},
  ]},
  {title:'连接与吸附',items:[
    {keys:'C',label:'快速连接：点起点形状，再点目标形状'},
    {keys:'拖动箭头端点入形状',label:'形状描边高亮后松开即绑定'},
    {keys:'拖动形状',label:'已绑定的连线自动跟随'},
  ]},
  {title:'标注与整理',items:[
    {keys:'N',label:'在视口中心插入便签'},
    {keys:'选中 ≥2 对象',label:'底部工具条：对齐与分布'},
    {keys:'选中便签',label:'切换便签颜色'},
    {keys:'选中连线',label:'实线 / 虚线 / 无箭头'},
  ]},
  {title:'视图',items:[
    {keys:'Shift+G',label:'显示 / 隐藏网格'},
    {keys:'Shift+1',label:'缩放至适应全部内容'},
    {keys:'空格 + 拖拽 / 鼠标中键拖拽',label:'平移画布'},
    {keys:'Ctrl + 滚轮',label:'缩放画布'},
  ]},
  {title:'编辑',items:[
    {keys:'Ctrl+Z / Ctrl+Shift+Z',label:'撤销 / 重做'},
    {keys:'Delete',label:'删除所选对象'},
    {keys:'双击素材 / 图形',label:'进入组内编辑或编辑文字'},
    {keys:'Ctrl+V 粘贴 Mermaid 文本',label:'自动转换为可编辑图形'},
    {keys:'Esc',label:'退出快速连接 / 关闭弹窗'},
  ]},
];
