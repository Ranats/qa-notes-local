let audioState=null;
const record=document.querySelector('#record'),recordStop=document.querySelector('#recordStop'),audioStatus=document.querySelector('#audioStatus'),liveTranscript=document.querySelector('#liveTranscript');
function releaseMic(s){s.stream?.getTracks().forEach(t=>t.stop());s.node?.disconnect();if(s.ctx&&s.ctx.state!=='closed')s.ctx.close().catch(()=>{});clearInterval(s.clock);}
function abortAudio(){const s=audioState;if(!s)return;audioState=null;releaseMic(s);s.ws?.close();record.disabled=false;recordStop.disabled=true;document.querySelector('#auto').disabled=false;liveTranscript.textContent='';audioStatus.textContent='録音を終了しました。';}
function finishAudio(s,text,message){
 if(audioState!==s)return;
 audioState=null;releaseMic(s);s.ws?.close();record.disabled=false;recordStop.disabled=true;document.querySelector('#auto').disabled=false;
 // Never overwrite hand edits made while the live preview was running.
 const merged=[input.value.trim(),text.trim()].filter(Boolean).join('\n');
 if(merged.length<=1500){input.value=merged;search();audioStatus.textContent=message||'文字起こしを質問欄に反映しました。確認・修正して「確認した質問で回答を表示」を押してください。';}
 else audioStatus.textContent='1500文字を超えるため自動反映しませんでした。下の文字起こしから必要な部分を質問欄にコピーしてください。';
 liveTranscript.textContent=text;refreshBudget();input.focus();
}
record.onclick=async()=>{
 if(audioState)return;if(!ready){audioStatus.textContent=unavailableMessage;return;}
 if(!navigator.mediaDevices?.getUserMedia||!window.AudioWorkletNode){audioStatus.textContent='音声入力は最新のChromeまたはEdgeで http://127.0.0.1:8765/ を開いてください。';return;}
 cancel();document.querySelector('#auto').checked=false;document.querySelector('#auto').disabled=true;
 const s={text:'',started:Date.now()};audioState=s;record.disabled=true;recordStop.disabled=false;liveTranscript.textContent='';audioStatus.textContent='マイクの許可と音声接続を確認しています…';
 try{
  s.stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true},video:false});
  if(audioState!==s){releaseMic(s);return;}
  s.ctx=new AudioContext();await s.ctx.audioWorklet.addModule('/pcm-worklet.js');await s.ctx.resume();
  if(audioState!==s){releaseMic(s);return;}
  s.node=new AudioWorkletNode(s.ctx,'capture-pcm');s.source=s.ctx.createMediaStreamSource(s.stream);
  s.ws=new WebSocket('ws://'+location.host+'/api/audio?token='+encodeURIComponent(document.querySelector('meta[name="session-token"]').content)+'&language='+document.querySelector('#audioLanguage').value);
  s.ws.onmessage=e=>{if(audioState!==s)return;const data=JSON.parse(e.data);
   if(data.type==='ready'){
    s.capturing=true;s.started=Date.now();s.source.connect(s.node);s.node.connect(s.ctx.destination);
    s.node.port.onmessage=event=>{if(audioState!==s||s.stopping||s.ws.readyState!==1)return;if(event.data.flushed){s.stopping=true;releaseMic(s);s.ws.send('stop');return;}if(s.ws.bufferedAmount>192000){finishAudio(s,s.text,'通信が追いつかないため停止しました。文字起こしを確認してください。');return;}s.ws.send(event.data);};
    s.clock=setInterval(()=>{audioStatus.textContent='● 録音・OpenAIへ送信中 '+Math.floor((Date.now()-s.started)/1000)+'秒 / 300秒 · 停止後に確認してください。';},1000);
    audioStatus.textContent='● 録音・OpenAIへ送信中…';
   }
   if(data.type==='delta'){s.text+=data.text;liveTranscript.textContent=s.text;showChoices([input.value.trim(),s.text].join(' ').trim());}
   if(data.type==='stopping'){s.stopping=true;releaseMic(s);recordStop.disabled=true;audioStatus.textContent='音声送信を停止しました。最後の文字起こしを確定中…';}
   if(data.type==='final')finishAudio(s,data.text||s.text);
   if(data.type==='error')finishAudio(s,s.text,data.message+' 表示された文字起こしは未確定です。');
  };
  s.ws.onerror=()=>finishAudio(s,s.text,'音声接続に失敗しました。マイク許可・接続・利用枠を確認してください。手入力も利用できます。');
  s.ws.onclose=()=>{if(audioState===s)finishAudio(s,s.text,'接続が終了しました。未確定の文字起こしを確認してください。');};
 }catch(e){finishAudio(s,s.text,e.name==='NotAllowedError'?'マイクが許可されていません。ブラウザーのマイク設定を確認してください。':'マイクを開始できませんでした。手入力も利用できます。');}
};
recordStop.onclick=()=>{const s=audioState;if(!s)return;recordStop.disabled=true;audioStatus.textContent='録音停止 · 文字起こしを確定中…';if(s.ws?.readyState===1&&s.capturing){s.node.port.postMessage('flush');}else finishAudio(s,s.text,'録音を停止しました。');};
window.addEventListener('pagehide',abortAudio);
