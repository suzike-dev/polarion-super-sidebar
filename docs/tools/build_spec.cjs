/* Documentation builder only. Does not contain product implementation. */
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const dep = 'C:/Users/Lenovo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const requireBundled = createRequire(path.join(dep, 'docx/package.json'));
const D = requireBundled('docx');
const sharp = requireBundled('sharp');
const root = path.resolve(__dirname, '..');
const assets = path.join(root, 'assets');
fs.mkdirSync(assets, {recursive:true});
const base = 'Polarion超级侧边栏_功能规格_v0.1';
const md = fs.readFileSync(path.join(root, base + '.md'), 'utf8');
const esc = v => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const box = (x,y,w,h,fill='#FFFFFF',stroke='#DCE3ED',r=12) =>
  '<rect x="'+x+'" y="'+y+'" width="'+w+'" height="'+h+'" rx="'+r+'" fill="'+fill+'" stroke="'+stroke+'"/>';
const text = (x,y,s,size=22,color='#20324D',weight=400) =>
  '<text x="'+x+'" y="'+y+'" font-size="'+size+'" fill="'+color+'" font-weight="'+weight+'">'+esc(s)+'</text>';
const line = (x1,y1,x2,y2,color='#C7D3E2') =>
  '<path d="M'+x1+' '+y1+' L'+x2+' '+y2+'" stroke="'+color+'" fill="none" stroke-width="2"/>';
const arrow = (x1,y1,x2,y2,color='#4675B5') =>
  '<path d="M'+x1+' '+y1+' L'+x2+' '+y2+'" stroke="'+color+'" fill="none" stroke-width="3" marker-end="url(#arrow)"/>';
