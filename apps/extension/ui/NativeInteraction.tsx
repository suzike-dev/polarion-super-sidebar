import {AssistantMarkdown} from './AssistantMarkdown';
import React,{useState} from 'react';
import {MessageSquare,Check} from 'lucide-react';
import type {NativeInteraction as Interaction,InteractionValues} from '../../../packages/protocol/index';
import {interactionInputValue,setInteractionAnswer} from '../lib/interaction-values';
import './native-interaction.css';
export function NativeInteraction({value,onAnswer,disabled}:{value:Interaction;onAnswer:(action:'accept'|'decline'|'cancel',values:InteractionValues)=>Promise<void>;disabled:boolean}){
  const [answers,setAnswers]=useState<InteractionValues>({}),[other,setOther]=useState<Record<string,string>>({}),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const update=(key:string,value:InteractionValues[string]|undefined)=>setAnswers(a=>setInteractionAnswer(a,key,value));
  async function submit(action:'accept'|'cancel'){
    setBusy(true);setError('');
    try{const values={...answers};for(const f of value.fields)if(other[f.key]?.trim())values[f.key]=f.type==='array'?[...(Array.isArray(values[f.key])?values[f.key] as string[]:[]),other[f.key]!.trim()]:other[f.key]!.trim();await onAnswer(action,values);}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}
  }
  return <section className="native-interaction" aria-label={value.title}><header><MessageSquare size={15}/><strong>{value.title}</strong></header><AssistantMarkdown text={value.message}/><fieldset disabled={disabled||busy}>
    {value.fields.map(f=><div className="native-field" key={f.key}><label>{f.label}{f.required&&<span> *</span>}</label>{f.description&&<small>{f.description}</small>}
      {f.choices?<div className="native-options">{f.choices.map(c=>{const selected=f.type==='array'?(answers[f.key] as string[]??[]).includes(c.value):answers[f.key]===c.value;return <button type="button" key={c.value} aria-pressed={selected} onClick={()=>{if(f.type==='array'){const old=answers[f.key] as string[]??[];update(f.key,selected?old.filter(v=>v!==c.value):[...old,c.value]);}else{update(f.key,c.value);setOther(o=>({...o,[f.key]:''}));}}}><i>{selected&&<Check size={12}/>}</i><span><strong>{c.label}</strong>{c.description&&<small>{c.description}</small>}</span></button>;})}</div>:f.type==='boolean'?<select aria-label={f.label} value={answers[f.key]===undefined?'':String(answers[f.key])} onChange={e=>update(f.key,interactionInputValue(f.type,e.target.value))}><option value="">请选择</option><option value="true">是</option><option value="false">否</option></select>:<input aria-label={f.label} type={f.secret?'password':f.type==='number'||f.type==='integer'?'number':'text'} min={f.minimum} max={f.maximum} minLength={f.minLength} maxLength={f.maxLength} step={f.type==='integer'?1:'any'} value={String(answers[f.key]??'')} onChange={e=>update(f.key,interactionInputValue(f.type,e.target.value))}/>}
      {f.allowOther&&<textarea aria-label={f.label+' · 自定义回答'} placeholder="也可以输入自己的回答…" value={other[f.key]??''} onChange={e=>{setOther(o=>({...o,[f.key]:e.target.value}));if(f.type!=='array')update(f.key,'');}}/>}
    </div>)}
    {error&&<p role="alert" className="inline-error">{error}</p>}<footer><button className="secondary" onClick={()=>void submit('cancel')}>取消</button><button className="primary" onClick={()=>void submit('accept')}>{busy?'正在传回…':'提交回答'}</button></footer></fieldset>{disabled&&<small>该任务已结束，此问题不再等待回答。</small>}</section>;
}
