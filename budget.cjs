const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
// Standard API USD / million tokens, checked 2026-11-17. Sol input reserve
// includes the documented cache-write rate; the final estimate ignores cache
// discounts deliberately. This is a local spending guard, not account billing.
const RATES={'gpt-6.1-sol':{input:2,cached:.1,cacheWrite:2.5,upperInput:2.5,output:10},'gpt-5.2':{input:1.75,cached:.175,cacheWrite:1.75,upperInput:1.75,output:14}};
function estimateUsage(model,usage){
 const rates=RATES[model],d=usage.input_tokens_details||{};
 const cached=Math.min(usage.input_tokens,d.cached_tokens||0),written=Math.min(usage.input_tokens-cached,d.cache_write_tokens||0);
 return ((usage.input_tokens-cached-written)*rates.input+cached*rates.cached+written*rates.cacheWrite+usage.output_tokens*rates.output)/1e6;
}
class BudgetError extends Error {}
function createBudget(root=__dirname, maxTotalUSD=Infinity){
 const localConfigPath=path.join(root,'budget-config.local.json'),defaultConfigPath=path.join(root,'budget-config.json');
 const ledgerPath=path.join(root,'usage-ledger.json'),lockPath=ledgerPath+'.lock';
 function transaction(fn){
  let fd;try{fd=fs.openSync(lockPath,'wx');}catch{throw new BudgetError('利用額の記録を別処理が更新中です。少し待ってください。');}
  try{
   const ledger=fs.existsSync(ledgerPath)?JSON.parse(fs.readFileSync(ledgerPath,'utf8')):{version:1,entries:[]};
   const result=fn(ledger);fs.writeFileSync(ledgerPath+'.tmp',JSON.stringify(ledger,null,2));fs.renameSync(ledgerPath+'.tmp',ledgerPath);return result;
  }finally{fs.closeSync(fd);fs.unlinkSync(lockPath);}
 }
 function config(){
  const configPath=fs.existsSync(localConfigPath)?localConfigPath:defaultConfigPath;
  if(!fs.existsSync(configPath))throw new BudgetError('利用予算が未設定です。budget-config.json を確認してください。');
  const c=JSON.parse(fs.readFileSync(configPath,'utf8'));
  if(!Number.isFinite(c.limitUSD)||c.limitUSD<=0)throw new BudgetError('利用予算の設定が不正です。');
  return {...c, limitUSD:Math.min(c.limitUSD,maxTotalUSD)};
 }
 function total(l){return l.entries.reduce((s,e)=>s+e.accountedUSD,0);}
 function status(){try{const c=config(),l=fs.existsSync(ledgerPath)?JSON.parse(fs.readFileSync(ledgerPath,'utf8')):{entries:[]};return {limitUSD:c.limitUSD,accountedUSD:total(l),creditVerified:c.creditVerified===true,creditExpiresAt:c.creditExpiresAt||null,scope:'このアプリのローカル記録。アカウント残高ではありません。'};}catch{return {creditVerified:false,error:'利用予算を確認できません。'};}}
 function reserve(payload){
  const c=config();if(c.creditVerified!==true)throw new BudgetError('クレジット残高・期限の確認待ちです。定型文は利用できます。');
  if(!c.creditExpiresAt||!Number.isFinite(Date.parse(c.creditExpiresAt))||Date.now()>=Date.parse(c.creditExpiresAt))throw new BudgetError('確認済みクレジットの期限を過ぎたため、API送信を停止しました。');
  const rates=RATES[payload.model];if(!rates)throw new BudgetError('このモデルの料金が未確認のため、API送信を停止しました。');
  const bytes=Buffer.byteLength(JSON.stringify(payload),'utf8')+4096;
  if(bytes>272000||!Number.isInteger(payload.max_output_tokens)||payload.max_output_tokens>4000)throw new BudgetError('送信量が予算管理の対象範囲を超えています。');
  const ceiling=(bytes*rates.upperInput+payload.max_output_tokens*rates.output)/1e6;
  return transaction(l=>{if(total(l)+ceiling>c.limitUSD)throw new BudgetError('このアプリの利用上限に達する可能性があるため送信を停止しました。定型文は利用できます。');
   const e={id:crypto.randomUUID(),time:new Date().toISOString(),model:payload.model,state:'reserved',reservedUSD:ceiling,accountedUSD:ceiling};l.entries.push(e);return e.id;
  });
 }
 function settle(id,usage){return transaction(l=>{const e=l.entries.find(e=>e.id===id);if(!e)throw new BudgetError('利用額の予約記録が見つかりません。');
  if(!usage||!Number.isInteger(usage.input_tokens)||!Number.isInteger(usage.output_tokens)||usage.input_tokens<0||usage.output_tokens<0){e.state='usage_unknown';return;}
  const rates=RATES[e.model];e.usage={input_tokens:usage.input_tokens,output_tokens:usage.output_tokens,input_tokens_details:usage.input_tokens_details||{}};
  e.estimatedUSD=estimateUsage(e.model,usage);
  e.accountedUSD=(usage.input_tokens*rates.upperInput+usage.output_tokens*rates.output)/1e6;e.state='settled';
 });}
 function reserveAudio(){
  const c=config();if(c.creditVerified!==true||!c.creditExpiresAt||!(Date.now()<Date.parse(c.creditExpiresAt)))throw new BudgetError('クレジット確認期限を過ぎています。');
  return transaction(l=>{const ceiling=.085; if(total(l)+ceiling>c.limitUSD)throw new BudgetError('音声の利用予算が不足しています。');const id=crypto.randomUUID();l.entries.push({id,time:new Date().toISOString(),model:'gpt-live-transcribe',state:'reserved',reservedUSD:ceiling,accountedUSD:ceiling});return id;});
 }
 function settleAudio(id,seconds){return transaction(l=>{const e=l.entries.find(e=>e.id===id);if(!e||!Number.isFinite(seconds)||seconds<0||seconds>300)throw new BudgetError('音声利用記録が不正です。');e.audioSeconds=seconds;e.accountedUSD=Math.ceil(seconds)/60*.017;e.state='duration_estimate';});}
 return {status,reserveAudio,settleAudio,wrap:fetchImpl=>async(url,options)=>{const payload=JSON.parse(options.body),id=reserve(payload);const response=await fetchImpl(url,options);try{const r=await response.clone().json();settle(id,r.usage);}catch(e){if(e instanceof BudgetError)throw e;settle(id,null);}return response;}};
}
module.exports={createBudget,BudgetError,RATES,estimateUsage};
