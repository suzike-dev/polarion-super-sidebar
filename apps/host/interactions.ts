import { z } from 'zod';
import type { Run, NativeInteraction, InteractionValues } from '../../packages/protocol/index.ts';
import { Store } from './store.ts';
import { Ajv } from 'ajv';
import addFormats from 'ajv-formats';
import type {ElicitationRequest} from '@anthropic-ai/claude-agent-sdk';

const questionsSchema=z.object({questions:z.array(z.object({question:z.string().min(1).max(12000),header:z.string().max(200).optional(),multiSelect:z.boolean().optional(),options:z.array(z.object({label:z.string().min(1).max(500),description:z.string().max(5000).optional()})).max(30)})).min(1).max(12)});
export function questionForm(input:unknown):Omit<NativeInteraction,'id'> {
  const {questions}=questionsSchema.parse(input);
  if(new Set(questions.map(q=>q.question)).size!==questions.length)throw Error('DUPLICATE_QUESTION');
  return {kind:'question',title:'Claude Code 需要你的回答',message:'回答会直接传回当前原生会话。',fields:questions.map(q=>({key:q.question,label:q.question,description:q.header,type:q.multiSelect?'array':'string',required:true,allowOther:true,choices:q.options.map(o=>({value:o.label,label:o.label,description:o.description}))}))};
}
type Answer={action:'accept'|'decline'|'cancel';values:InteractionValues};
export function mcpForm(request:ElicitationRequest){
  if(request.mode==='url')throw Error('MCP_URL_DIALOG_NOT_IMPLEMENTED');
  const schema=request.requestedSchema as any;
  if(!schema||schema.type!=='object'||!schema.properties)throw Error('MCP_FORM_SCHEMA_UNSUPPORTED');
  const fields:NativeInteraction['fields']=Object.entries(schema.properties).map(([key,raw])=>{
    const p=raw as any;if(!['string','number','integer','boolean','array'].includes(p.type))throw Error('MCP_FORM_SCHEMA_UNSUPPORTED');
    const item=p.type==='array'?p.items:p;if(p.type==='array'&&item?.type!=='string')throw Error('MCP_FORM_SCHEMA_UNSUPPORTED');
    const choices=item?.enum?.map((v:any,i:number)=>({value:String(v),label:item.enumNames?.[i]??String(v)}))??item?.oneOf?.map((v:any)=>({value:String(v.const),label:v.title??String(v.const)}));
    if(p.type==='array'&&!choices)throw Error('MCP_FORM_SCHEMA_UNSUPPORTED');
    return{key,label:p.title??key,description:p.description,type:p.type,required:schema.required?.includes(key)??false,choices,secret:p.format==='password'||/password|secret|token|api.?key/i.test(key),minimum:p.minimum,maximum:p.maximum,minLength:p.minLength,maxLength:p.maxLength};
  });
  const ajv=new Ajv({allErrors:true,strict:false,validateFormats:true});(addFormats as any)(ajv);const check=ajv.compile(schema);
  return{form:{kind:'mcp-form' as const,title:request.title??`MCP · ${request.serverName}`,message:request.message,fields},validate:(values:InteractionValues)=>{if(!check(values))throw Error('MCP 表单校验失败：'+ajv.errorsText(check.errors,{dataVar:'回答'}));}};
}
export class Interactions {
  store:Store;
  pending=new Map<string,{runId:string;validate:(values:InteractionValues)=>void;resolve:(answer:Answer)=>void}>();
  constructor(store:Store){this.store=store;}
  ask(run:Run,form:Omit<NativeInteraction,'id'>,signal:AbortSignal,validate?:(values:InteractionValues)=>void):Promise<Answer>{
    if(signal.aborted)return Promise.resolve({action:'cancel',values:{}});
    const interaction={...form,id:crypto.randomUUID()};run.status='waiting';this.store.put('run',run.id,run);
    this.store.event(run,'interaction',interaction);
    return new Promise(resolve=>{
      const finish=(answer:Answer)=>{
        if(!this.pending.delete(interaction.id))return;
        signal.removeEventListener('abort',abort);
        if(run.status==='waiting'&&!signal.aborted){run.status='running';this.store.put('run',run.id,run);}
        // Answers may contain private MCP form data. Retain only settlement metadata.
        this.store.event(run,'interaction-result',{id:interaction.id,action:answer.action});resolve(answer);
      };
      const abort=()=>finish({action:'cancel',values:{}});
      this.pending.set(interaction.id,{runId:run.id,resolve:finish,validate:values=>{
        for(const f of form.fields){const value=values[f.key];if(f.required&&(value===undefined||value===''||(Array.isArray(value)&&!value.length)))throw Error('请填写：'+f.label);
          if(value===undefined)continue;
          if(f.type==='array'?!Array.isArray(value):f.type==='number'||f.type==='integer'?typeof value!=='number'||!Number.isFinite(value)||(f.type==='integer'&&!Number.isInteger(value)):typeof value!==f.type)throw Error('回答类型不正确：'+f.label);
          if(f.choices&&!f.allowOther&&(Array.isArray(value)?value:[String(value)]).some(v=>!f.choices!.some(c=>c.value===v)))throw Error('请选择有效选项：'+f.label);
        }validate?.(values);
      }});signal.addEventListener('abort',abort,{once:true});
      if(signal.aborted)abort();
    });
  }
  answer(runId:string,id:string,answer:Answer){const p=this.pending.get(id);if(!p||p.runId!==runId)throw Error('INTERACTION_EXPIRED');if(answer.action==='accept')p.validate(answer.values);p.resolve(answer);}
  cancelRun(runId:string){for(const p of this.pending.values())if(p.runId===runId)p.resolve({action:'cancel',values:{}});}
}
