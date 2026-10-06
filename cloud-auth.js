'use strict';
let cloudClient=null,cloudUser=null,cloudRevision=null,cloudLoading=false,cloudBusy=false,cloudEpoch=0;
const authDialog=document.getElementById('auth-dialog');
const authMessage=document.getElementById('auth-message');
function showAuthMessage(message){authMessage.textContent=message;}
function cloudValid(v){return v&&Array.isArray(v.entries)&&Array.isArray(v.memories)&&v.entries.every(e=>e&&typeof e.id==='string'&&typeof e.date==='string'&&typeof e.text==='string')&&v.memories.every(m=>m&&typeof m.id==='string'&&typeof m.text==='string'&&v.entries.some(e=>e.id===m.entryId));}
function cloudControls(enabled){document.querySelectorAll('#entry-form button,#collect,#remove-memory,.delete,.danger').forEach(b=>b.disabled=!enabled);}
function clearCloudView(){state={entries:[],memories:[]};ready=false;cloudRevision=null;cloudUser=null;page=0;journalPage=0;picking=null;viewing=null;for(const name of ['story','source','snippet','search'])$(name).value='';for(const d of document.querySelectorAll('dialog[open]'))d.close();render();cloudControls(false);$('active-profile').textContent='未登录';}
async function loadCloudSession(){
 if(cloudLoading)return;cloudLoading=true;const epoch=++cloudEpoch;clearCloudView();
 try{const {data,error}=await cloudClient.auth.getUser();if(error||!data.user){if(!authDialog.open)authDialog.showModal();showAuthMessage(error?'请重新登录。':'登录后查看你的回忆树。');return;}
 const user=data.user;const result=await cloudClient.from('memory_trees').select('data,revision').eq('user_id',user.id).maybeSingle();
 if(epoch!==cloudEpoch)return;if(result.error)throw result.error;
 if(result.data&&!cloudValid(result.data.data))throw Error('记录格式异常，请先保留云端数据。');
 cloudUser=user;state=result.data?result.data.data:{entries:[],memories:[]};cloudRevision=result.data?result.data.revision:null;ready=true;render();cloudControls(true);$('active-profile').textContent='已登录：'+user.email+' · 云端记录';if(authDialog.open)authDialog.close();$('logout').hidden=false;
 }catch(error){showAuthMessage('云端记录加载失败，请稍后重试。');if(!authDialog.open)authDialog.showModal();}finally{cloudLoading=false;}
}
async function cloudSave(next){
 if(cloudBusy||!ready||!cloudUser){$('status').textContent='请先登录并等待记录加载完成。';return false;}
 cloudBusy=true;cloudControls(false);const userId=cloudUser.id,epoch=cloudEpoch;
 try{const verified=await cloudClient.auth.getUser();if(verified.error||verified.data.user?.id!==userId)throw Error('登录已失效，请重新登录。');
 let query;if(cloudRevision===null)query=cloudClient.from('memory_trees').insert({user_id:userId,data:next,revision:1}).select('revision').single();
 else query=cloudClient.from('memory_trees').update({data:next,revision:cloudRevision+1,updated_at:new Date().toISOString()}).eq('user_id',userId).eq('revision',cloudRevision).select('revision').maybeSingle();
 const result=await query;if(epoch!==cloudEpoch)return false;if(result.error)throw Error(result.error.code==='23505'?'其他设备已更新记录，请先保留输入内容再刷新。':'保存失败，请检查网络，输入内容已保留。');if(!result.data)throw Error('其他设备已更新记录，请先保留输入内容再刷新。');cloudRevision=result.data.revision;state=next;render();return true;
 }catch(error){$('status').textContent=error.message;showAuthMessage(error.message);return false;}finally{cloudBusy=false;cloudControls(ready&&Boolean(cloudUser));}
}
async function authAction(mode){
 if(!cloudClient){showAuthMessage('账号服务尚未配置，暂时不能注册或登录。');return;}
 const form=$('auth-form');if(!form.reportValidity())return;const email=$('email').value.trim(),password=$('password').value;
 if(password.length<8){showAuthMessage('密码至少需要 8 个字符。');return;}const buttons=authDialog.querySelectorAll('button');buttons.forEach(b=>b.disabled=true);showAuthMessage('正在处理…');
 try{let result;if(mode==='register')result=await cloudClient.auth.signUp({email,password,options:{emailRedirectTo:location.origin+location.pathname}});else result=await cloudClient.auth.signInWithPassword({email,password});
 if(result.error){const code=result.error.code;throw Error(code==='invalid_credentials'?'邮箱或密码不正确。':code==='email_not_confirmed'?'请先通过邮箱中的链接验证邮箱。':code==='over_email_send_rate_limit'?'验证邮件发送过于频繁，请稍后重试。':'操作未成功，请检查邮箱、密码或稍后重试。');}
 $('password').value='';if(mode==='register'&&!result.data.session)showAuthMessage('如果注册成功，邮箱将收到验证邮件。完成验证后再登录。');else await loadCloudSession();
 }catch(error){showAuthMessage(error.message);}finally{buttons.forEach(b=>b.disabled=false);}
}
$('auth-form').addEventListener('submit',e=>{e.preventDefault();authAction('login')});$('register').addEventListener('click',()=>authAction('register'));$('open-account').addEventListener('click',()=>{showAuthMessage(cloudUser?'当前已登录，可以退出后切换账号。':'登录后查看你的回忆树。');authDialog.showModal()});
$('logout').addEventListener('click',async()=>{if(!cloudClient||cloudBusy)return;const {error}=await cloudClient.auth.signOut();if(error){showAuthMessage('退出失败，请稍后重试。');return;}cloudEpoch++;clearCloudView();$('logout').hidden=true;showAuthMessage('已退出登录。');authDialog.showModal()});
$('retry-cloud').addEventListener('click',()=>cloudClient?loadCloudSession():showAuthMessage('账号服务尚未配置。'));
async function initCloud(){clearCloudView();const c=window.MEMORY_CLOUD_CONFIG;
 if(!c?.url||!c?.publishableKey||!window.supabase){showAuthMessage('账号服务尚未配置，此版本不能注册或登录。');authDialog.showModal();return;}
 try{const url=new URL(c.url);if(url.protocol!=='https:')throw Error('invalid');cloudClient=window.supabase.createClient(c.url,c.publishableKey);cloudClient.auth.onAuthStateChange(event=>{if(event==='SIGNED_OUT'){cloudEpoch++;clearCloudView();$('logout').hidden=true;if(!authDialog.open)authDialog.showModal();}if(event==='SIGNED_IN')setTimeout(()=>loadCloudSession(),0);});await loadCloudSession();}catch(error){showAuthMessage('账号服务配置无效，请检查配置。');authDialog.showModal();}
}
initCloud();
