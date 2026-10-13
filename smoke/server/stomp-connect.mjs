#!/usr/bin/env node
// Node >=22 built-in WebSocket. Secrets enter via stdin, never CLI arguments.
import fs from 'node:fs';
import readline from 'node:readline';
const rl = readline.createInterface({ input: process.stdin });
let readyTimer;
let ws, pending = '', expected, event, connected = false, armed = false, timeout;
const emit = (v) => process.stdout.write(`${JSON.stringify(v)}\n`);
const fail = (reason) => { emit({kind:'error',reason}); clearTimeout(timeout); clearTimeout(readyTimer); ws?.close(); process.exitCode=1; rl.close(); setTimeout(()=>process.exit(1),100).unref(); };
function handle(frame) {
  const sep=frame.indexOf('\n\n');
  const command=frame.slice(0,frame.indexOf('\n'));
  if(command==='ERROR') {
    let code; try {code=JSON.parse(frame.slice(sep+2))?.error?.code;} catch {}
    return fail(typeof code==='string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(code)?`STOMP ERROR ${code}`:'STOMP ERROR');
  }
  if(command==='CONNECTED') {
    connected=true;
    emit({kind:'connected'});
    ws.send(`SUBSCRIBE\nid:smoke-focus\ndestination:/topic/islands/${expected.islandId}/focus\nack:auto\n\n\0`);
    // Spring simple broker does not implement receipts; allow its authorization path to settle.
    readyTimer=setTimeout(()=>{clearTimeout(timeout); emit({kind:"ready"});},expected.subscribeSettleMs??500);
  }
  if(command==='RECEIPT' && frame.includes('receipt-id:smoke-subscribe')) { clearTimeout(timeout); emit({kind:'ready'}); }
  if(command==='MESSAGE') {
    let data; try {data=JSON.parse(frame.slice(sep+2));} catch{return fail('invalid event JSON');}
    // Current realtime envelope uses type/payload; no fallback that accepts a different contract.
    if(data.type==='focus.member.updated' && data.payload?.userId===expected.userId && data.payload?.status==='active') {
      event=data.payload;
      if(armed && event.sessionId===expected.sessionId) {emit({kind:'event',sessionId:event.sessionId}); clearTimeout(timeout); ws.close(); rl.close();}
    }
  }
}
rl.on('line',(line)=>{
  let msg; try {msg=JSON.parse(line);}catch{return fail('invalid control JSON');}
  if(msg.kind==='connect') {
    expected=msg;
    timeout=setTimeout(()=>fail('connect/subscribe timeout'),msg.connectTimeoutMs??5000);
    try { ws=new WebSocket(msg.url,['v12.stomp']); }catch{return fail('invalid WebSocket URL');}
    ws.addEventListener('open',()=>ws.send(`CONNECT\naccept-version:1.2\nheart-beat:0,0\nAuthorization:Bearer ${msg.token}\nhost:${new URL(msg.url).hostname}\n\n\0`));
    ws.addEventListener('error',(e)=>{
      const code=e.error?.cause?.code ?? e.error?.code;
      fail(typeof code==='string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(code)?`WebSocket connection error ${code}`:'WebSocket connection error (handshake/network)');
    });
    ws.addEventListener('close',()=>{ if(!event || !armed || event.sessionId!==expected.sessionId) fail('WebSocket closed before matching event'); });
    ws.addEventListener('message',async ({data})=>{
      pending += typeof data==='string'?data:await data.text();
      while(pending.includes('\0')) {
        const n=pending.indexOf('\0'); const frame=pending.slice(0,n).replace(/^(\r?\n)+/,'').replaceAll('\r\n','\n'); pending=pending.slice(n+1); if(frame) handle(frame);
      }
    });
  } else if(msg.kind==='expect') {
    expected.sessionId=msg.sessionId; armed=true;
    if(event?.sessionId===msg.sessionId) {emit({kind:'event',sessionId:event.sessionId}); ws.close(); rl.close();}
    else timeout=setTimeout(()=>fail('matching focus event timeout'),msg.eventTimeoutMs??3000);
  } else if(msg.kind==='stop') { clearTimeout(timeout); clearTimeout(readyTimer); ws?.close(); rl.close(); }
});
