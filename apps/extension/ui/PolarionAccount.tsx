import React,{useEffect,useRef,useState} from 'react';
import {rpc} from '../lib/client';
import {polarionFeedback} from '../lib/polarion-feedback';
import './polarion-account.css';
export function PolarionAccount({onBusy,onConnected}:{onBusy:(busy:boolean)=>void;onConnected:()=>void}) {
  const [username,setUsername]=useState(''),[password,setPassword]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[configured,setConfigured]=useState(false),[notice,setNotice]=useState(''),[error,setError]=useState('');
  const active=useRef(true),locked=useRef(false);
  useEffect(()=>{active.current=true;void rpc<{configured:boolean;username:string}>({method:'polarion.credentials.status'}).then(value=>{if(active.current){setConfigured(value.configured);setUsername(value.username);}}).catch(()=>{if(active.current)setError('无法读取 Polarion 账号状态，请确认 Host 已更新。');}).finally(()=>{if(active.current)setLoading(false);});return()=>{active.current=false;};},[]);
  async function connect(save:boolean) {
    if(locked.current)return;locked.current=true;setBusy(true);onBusy(true);setError('');setNotice('');
    const secret=password;setPassword('');
    try {
      if(save)await rpc({method:'polarion.credentials.save',username:username.trim(),password:secret});
      else await rpc({method:'polarion.credentials.check'});
      if(active.current){setConfigured(true);setNotice(save?'账号已保存，Polarion 连接成功。现在可以打开编辑工作台。':'Polarion 连接成功。');onConnected();}
    } catch(e) {if(active.current)setError(polarionFeedback((e as Error).message)??'连接未完成，请稍后重试；原有凭据保留。');}
    finally {locked.current=false;if(active.current)setBusy(false);onBusy(false);}
  }
  return <section className="polarion-account" aria-label="Polarion 账号" aria-busy={busy||loading}>
    <div className="account-heading"><strong>Polarion 账号</strong><span>{loading?'读取中…':configured?'已配置':'尚未配置'}</span></div>
    <p className="muted">使用你登录 Polarion 的账号和密码。</p>
    <label>Polarion 用户名<input autoComplete="username" maxLength={200} value={username} disabled={busy||loading} onChange={e=>{setUsername(e.target.value);setNotice('');}}/></label>
    <label>Polarion 密码<input type="password" autoComplete="off" maxLength={2048} value={password} disabled={busy||loading} placeholder={configured?'输入密码以更新账号':'输入登录密码'} onChange={e=>{setPassword(e.target.value);setNotice('');}} onKeyDown={e=>{if(e.key==='Enter'&&username.trim()&&password){e.preventDefault();void connect(true);}}}/></label>
    <p className="muted">密码加密保存在这台电脑的当前 Windows 用户下，不会发送给 AI。</p>
    <div className="account-actions"><button className="primary" disabled={busy||loading||!username.trim()||!password} onClick={()=>void connect(true)}>{busy?'正在连接…':'保存并连接'}</button>{configured&&<button className="secondary" disabled={busy||loading} onClick={()=>void connect(false)}>检查已保存的连接</button>}</div>
    {notice&&<p className="account-success" role="status">{notice}</p>}{error&&<p className="inline-error" role="alert">{error}</p>}
  </section>;
}
