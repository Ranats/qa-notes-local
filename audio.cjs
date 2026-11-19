const {WebSocket,WebSocketServer}=require('./vendor/ws');
// PCM16 mono 24 kHz; at most five minutes per question. Audio is never saved.
function attachAudio(server,{token,apiKey,budget,connect=()=>new WebSocket('wss://api.openai.com/v1/realtime?intent=transcription',{headers:{Authorization:`Bearer ${apiKey}`},handshakeTimeout:10000})}){
 const wss=new WebSocketServer({noServer:true,maxPayload:65536});let active=false;
 server.on('upgrade',(req,socket,head)=>{
  const origin=`http://127.0.0.1:${server.address().port}`;let url;
  try{url=new URL(req.url,origin);}catch{socket.destroy();return;}
  if(req.headers.host!==new URL(origin).host||req.headers.origin!==origin||url.pathname!=='/api/audio'||url.searchParams.get('token')!==token||!apiKey||active){socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');return;}
  active=true;wss.handleUpgrade(req,socket,head,client=>{
   let upstream,reservation,bytes=0,ready=false,stopping=false,closed=false,idle,deadline,finalTimer;
   const send=data=>{if(client.readyState===1)client.send(JSON.stringify(data));};
   const close=()=>{if(closed)return;closed=true;clearTimeout(idle);clearTimeout(deadline);clearTimeout(finalTimer);upstream?.terminate();client.close();active=false;if(reservation)try{budget.settleAudio(reservation,bytes/48000);}catch{/* retain reservation on ledger failure */}};
   const fail=message=>{send({type:'error',message});close();};
   const stop=()=>{if(stopping)return;stopping=true;clearTimeout(idle);send({type:'stopping'});if(!ready||bytes<4800){send({type:'final',text:''});close();return;}upstream.send(JSON.stringify({type:'input_audio_buffer.commit'}));finalTimer=setTimeout(()=>fail('最終文字起こしがタイムアウトしました。表示中の文を確認して使えます。'),15000);};
   const touch=()=>{clearTimeout(idle);idle=setTimeout(()=>fail('音声入力が途切れました。手入力、または録音を再開してください。'),12000);};
   client.on('close',close);client.on('error',close);
   client.on('message',(data,binary)=>{
    if(closed||stopping)return;
    if(!binary){if(data.toString()==='stop')stop();else fail('不正な音声操作です。');return;}
    if(!ready||data.length%2||data.length>48000||upstream.bufferedAmount>192000){fail('音声送信が追いつきません。録音を再開してください。');return;}
    const remaining=14400000-bytes,chunk=data.subarray(0,remaining);bytes+=chunk.length;
    upstream.send(JSON.stringify({type:'input_audio_buffer.append',audio:chunk.toString('base64')}));touch();if(bytes>=14400000)stop();
   });
   try{reservation=budget?.reserveAudio();upstream=connect();}catch(e){fail(e.name==='Error'?'音声接続を開始できません。':e.message);return;}
   touch();deadline=setTimeout(stop,300000);
   upstream.on('open',()=>upstream.send(JSON.stringify({type:'session.update',session:{type:'transcription',audio:{input:{format:{type:'audio/pcm',rate:24000},transcription:{model:'gpt-live-transcribe',languages:url.searchParams.get('language')==='ja'?['ja']:url.searchParams.get('language')==='both'?['en','ja']:['en'],delay:'low',prompt:'A question from the audience during a presentation.'},turn_detection:null}}}})));
   upstream.on('message',raw=>{if(closed)return;let e;try{e=JSON.parse(raw);}catch{return;}
    if(e.type==='session.updated'||e.type==='transcription_session.updated'){ready=true;send({type:'ready'});touch();}
    if(e.type==='conversation.item.input_audio_transcription.delta')send({type:'delta',text:e.delta||'',itemId:e.item_id});
    if(e.type==='conversation.item.input_audio_transcription.completed'){send({type:'final',text:e.transcript||'',itemId:e.item_id});close();}
    if(e.type==='error'||e.type==='conversation.item.input_audio_transcription.failed')fail('OpenAIの音声認識に失敗しました（'+(e.error?.code||'transcription_error')+'）。手入力も利用できます。');
   });
   upstream.on('error',()=>fail('OpenAI音声APIへの接続に失敗しました。接続・利用枠を確認してください。'));
   upstream.on('close',()=>{if(!closed)fail('音声接続が終了しました。表示中の文を確認してください。');});
  });
 });
 server.on('close',()=>{for(const client of wss.clients)client.terminate();wss.close();});
 return wss;
}
module.exports={attachAudio};
