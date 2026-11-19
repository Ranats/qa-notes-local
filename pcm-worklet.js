class CapturePCM extends AudioWorkletProcessor {
 constructor(){super();this.samples=[];this.position=0;this.chunk=[];this.done=false;this.port.onmessage=()=>{this.done=true;this.flush();this.port.postMessage({flushed:true});};}
 flush(){if(!this.chunk.length)return;const b=new ArrayBuffer(this.chunk.length*2),v=new DataView(b);this.chunk.forEach((s,j)=>v.setInt16(j*2,s,true));this.port.postMessage(b,[b]);this.chunk=[];}
 process(inputs){
  const channel=inputs[0]?.[0];if(this.done||!channel)return true;
  for(const sample of channel)this.samples.push(sample);
  const step=sampleRate/24000;
  while(this.position+1<this.samples.length){
   const i=Math.floor(this.position),f=this.position-i;
   const s=Math.max(-1,Math.min(1,this.samples[i]*(1-f)+this.samples[i+1]*f));
   this.chunk.push(s<0?s*32768:s*32767);this.position+=step;
   if(this.chunk.length===2400)this.flush();
  }
  const used=Math.floor(this.position);this.samples.splice(0,used);this.position-=used;return true;
 }
}
registerProcessor('capture-pcm',CapturePCM);
