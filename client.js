const stop = new Set('what why how the a an is are did do does this that it in of for to and you we your our with whether can could would please about have has any explain responses response different mean'.split(' '));
function tokens(s){return s.toLowerCase().match(/[a-z0-9]+|[\u3040-\u30ff\u3400-\u9fff]+/g)||[];}
function rank(s){const query=s.toLowerCase().trim();if(!query)return [];const ts=[...new Set(tokens(query).filter(x=>!stop.has(x)))];return DATA.qa.map(q=>{let score=0;const target=(q.question+' '+q.cues+' '+q.title).toLowerCase();for(const t of ts)if(target.includes(t))score+=t.length>2?2:1;for(const cue of q.cues.toLowerCase().split(' / '))if(cue && query.includes(cue))score+=5;if(query===q.id.toLowerCase())score+=100;return {q,score};}).filter(r=>r.score>=2).sort((a,b)=>b.score-a.score).slice(0,4);}
function exact(s){const v=s.trim().toLowerCase();return DATA.qa.find(q=>[q.id,q.question,q.title].some(t=>t.toLowerCase()===v));}
function el(tag,text,cl){const n=document.createElement(tag);n.textContent=text;if(cl)n.className=cl;return n;}
let version=0,timer,controller,ready=false,composing=false,unavailableMessage="生成を利用できません。起動状態と設定を確認してください。";
const input=document.querySelector('#question'),status=document.querySelector('#status'),out=document.querySelector('#result');
function cancel(){version++;clearTimeout(timer);controller?.abort();controller=null;document.querySelector('#generate').disabled=false;}
function show(q,reason='定型文'){cancel();out.replaceChildren();const card=el('section','','card');card.append(el('small',reason+' · '+(q.id||'')+' '+q.title));if(q.question)card.append(el('p',q.question));if(q.confirm)card.append(el('p',q.confirm,'confirm'));card.append(el('p',q.answer,'answer'),el('p',q.ja,'ja'));if(q.source)card.append(el('small',q.source));offerCorrection(card);out.append(card);}
function renderGenerated(r){out.replaceChildren();const card=el('section','','card');card.append(el('small',r.kind==='insufficient'?'資料では確認できません':'ソースから生成した回答案 · 内容を確認して使用','warning'),el('h2','短い英語の回答'),el('p',r.answer_en,'answer'),el('h2','日本語訳'),el('p',r.answer_ja,'ja'));if(r.inference_ja)card.append(el('h2','推定・留意点'),el('p',r.inference_ja,'warning'));card.append(el('h2','根拠'));if(!r.citations.length)card.append(el('p','この質問に答える根拠は資料内で確認できません。','muted'));for(const c of r.citations){const d=el('details');d.open=true;d.append(el('summary',c.title),el('blockquote',c.quote));card.append(d);}offerCorrection(card);out.append(card);}
function offerCorrection(card) {
  if (!ready || !input.value.trim() || audioState) return;
  const edit = el('button','質問を修正');
  edit.onclick = () => {
    cancel();
    document.querySelector('#auto').checked = false;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  };
  card.append(edit);
  const retry = el('button','定型文を使わず資料から回答');
  retry.onclick = () => generate(true);
  card.append(retry);
}
async function generate(force=false){
  clearTimeout(timer);if(audioState){document.querySelector('#audioStatus').textContent='録音を停止し、文字起こしを確認してから回答を生成してください。';return;}const question=input.value.trim();if(!question||composing)return;
  if(!ready){status.textContent=unavailableMessage;return;}
  cancel();const mine=version;controller=new AbortController();const current=controller;
  document.querySelector('#generate').disabled=true;out.replaceChildren(el('p','定型文との対応を確認し、必要ならソースから回答案を生成しています…','muted'));
  try{
    const r=await fetch('/api/answer',{method:'POST',headers:{'Content-Type':'application/json','X-Session-Token':document.querySelector('meta[name="session-token"]').content},body:JSON.stringify({question,force_generate:force,presentation:MODE,version:SOURCE_VERSION}),signal:AbortSignal.any([current.signal,AbortSignal.timeout(50000)])});
    const data=await r.json();if(mine!==version)return;if(!r.ok)throw Error(data.error||'生成に失敗しました。');
    if(data.kind==='preset'){const q=DATA.qa.find(q=>q.id===data.preset_id);if(!q)throw Error('定型文を確認できませんでした。');show(q,'質問の意味に対応する定型文');}else renderGenerated(data);
  }catch(e){if(mine!==version)return;out.replaceChildren(el('p',e.name==='TimeoutError'?'タイムアウトしました。もう一度生成するか、定型文を選んでください。':e.message,'warning'));}
  finally{if(mine===version){document.querySelector('#generate').disabled=false;controller=null;refreshBudget();}}
}
function showChoices(query){
  const choices=document.querySelector('#choices');choices.replaceChildren();if(!query)return;
  const rs=rank(query);choices.append(el('p',rs.length?'関連する定型文（すぐ選択できます）':'キーワードに一致する定型文はありません。','muted'));
  for(const r of rs){const b=el('button',r.q.id+' '+r.q.title);b.onclick=()=>show(r.q);choices.append(b);}
}
function search(){
  cancel();out.replaceChildren();const query=input.value.trim();showChoices(query);if(!query)return;
  const q=exact(query);if(q){show(q);return;}
  if(ready&&document.querySelector('#auto').checked&&!composing){out.append(el('p','入力が止まると、質問の意味を確認して回答します。','muted'));timer=setTimeout(()=>generate(false),1400);}
}
input.addEventListener('input',search);
input.addEventListener('compositionstart',()=>{composing=true;cancel();});
input.addEventListener('compositionend',()=>{composing=false;search();});
input.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&!composing){e.preventDefault();generate(false);}});
document.querySelector('#auto').addEventListener('change',search);
document.querySelector('#generate').onclick=()=>generate(false);
function populateLists(){
  const list=document.querySelector('#list'),fallback=document.querySelector('#fallback');
  list.replaceChildren();fallback.replaceChildren();
  for(const q of DATA.qa){const b=el('button',q.id+' '+q.title);b.onclick=()=>show(q);list.append(b);}
  for(const q of DATA.emergency){const b=el('button',q.title);b.onclick=()=>show(q);fallback.append(b);}
}
populateLists();
document.querySelector('#materialTitle').textContent=DATA.title||'HAI 2026の論文と発表原稿';
document.querySelector('#useOwn').textContent=MODE==='own'?'自分の資料を入れ替える':'自分の資料で試す';
document.querySelector('#deleteOwn').hidden=MODE!=='own';
document.querySelector('#deleteOwn').onclick=async()=>{
  if(!confirm('このPCに登録した自分の資料を削除しますか？'))return;
  const response=await fetch('/api/presentation',{method:'DELETE',headers:{'Content-Type':'application/json','X-Session-Token':document.querySelector('meta[name="session-token"]').content}});
  if(response.ok)location.href='/?mode=hai';
  else status.textContent='登録した資料を削除できませんでした。';
};
document.querySelector('#useHai').onclick=()=>{
  if(location.protocol==='file:'){location.reload();return;}
  location.href='/?mode=hai';
};
document.querySelector('#useOwn').onclick=()=>{
  if(location.protocol!=='file:' && MODE!=='own' && document.querySelector('#useOwn').dataset.available==='1') {
    location.href='/?mode=own';return;
  }
  const panel=document.querySelector('#ownImport');
  panel.hidden=false;
  if(panel.childElementCount)return;
  window.QAImport.mount(panel,async pack=>{
    if(location.protocol==='file:'){
      DATA=pack;
      populateLists();
      input.value='';
      search();
      document.querySelector('#materialTitle').textContent=pack.title;
      panel.hidden=true;
      status.textContent='自分の資料を読み込みました。オフラインでは定型文を参照できます。生成には Start_QA_Notes.cmd を起動してください。';
      return;
    }
    const response=await fetch('/api/presentation',{method:'POST',headers:{'Content-Type':'application/json','X-Session-Token':document.querySelector('meta[name="session-token"]').content},body:JSON.stringify(pack)});
    const result=await response.json();
    if(!response.ok)throw Error(result.error||'資料を登録できませんでした。');
    location.href='/?mode=own';
  },{assetBase:location.protocol==='file:'?'./':'/'});
};
document.querySelector('#reset').onclick=()=>{abortAudio();liveTranscript.textContent='';audioStatus.textContent='次の質問を録音できます。';input.value='';search();input.focus();};
document.addEventListener('keydown',e=>{if(e.key==='Escape')document.querySelector('#reset').click();if(e.key==='/'&&!['INPUT','TEXTAREA'].includes(document.activeElement.tagName)){e.preventDefault();input.focus();}});
async function refreshBudget(){
  if(location.protocol==='file:')return;
  try{const s=await(await fetch('/api/status')).json();const b=s.budget;
    if(b){const n=document.querySelector('#budgetStatus');n.textContent=b.error||('このアプリの利用額（保守的な推計） USD '+b.accountedUSD.toFixed(3)+' / 上限 USD '+b.limitUSD.toFixed(2)+' · アカウント残高ではありません。');}
  }catch{}
}
async function init(){
  if(location.protocol==='file:'){status.textContent='オフライン定型文モード · 生成は Start_QA_Notes.cmd から起動してください。';return;}
  try{const r=await fetch('/api/status');if(!r.ok)throw Error();const s=await r.json();
    ready=s.configured && (!s.budget || (s.budget.creditVerified && Date.now() < Date.parse(s.budget.creditExpiresAt)));
    unavailableMessage=s.configured?'クレジット残高・期限の確認待ち、または期限切れのため生成を停止しています。定型文は利用できます。':'APIキー未設定 · .env.local を設定しサーバーを再起動してください。';
    document.querySelector('#useOwn').dataset.available=s.ownAvailable?'1':'0';
    status.textContent=ready?'生成準備OK · '+s.model+' · 登録した定型文 '+DATA.qa.length+'問':unavailableMessage;
    refreshBudget();if(ready&&input.value.trim())search();
  }catch{status.textContent='サーバーに接続できません。定型文は引き続き利用できます。';}
}
init();
