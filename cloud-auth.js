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
let sentEmail='',otpBusy=false,resendUntil=0,resendTimer=null;
function updateResend(){const remaining=Math.max(0,Math.ceil((resendUntil-Date.now())/1000));$('resend-code').disabled=otpBusy||remaining>0;$('resend-code').textContent=remaining?'重新发送（'+remaining+' 秒）':'重新发送验证码';}
function resetOtp(){sentEmail='';$('otp-step').hidden=true;$('email-step').hidden=false;$('email').readOnly=false;$('otp-code').value='';$('otp-description').textContent='';if(resendTimer)clearInterval(resendTimer);resendTimer=null;}
function otpError(error){if(error.code==='over_email_send_rate_limit'||error.status===429)return '发送太频繁，请稍后再试。';if(error.code==='otp_expired'||error.code==='validation_failed')return '验证码不正确或已过期，请检查最新邮件或重新发送。';if(error.code==='email_address_not_authorized')return '邮件服务暂不支持这个收件人，请联系网站维护者配置发信服务。';return '操作未成功，请检查网络，或稍后再试。';}
async function sendOtp(){
 if(otpBusy)return;if(!cloudClient){showAuthMessage('账号服务尚未配置。');return;}
 if(!sentEmail&&!$('email').reportValidity())return;if(sentEmail&&Date.now()<resendUntil)return;
 const email=sentEmail||$('email').value.trim();otpBusy=true;$('send-code').disabled=true;updateResend();showAuthMessage('正在发送验证码…');
 try{const {error}=await cloudClient.auth.signInWithOtp({email,options:{shouldCreateUser:true}});if(error)throw error;sentEmail=email;$('email').readOnly=true;$('email-step').hidden=true;$('otp-step').hidden=false;$('otp-description').textContent='验证码已发送至 '+email+'。请查看最新邮件，也可以检查垃圾箱。';$('otp-code').value='';$('otp-code').focus();resendUntil=Date.now()+60000;if(resendTimer)clearInterval(resendTimer);resendTimer=setInterval(updateResend,1000);showAuthMessage('填写邮件里的数字验证码，无需点击链接。');}
 catch(error){showAuthMessage(otpError(error));}finally{otpBusy=false;$('send-code').disabled=false;updateResend();}
}
async function verifyCode(){
 if(otpBusy||!sentEmail)return;const token=$('otp-code').value.trim();if(!/^\d{6,10}$/.test(token)){showAuthMessage('请填写邮件中的完整数字验证码。');return;}
 otpBusy=true;$('verify-code').disabled=true;$('change-email').disabled=true;updateResend();showAuthMessage('正在验证…');
 try{const {data,error}=await cloudClient.auth.verifyOtp({email:sentEmail,token,type:'email'});if(error)throw error;if(!data.session)throw Error('missing session');resetOtp();await loadCloudSession();}
 catch(error){showAuthMessage(otpError(error));}finally{otpBusy=false;$('verify-code').disabled=false;$('change-email').disabled=false;updateResend();}
}
$('auth-form').addEventListener('submit',e=>{e.preventDefault();sendOtp()});$('otp-form').addEventListener('submit',e=>{e.preventDefault();verifyCode()});$('resend-code').addEventListener('click',sendOtp);$('change-email').addEventListener('click',()=>{resetOtp();showAuthMessage('重新填写邮箱后发送验证码。');});$('open-account').addEventListener('click',()=>{showAuthMessage(cloudUser?'当前已登录，可以退出后切换账号。':'用邮箱验证码进入，无需密码。');$('auth-form').hidden=Boolean(cloudUser);if(cloudUser)$('otp-step').hidden=true;authDialog.showModal()});
$('logout').addEventListener('click',async()=>{if(!cloudClient||cloudBusy)return;const {error}=await cloudClient.auth.signOut();if(error){showAuthMessage('退出失败，请稍后重试。');return;}cloudEpoch++;clearCloudView();resetOtp();$('auth-form').hidden=false;$('logout').hidden=true;showAuthMessage('已退出登录。');authDialog.showModal()});
$('retry-cloud').addEventListener('click',()=>cloudClient?loadCloudSession():showAuthMessage('账号服务尚未配置。'));
async function initCloud(){clearCloudView();const c=window.MEMORY_CLOUD_CONFIG;
 if(!c?.url||!c?.publishableKey||!window.supabase){showAuthMessage('账号服务尚未配置，此版本不能注册或登录。');authDialog.showModal();return;}
 try{const url=new URL(c.url);if(url.protocol!=='https:')throw Error('invalid');cloudClient=window.supabase.createClient(c.url,c.publishableKey);cloudClient.auth.onAuthStateChange(event=>{if(event==='SIGNED_OUT'){cloudEpoch++;clearCloudView();resetOtp();$('auth-form').hidden=false;$('logout').hidden=true;if(!authDialog.open)authDialog.showModal();}if(event==='SIGNED_IN')setTimeout(()=>loadCloudSession(),0);});await loadCloudSession();}catch(error){showAuthMessage('账号服务配置无效，请检查配置。');authDialog.showModal();}
}
initCloud();
