import {polarionFeedback} from './polarion-feedback.ts';
export function saveError(error:unknown){
 const code=error instanceof Error?error.message:String(error);
 const native:Record<string,string>={NATIVE_REFRESH_UNSUPPORTED:'当前 Polarion 版本尚未验证免刷新同步，本次没有发起保存。',NATIVE_REFRESH_TIMEOUT:'原生正文同步超时；保存结果以服务端回读状态为准。',NATIVE_REFRESH_FAILED:'原生正文同步暂时失败；保存结果以服务端回读状态为准。',NATIVE_REFRESH_CONTENT_MISMATCH:'原生正文回读与已保存的内容不一致，请核对服务端最新修订。',NATIVE_DOCUMENT_CHANGED:'原生文档在操作期间发生变化，已停止自动同步。',NATIVE_ITEM_NOT_LOADED:'当前工作项尚未在原生正文中载入，请先定位该工作项再保存。'};
 if(native[code])return native[code];
 const polarion=polarionFeedback(code);if(polarion)return polarion+' 本地草稿已保留；若保存结果不确定，请先核对服务端。';
 return ({NATIVE_EDITOR_DIRTY:'Polarion 原生页面还有未保存的输入。请先保存原生修改，再重试；助手草稿已保留。',NATIVE_EDITOR_UNKNOWN:'暂时无法确认 Polarion 原生文档状态。请确认原生内容已保存后刷新页面，再打开此草稿保存。',REMOTE_CONFLICT:'服务端内容已被修改，请比较并处理差异后再保存。',STALE_DRAFT:'共享草稿已被另一处更新。当前输入仍保留，请先载入并审阅最新草稿。',SAVE_NOT_APPLIED:'Polarion 没有应用本次修改。服务端内容未变，本地草稿已保留，可重试或导出备份。',READBACK_MISMATCH:'已提交，但服务端回读与草稿不一致。请核对服务端，当前不能视为保存成功。',POLARION_OPERATION_FAILED:'Polarion 写入失败。请核对服务端状态和当前账号的编辑权限，本地草稿已保留。',READBACK_REQUIRED:'上次保存结果尚未确认，请先点击“核对服务端”。',HOST_UNAVAILABLE:'本地服务未连接，修改仍在本地，请恢复连接后重试。'} as Record<string,string>)[code]??code;
}