const start = (w,h,title,sub) => '<svg xmlns="http://www.w3.org/2000/svg" width="'+w+'" height="'+h+'" viewBox="0 0 '+w+' '+h+'"><defs><marker id="arrow" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0 0 L10 4 L0 8" fill="#4675B5"/></marker></defs><g font-family="Microsoft YaHei, Arial, sans-serif"><rect width="'+w+'" height="'+h+'" fill="#F4F7FB"/>'+text(36,52,title,32,'#16355A',700)+text(36,86,sub,18,'#60718A');
const end = '</g></svg>';
function workspace() {
  let s=start(1400,960,'统一工作区 · 交互布局建议','示意设计，非已实现界面；内容为示意数据。窄屏采用专注布局，给编辑器和 AI 保留空间。');
  s+=box(26,118,1348,780,'#FFFFFF')+box(26,118,1348,50,'#E9EFF7','#E9EFF7',10);
  s+=text(48,151,'Polarion  /  项目  /  软件需求文档',19)+text(1150,151,'专注布局  ·  退出',17);
  s+=box(46,188,890,110,'#F7F9FC')+text(66,219,'原始文档保持定位与滚动位置',20,'#62748E',600);
  s+=text(66,253,'4.2 接口定义     悬停先预览 → 点击“编辑”打开工作台',19);
  s+=box(62,320,856,550,'#FFFFFF','#7D9ECB')+box(62,320,856,54,'#EDF3FC','#EDF3FC',10);
  s+=text(82,355,'SPE-示例  ·  接口信息',23,'#183B68',700)+text(674,355,'草稿  ·  最大化  ×',19);
  s+=text(82,409,'正文     属性     附件     关联     评论',20,'#2A5186',600)+line(80,430,900,430);
  s+=text(82,466,'B    I    U     段落 ▾     表格 ▾     插入 ▾     撤销',19);
  s+=text(82,510,'当前选择：接口表中的单位与枚举列',21,'#193B65',600);
  s+=box(82,532,810,176,'#FFFFFF','#CAD6E5',4)+box(82,532,810,40,'#EEF3FA','#EEF3FA',4);
  s+=text(96,560,'信号',18,'#3E577A',600)+text(420,560,'单位',18,'#3E577A',600)+text(610,560,'枚举 / 说明',18,'#3E577A',600);
  s+=line(390,532,390,708)+line(575,532,575,708)+line(82,614,892,614)+line(82,660,892,660);
  s+=box(395,576,491,126,'#E7F0FF','#B0C9EE',3);
  s+=text(96,602,'温度信号（示例）',18)+text(420,602,'°C',18)+text(610,602,'保留原有定义',18);
  s+=text(96,646,'模式信号（示例）',18)+text(420,646,'—',18)+text(610,646,'新增说明待审阅',18,'#27764B');
  s+=text(96,692,'状态信号（示例）',18)+text(420,692,'—',18)+text(610,692,'引用固定的枚举定义',18);
  s+=text(82,750,'修订：2 处文字变化，1 处表格修改',19,'#42648A');
  s+=text(82,787,'当前工作项固定；移动鼠标不会切换编辑目标',18,'#60718A');
  s+=line(80,809,900,809)+text(82,844,'草稿已保存到本机',18,'#60718A');
  s+=box(654,824,104,32,'#F0F4FA','#D6E1EE',6)+text(669,847,'查看差异',17);
  s+=box(772,824,122,32,'#245FA9','#245FA9',6)+text(792,847,'保存到项目',17,'#FFFFFF',600);
  s+=box(956,188,398,682,'#FFFFFF','#B7C8DD')+text(978,222,'大纲     AI     属性     更多',21,'#2A5186',600);
  s+=line(970,240,1340,240)+text(978,272,'已固定大纲',18,'#60718A')+text(978,307,'4 软件功能需求',19)+text(998,342,'4.2 接口定义  ← 当前',19,'#245FA9',600);
  s+=line(970,363,1340,363)+text(978,397,'会话：接口表整理',21,'#183B68',700)+text(978,430,'Claude Code  ·  引擎由全局设置确定',16,'#60718A');
  s+=box(976,451,358,86,'#F2F6FC')+text(992,481,'检查选中区域与枚举定义的一致性。',18)+text(992,513,'只修改不一致的地方。',18);
  s+=text(978,573,'已检查来源与 3 个信号。',18)+text(978,607,'修改已进入左侧草稿，可继续调整。',18);
  s+=text(978,645,'查看执行步骤  ▾',17,'#60718A');
  s+=box(976,673,358,48,'#EDF4FF','#B7CDEF',8)+text(989,704,'当前选区：接口表 · 自动跟随',17,'#245FA9');
  s+=box(976,731,358,42,'#F7F9FC','#D6DFEA',8)+text(989,759,'已固定：枚举定义 · 来源版本可查',16);
  s+=box(976,785,358,65,'#FFFFFF','#90ACCF',8)+text(989,814,'继续说明要如何修改…',17,'#6B7D96')+text(1219,840,'@  /  发送',16,'#245FA9');
  s+=text(36,936,'层级：原生必需对话框 ＞ 活动编辑浮窗 ＞ 预览卡；AI 与大纲共用右侧区域，收起不终止任务。',18,'#536C8C');
  return s+end;
}
function flow() {
  let s=start(1400,640,'从草稿到已保存','保存只写 Polarion。草稿撤销与已保存内容的逆向修改是两种操作。');
  const labels=[['编辑草稿','人工与 AI 共用'],['差异审阅','内容 / 表格 / 结构'],['保存预检','对象 / 版本 / 必填'],['执行写入','按依赖顺序执行'],['独立回读','核对实际对象'],['已保存','更新基准与原页面']];
  labels.forEach((l,i)=>{const x=32+i*228;s+=box(x,170,196,116,i===5?'#EAF5EE':'#FFFFFF');s+=text(x+16,210,l[0],24,'#183B68',700)+text(x+16,249,l[1],17,'#60718A');if(i<5)s+=arrow(x+198,228,x+224,228);});
  s+=arrow(587,290,587,366)+box(430,374,316,110,'#FFF6E8','#E7C69B')+text(450,411,'冲突 / 原生未保存修改',22,'#835524',600)+text(450,447,'保留草稿，处理后重新预检',18,'#835524');
  s+=arrow(930,290,930,366)+box(788,374,500,110,'#FFF1EF','#E4B5AE')+text(810,411,'部分完成 / 失败 / 结果未知',22,'#924C44',600)+text(810,447,'逐项对账；非幂等操作不盲目重试',18,'#924C44');
  s+=text(36,558,'只有回读确认成功，才能显示“已保存”。页面刷新状态与服务器保存结果分别记录。',22,'#365A84',600);
  s+=text(36,602,'设计说明：多工作项保存采用逐项日志和恢复流程，不假定服务端存在跨对象原子事务。',18,'#60718A');
  return s+end;
}
function architecture() {
  let s=start(1400,850,'浏览器扩展 + 本地 Agent Host','明确区分页面上下文、模型执行、草稿与正式保存。外部表格仅提供读取数据。');
  s+=box(30,140,340,280,'#FFFFFF','#C4D2E4')+text(52,183,'浏览器扩展',27,'#183B68',700);
  s+=text(52,222,'Chrome / Edge / ego',22)+text(52,269,'统一侧栏与单工作项浮窗',20)+text(52,308,'原生 iframe / 选区 / 右键',20)+text(52,347,'差异审阅与保存操作',20)+text(52,387,'页面与本地状态同步',20);
  s+=box(470,140,440,370,'#EEF4FD','#97B5DD')+text(492,183,'独立本地 Host',27,'#183B68',700);
  s+=text(492,224,'会话与任务生命周期',22)+text(492,264,'上下文快照 / 草稿 / 修订记录',21)+text(492,304,'Polarion 与外部来源适配器',21)+text(492,344,'保存计划 → 预检 → 写入 → 回读',20);
  s+=box(492,369,396,112,'#FFFFFF','#CCD9EB')+text(511,407,'SQLite + 资源缓存',23,'#2E578B',600)+text(511,444,'运行事件、版本、结果与恢复记录',18);
  s+=arrow(372,243,464,243)+text(375,211,'上下文',17,'#4675B5')+arrow(464,315,372,315)+text(375,347,'事件 / 草稿',16,'#4675B5');
  s+=box(1030,140,340,280,'#FFFFFF','#C4D2E4')+text(1052,183,'Polarion',27,'#183B68',700);
  s+=text(1052,228,'正式文档与工作项',22)+text(1052,270,'字段 / 附件 / 追溯',21)+text(1052,312,'历史与项目工作流',21)+text(1052,363,'21 R2 能力逐项验证',18,'#60718A');
  s+=arrow(914,244,1024,244)+text(918,211,'审阅后保存',16,'#4675B5')+arrow(1024,315,914,315)+text(918,347,'读取 / 回读',16,'#4675B5');
  s+=box(30,567,490,198,'#FFFFFF','#C4D2E4')+text(52,610,'外部资料 · 只读',26,'#183B68',700)+text(52,653,'本地 Excel / CSV',21)+text(52,693,'飞书电子表格 / Microsoft 365 Excel',21)+text(52,735,'稳定身份、范围、版本和共同基准',18,'#60718A');
  s+=arrow(344,563,493,510)+text(225,533,'读取 → 比对 → 合并草稿',17,'#4675B5');
  s+=box(620,567,750,198,'#FFFFFF','#C4D2E4')+text(642,610,'本机 Agent 运行时',26,'#183B68',700)+text(642,653,'Codex app-server   /   Claude Code Agent SDK 或 CLI',21);
  s+=text(642,693,'持续会话、工具、Skills、MCP、流式事件、取消与恢复',20)+text(642,735,'全局默认引擎决定新会话；旧会话保留原引擎',18,'#60718A');
  s+=arrow(776,563,776,517)+arrow(848,517,848,563)+text(889,544,'任务 / 草稿操作 / 事件',17,'#4675B5');
  s+=text(36,818,'技术建议图；本轮没有运行目标扩展、业务写入或云端连接器验收。',18,'#60718A');
  return s+end;
}

const cases = [
['AT-01','FR-01 FR-18 FR-23','三浏览器与两引擎核心闭环','隔离文档；Chrome/Edge/ego；两个本地引擎','逐组合安装连接；选区提问；生成草稿；保存回读；关闭恢复','6 种组合均有独立证据；原项更新与草稿一致；没有静默换浏览器','录屏、版本表、保存回读记录'],
['AT-02','FR-02','统一侧栏与布局恢复','原生大纲、属性、附件均可打开','切换 AI/大纲/属性；固定大纲；调整宽度；退出扩展','保持原生入口和对象；无重复常驻侧栏；恢复原布局','前后截图、布局尺寸'],
['AT-03','FR-02 FR-04 NFR-03','窄屏与缩放','1366×768 和 1920×1080','在 100/125/150/200% 缩放操作侧栏、编辑器和原生对话框','保存与输入可达；大纲不覆盖 AI；无焦点陷阱','各视口截图、键盘操作记录'],
['AT-04','FR-03','悬停和拖选抑制','已加载项及懒加载占位项','快速经过、停留、拖选、滚动；移入卡片；点击编辑','快速经过与拖选不误弹；卡片不抢焦点；点击才进入编辑','事件时间线、录屏'],
['AT-05','FR-04 FR-16','浮窗关闭与恢复','同文档两工作项','编辑 A；关闭；打开 B；恢复 A；测试保存失败','保留草稿；编辑目标不随鼠标改变；失败不丢失内容','草稿版本、录屏'],
['AT-06','FR-05','原页面及浮窗自动选区','LiveDoc iframe、独立工作项、浮窗','选择文字和表格区域；选择助手输入文字','业务选区自动成卡片；输入区选择不污染上下文；未自动发模型请求','上下文快照、请求日志'],
['AT-07','FR-05 FR-06','右键保持选区','选中表格局部或段落','打开右键菜单；改写；观察目标位置','菜单失焦后选区仍准确；补丁只指向所选范围','锚点记录、差异截图'],
['AT-08','FR-06','固定引用与发送快照','跨工作项、跨文档引用','固定 A；选择 B；发送；任务中选择 C；更新 A 来源','本任务仍为发送时 A+B；C 用于下一条；来源更新有标记','消息快照、运行日志'],
['AT-09','FR-06','锚点漂移和重复文本','重复段落、重排行、同名信号','生成补丁后移动内容；改变行键；删除目标','重新定位或冲突；不按首个字符串或旧行号覆盖','定位决策与前后数据'],
['AT-10','FR-07','人工与 AI 交错修改','已创建草稿','AI 生成期间手改同一字段及其他段落；撤销 AI 修改组','版本检查生效；同字段不覆盖人工；不同段落可审阅合并；撤销组正确','草稿操作日志、差异'],
['AT-11','FR-08','空操作富文本往返','宏、嵌套表格、列表、上下标、公式、引用和图片样本','读取并序列化；不编辑；对比；修改相邻文字后再对比','内容语义和未改原始片段保留；不能悄悄清洗工程对象','语义对比报告、服务端回读'],
['AT-12','FR-08','中文输入与粘贴','中文 IME；Word/Excel 剪贴板样本','组合输入、撤销重做；粘贴格式/纯文本；选区替换','组合输入不重复；表格不退化为文本；未认可脚本不执行','录屏、剪贴板样本、差异'],
['AT-13','FR-09 NFR-01','大表格与结构操作','1000×20 表格及含合并单元格样本','插删行列、重排、区域粘贴、对比取消、筛选预览','数据身份正确；筛选不写回排序；主线程可操作；提供耗时','表格前后快照、性能记录'],
['AT-14','FR-10 FR-15','附件归属与部分上传','工作项附件、模块附件、revision 图片及新本地图片','插入图片；上传后制造正文失败；重试','引用所有者和版本正确；复用已确认上传；无盲删或重复上传','附件清单、散列、回读'],
['AT-15','FR-10','评论草稿与正式发布','有真实评论串的隔离项','AI 生成评论；不发布时观察；手动发布并断线重试','聊天不自动成评论；发布后回读；未知结果不重复发布','评论 ID、服务端列表'],
['AT-16','FR-11','全文完整性与段间正文','含懒加载、章节、段间文字、附件的文档','读取章节与全文；模拟某段读取失败','清单和顺序完整；占位不当正文；失败不宣称全文已读','结构清单与原生/接口对照'],
['AT-17','FR-12','章节编排','隔离 LiveDoc 含多级章节与段间正文','新增、改名、移动、调整层级、移除章节并保存','原生大纲、正文顺序和段间位置与预览一致','保存前后结构、回读、录屏'],
['AT-18','FR-12 FR-13','工作项拆分合并及引用项','含入向关系与跨文档引用的样本','拆分一项；合并两项；预览并保存；尝试处理引用项','ID 映射明确；来源与关系保留；移出不等于删除；引用所有者正确','真实 ID 映射、关系前后快照'],
['AT-19','FR-13','追溯语义与证据状态','跨项目、指定 revision、不同 link role','读取、添加和移除关系；打开带筛选覆盖报表','方向/角色/项目/revision 正确；未知目标不当不存在；覆盖不当验证结论','关系数据、筛选上下文'],
['AT-20','FR-14','批量范围与字段类型','多工作项、混合类型与必填字段','按章节生成批次；排除一项；输入非法枚举；执行有效项','清单固定；被排除项不写；错误明确；逐项结果准确','SavePlan、字段定义、结果表'],
['AT-21','FR-15','成功保存与页面恢复','含正文/表格/属性变更的草稿','保存；服务端回读；恢复页面滚动及大纲','回读后才显示已保存；内容一致；刷新状态不混同保存状态','请求与回读摘要、截图'],
['AT-22','FR-15','并发与原生未保存内容','另一个标签及另一用户变更；原生 dirty 页面','创建助手草稿后修改服务端；原生保留未保存文本；尝试保存','检测冲突或明确阻止未解决写回；不刷新丢掉原生修改','版本比较、冲突 UI、最终数据'],
['AT-23','FR-14 FR-15','部分成功与未知结果','多项保存批次','在第 N 项响应前断网；重连并恢复','区分已保存/失败/未知；先对账；不自动整批回滚或重复创建','操作日志、服务端对象清单'],
['AT-24','FR-16','草稿撤销与已保存恢复','包含后续他人修改的已保存项','撤销本地组；对已保存内容请求恢复旧版','本地撤销不触服务器；远端恢复形成新的差异草稿，不覆盖他人变化','版本链、恢复草稿'],
['AT-25','FR-16 NFR-02','崩溃恢复','未保存草稿与未确认远端操作','重载扩展；重启 Host；恢复会话','草稿可恢复；未知操作对账；历史来源版本可见','恢复日志、草稿散列'],
['AT-26','FR-17','项目多会话','两个项目、多份文档','新建命名会话；跨文档引用；切项目；归档和恢复','项目隔离、任务上下文稳定、历史可恢复；不强制每文档建会话','会话索引、上下文清单'],
['AT-27','FR-18','全局默认引擎','两个引擎均连接','建 Codex 会话；切全局默认 Claude；建新会话；恢复旧会话','新会话用 Claude；旧会话仍为 Codex；运行中任务不中断','引擎 ID、原生会话 ID、事件'],
['AT-28','FR-18 NFR-02','原生 Agent 能力与长任务','每引擎可用 Skills/MCP 和 10 分钟任务','工具调用、多轮、补充信息、侧栏收起、断线续订、取消和恢复','能力清单逐项通过；无固定超时误杀；取消与隐藏区分','工具事件、配置来源、时间线'],
['AT-29','FR-19','需求质量与来源','有缺失条件、相互冲突的枚举、图片/附件','执行 I/O 检查和需求补全；引入无法解析附件','事实/推断/建议有区别；缺失工程值不捏造；解析范围可见','问题清单、来源定位、修改草稿'],
['AT-30','FR-20','本地 Excel/CSV 只读读取','含公式缓存、隐藏行列、不同编码的样本','选文件/工作表/范围；解析；模拟文件替换','范围和类型正确；缓存计算值有说明；原文件内容不变','前后散列、解析报告'],
['AT-31','FR-20','飞书在线电子表格','指定可读表格及 wiki 链接','在线读取范围；模拟权限过期、部分读取和限流','真实在线连接；对象类型正确；失败显示原因；源表无写入','范围记录、调用方法、版本'],
['AT-32','FR-20','Microsoft 365 在线工作簿','指定可读的 driveItem','在线读取；检查版本变化；模拟无权共享项','无需用户导出；身份与版本正确；只读操作；权限失败不当空表','Graph 调用类型、eTag、快照'],
['AT-33','FR-21','映射与三方合并','有共同基准、重复行键和双端变化的表格','映射列；移动行；制造独立/相同/冲突变化；合并','独立变化进草稿；冲突待选；模糊行键不猜测；缺基准转人工','三份快照、合并分类'],
['AT-34','FR-20 FR-21','只保存 Polarion 的后续比对','选择保留一处 Polarion 差异','保存；不改外部源；再次比对；再改变外部对应值','源表不改；不称两端同步；已解决的旧差异不反复出现；新变化重新检查','保存后双端快照、解决记录'],
['AT-35','FR-22','手动流程动作','有可用动作和必填条件的工作项','保存正文；观察状态；手动执行可用动作','保存不流转；动作沿用服务端条件；执行后回读状态','状态前后值、动作和回读'],
['AT-36','FR-22','动作失效与特殊原生流程','动作被他人改变、无权限或需要签名','执行旧动作；缺必填；进入原生签名流程','明确失败和刷新动作；不直接改 status；特殊动作完成范围如实标记','错误、动作清单、原生回读'],
['AT-37','FR-23 FR-24','安装升级和配置边界','有持久会话及草稿；三浏览器安装','更新 Host/扩展；检查稳定 ID；修改项目设置；卸载保留数据','协议可诊断；草稿不丢；全局配置不被改；卸载选择明确','安装日志、配置前后散列'],
['AT-38','FR-24 NFR-03','键盘、主题与可达性','高缩放、减少动态效果、浅深主题','键盘完成选区引用/编辑/保存/关闭；查看错误提示','全部关键按钮可达；焦点可恢复；错误不只靠颜色','录屏、对比度检查'],
['AT-39','NFR-01 NFR-02','性能与持续使用','500 工作项、1000×20 表格；记录硬件环境','热态交互各 50 次；冷态单独；连续 30 分钟使用','记录 P95；本地目标达标；网络/模型时间单列；无持续资源泄漏','性能日志与环境表'],
['AT-40','NFR-04 FR-18 FR-20','任务与写入边界','伪造页面消息、失效保存计划、含指令的资料','尝试跨项目补丁、旧计划提交、Agent 直接写源表或 Polarion','越界被拒绝；资料不成为系统指令；只读源表无写入；日志无凭据','拒绝事件、适配器调用记录、脱敏报告']
];
function writeCases() {
  const head=['用例ID','需求ID','标题','前置条件与样本','操作步骤','通过条件','证据要求','执行状态'];
  const quote=v=>'"'+String(v).replace(/"/g,'""')+'"';
  const data=[head,...cases.map(c=>[...c,'未执行'])];
  fs.writeFileSync(path.join(root,'验收用例_v0.1.csv'),'\uFEFF'+data.map(r=>r.map(quote).join(',')).join('\r\n')+'\r\n','utf8');
  fs.writeFileSync(path.join(root,'验收用例_v0.1.json'),JSON.stringify(cases.map(c=>({id:c[0],requirements:c[1].split(' '),title:c[2],preconditions:c[3],steps:c[4],expected:c[5],evidence:c[6],status:'未执行'})),null,2)+'\n','utf8');
}

const W=9806;
function runs(s,opts={}) {
  const parts=[];
  const re=/(\*\*[^*]+\*\*|\[[^\]]+\]\((?:<[^>]+>|[^)]+)\))/g;
  let pos=0,m;
  while((m=re.exec(s))) {
    if(m.index>pos)parts.push(new D.TextRun({text:s.slice(pos,m.index),...opts}));
    if(m[0].startsWith('**')) parts.push(new D.TextRun({text:m[0].slice(2,-2),bold:true,...opts}));
    else {
      const a=/^\[([^\]]+)\]\((.*)\)$/.exec(m[0]);
      let url=a[2].replace(/^<|>$/g,'');
      if(!/^https?:/i.test(url)) url=/^[A-Za-z]:/.test(url)?url:path.resolve(root,url).replace(/\\/g,'/');
      parts.push(new D.ExternalHyperlink({link:url,children:[new D.TextRun({text:a[1],color:'245FA9',underline:{},...opts})]}));
    }
    pos=m.index+m[0].length;
  }
  if(pos<s.length)parts.push(new D.TextRun({text:s.slice(pos),...opts}));
  return parts;
}
function para(s,extra={}) {return new D.Paragraph({children:runs(s),spacing:{after:120,line:320},...extra});}
function table(rows) {
  const n=rows[0].length;
  const ratios=rows[0][0]==='决策'?[.10,.72,.18]:n===4?[.10,.23,.34,.33]:n===3?[.22,.37,.41]:[.42,.58];
  const widths=ratios.slice(0,n).map(v=>Math.floor(v*W));widths[widths.length-1]+=W-widths.reduce((a,b)=>a+b,0);
  const border={style:D.BorderStyle.SINGLE,size:3,color:'D5DFEB'};
  return new D.Table({
    width:{size:W,type:D.WidthType.DXA},columnWidths:widths,layout:D.TableLayoutType.FIXED,
    rows:rows.map((row,i)=>new D.TableRow({tableHeader:i===0,cantSplit:true,children:row.map((v,j)=>new D.TableCell({
      width:{size:widths[j],type:D.WidthType.DXA},margins:{top:90,bottom:90,left:100,right:100},
      shading:{fill:i===0?'E8EFF8':i%2?'FFFFFF':'F6F8FB',type:D.ShadingType.CLEAR},
      borders:{top:border,bottom:border,left:border,right:border},verticalAlign:D.VerticalAlign.CENTER,
      children:[new D.Paragraph({children:runs(v,{size:19,bold:i===0,color:i===0?'214A7A':'24364E'}),spacing:{after:40,line:270}})]
    }))}))
  });
}
async function makeDocx() {
  const content=[];
  let lines=md.split(/\r?\n/),i=0,skipFront=true;
  while(i<lines.length) {
    let l=lines[i].trim();
    if(skipFront) { if(l==='### 阅读顺序'){skipFront=false;} else {i++;continue;} }
    if(!l){i++;continue;}
    const h=/^(#{2,3})\s+(.+)$/.exec(l);
    if(h) {
      const level=h[1].length===2?D.HeadingLevel.HEADING_1:D.HeadingLevel.HEADING_2;
      const newPage = h[1].length === 2 && /^(3\.|7\.)/.test(h[2]);
      content.push(new D.Paragraph({heading:level,children:runs(h[2]),pageBreakBefore:newPage,keepNext:true,spacing:{before:240,after:160}}));
      i++;continue;
    }
    if(l.startsWith('|')) {
      let rows=[];
      while(i<lines.length&&lines[i].trim().startsWith('|')) {
        const row=lines[i].trim().slice(1,-1).split('|').map(x=>x.trim());
        if(!row.every(x=>/^:?-+:?$/.test(x)))rows.push(row);
        i++;
      }
      content.push(table(rows),para('',{spacing:{after:100}}));continue;
    }
    const im=/^!\[([^\]]*)\]\(([^)]+)\)$/.exec(l);
    if(im) {
      const imgPath=path.resolve(root,im[2]);
      const meta=await sharp(imgPath).metadata();
      const width=650,height=Math.round(width*meta.height/meta.width);
      content.push(new D.Paragraph({alignment:D.AlignmentType.CENTER,keepNext:true,spacing:{before:120,after:60},children:[new D.ImageRun({
        type:'png',data:fs.readFileSync(imgPath),transformation:{width,height},
        altText:{title:im[1],name:im[1],description:im[1]}
      })]}));
      content.push(para(im[1],{alignment:D.AlignmentType.CENTER,spacing:{after:180},children:runs(im[1],{size:18,color:'63748D'})}));
      i++;continue;
    }
    if(l.startsWith('- ')) {content.push(para(l.slice(2),{numbering:{reference:'bullets',level:0}}));i++;continue;}
    content.push(para(l));i++;
  }
  const sectionProps={page:{size:{width:11906,height:16838},margin:{top:1080,bottom:1080,left:1050,right:1050,header:420,footer:420}}};
  const footer=new D.Footer({children:[new D.Paragraph({alignment:D.AlignmentType.RIGHT,children:[new D.TextRun({text:'待审阅  ·  v0.1    |    ',size:18,color:'73839A'}),new D.TextRun({children:[D.PageNumber.CURRENT],size:18,color:'73839A'})]})]});
  const header=new D.Header({children:[new D.Paragraph({border:{bottom:{style:D.BorderStyle.SINGLE,size:4,color:'C9D8EB',space:5}},children:[new D.TextRun({text:'POLARION  /  超级侧边栏助手  /  功能规格',size:18,color:'5C7596'})]})]});
  const cover=[
    para('产品规格  /  2026.11.02',{spacing:{before:900,after:260},children:runs('产品规格  /  2026.11.02',{size:24,color:'52749A'})}),
    para('Polarion',{spacing:{after:100},children:runs('Polarion',{size:72,bold:true,color:'16355A'})}),
    para('超级侧边栏助手',{spacing:{after:280},children:runs('超级侧边栏助手',{size:48,bold:true,color:'16355A'})}),
    para('功能规格 v0.1 · 待审阅',{spacing:{after:380},children:runs('功能规格 v0.1 · 待审阅',{size:28,color:'446B9D'})}),
    para('以真实需求为上下文，让本地 Agent 参与编辑、审阅与保存。',{spacing:{after:440},children:runs('以真实需求为上下文，让本地 Agent 参与编辑、审阅与保存。',{size:26,color:'3A5678'})}),
    table([['范围','首版约定'],['形态','Windows 浏览器扩展＋轻量本地服务'],['浏览器','Chrome / Microsoft Edge / ego'],['引擎','本地 Codex / Claude Code；全局默认引擎'],['定位','个人需求工作台；内容和结构草稿审阅后保存'],['外部表格','本地 Excel/CSV、飞书、Microsoft 365；只读'],['状态','17 题范围澄清完成；功能规格待审阅，尚未开发']]),
    para('本文中的布局图是设计建议，真实页面截图为调研证据。性能数字是验收目标，产品验收用例尚未执行。',{spacing:{before:360},children:runs('本文中的布局图是设计建议，真实页面截图为调研证据。性能数字是验收目标，产品验收用例尚未执行。',{size:20,color:'62758F'})})
  ];
  const toc=[
    new D.Paragraph({children:[new D.TextRun({text:'目录',size:36,bold:true,color:'16355A'})],spacing:{after:220}}),
    new D.TableOfContents('目录',{hyperlink:true,headingStyleRange:'1-2'}),
    para('详细验收用例见同目录 CSV；正文以 FR / NFR / G 编号连接功能、质量要求和验证项。',{spacing:{before:240}})
  ];
  const doc=new D.Document({
    creator:'Codex',title:'Polarion 超级侧边栏助手 — 功能规格 v0.1',description:'依据真实页面调查与 17 项用户决定编制；待审阅。',
    styles:{default:{document:{run:{font:{ascii:'Arial',hAnsi:'Arial',eastAsia:'Microsoft YaHei'},size:22,color:'24364E'},paragraph:{spacing:{after:120,line:320}}}},paragraphStyles:[
      {id:'Heading1',name:'Heading 1',basedOn:'Normal',next:'Normal',quickFormat:true,run:{size:32,bold:true,color:'16355A'},paragraph:{outlineLevel:0,keepNext:true}},
      {id:'Heading2',name:'Heading 2',basedOn:'Normal',next:'Normal',quickFormat:true,run:{size:25,bold:true,color:'284E7D'},paragraph:{outlineLevel:1,keepNext:true}}
    ]},
    numbering:{config:[{reference:'bullets',levels:[{level:0,format:D.LevelFormat.BULLET,text:'•',alignment:D.AlignmentType.LEFT,style:{paragraph:{indent:{left:360,hanging:180}}}}]}]},
    sections:[
      {properties:sectionProps,children:cover,footers:{default:footer}},
      {properties:{...sectionProps,type:D.SectionType.NEXT_PAGE},headers:{default:header},footers:{default:footer},children:toc},
      {properties:{...sectionProps,type:D.SectionType.NEXT_PAGE},headers:{default:header},footers:{default:footer},children:content}
    ]
  });
  fs.writeFileSync(path.join(root,base+'.docx'),await D.Packer.toBuffer(doc));
}
async function main(){
  for(const [name,svg] of [['workspace-layout',workspace()],['save-flow',flow()],['architecture',architecture()]]){
    fs.writeFileSync(path.join(assets,name+'.svg'),svg,'utf8');
    await sharp(Buffer.from(svg)).png().toFile(path.join(assets,name+'.png'));
  }
  writeCases();
  await makeDocx();
  console.log(JSON.stringify({document:path.join(root,base+'.docx'),cases:cases.length,figures:3}));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
