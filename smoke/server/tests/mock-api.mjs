import http from 'node:http';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
const user='11111111-1111-4111-8111-111111111111', peer='22222222-2222-4222-8222-222222222222', island='33333333-3333-4333-8333-333333333333',session='44444444-4444-4444-8444-444444444444';
let logged=0,current=null,ws,subscription=false, screen=null;
const token=(id)=>`header.${Buffer.from(JSON.stringify({sid:id})).toString('base64url')}.signature`;
function sendFrame(text){const b=Buffer.from(text); const h=Buffer.alloc(b.length<126?2:4);h[0]=0x81;if(b.length<126)h[1]=b.length;else{h[1]=126;h.writeUInt16BE(b.length,2)}ws?.write(Buffer.concat([h,b]));}
const server=http.createServer(async(req,res)=>{
  let raw='';for await(const chunk of req)raw+=chunk;
  const b=raw?JSON.parse(raw):{}; const p=new URL(req.url,'http://mock');let data=null,status=200;
  if(p.pathname==='/health'){res.writeHead(process.env.MOCK_HEALTH_FAIL?'503':'200');return res.end('{}');}
  if(req.method==='POST'&&p.pathname==='/auth/sessions/guest'){const id=logged++<2?user:peer;data={userId:id,accessToken:token(id),refreshToken:'secret-refresh-token',onboardingComplete:false};status=201;res.setHeader('X-Device-Bootstrap','secret-bootstrap');}
  else if(p.pathname==='/islands'&&req.method==='POST'){data={id:island};status=201;}
  else if(p.pathname==='/me')data={id:user};
  else if(p.pathname==='/me/islands')data={items:[{id:island}],currentIslandId:island};
  else if(p.pathname==='/screens/home')data={buildings:[],members:{items:[]},wallets:{fish:0,villagePoints:0}};
  else if(p.pathname==='/focus-sessions/current')data=current;
  else if(p.pathname==='/focus-sessions'&&req.method==='POST'){
    if(b.targetMinutes && b.targetMinutes!==1)status=400;
    current={id:session,version:1,status:'active'};data=current;status=201;
    if(subscription&&!process.env.MOCK_NO_EVENT)sendFrame('MESSAGE\nsubscription:smoke-focus\n\n'+JSON.stringify({type:'focus.member.updated',payload:{userId:user,sessionId:session,status:'active'}})+'\0');
  }else if(p.pathname.endsWith('/finish')){current=null;data={recordId:session};}
  else if(p.pathname==='/api/v1/users/me/device-token'){if(b.deviceBootstrap!=='secret-bootstrap')status=400;data={ownershipToken:process.env.MOCK_OWNERSHIP_TOKEN??'66666666-6666-4666-8666-666666666666'};}
  else if(p.pathname.endsWith('/memberships'))data={status:'active'};
  else if(p.pathname.endsWith('/members'))data={items:[{id:peer}]};
  else if(p.pathname.endsWith('/focus-members'))data={items:[{userId:user,sessionId:session,status:'active'}]};
  else if(p.pathname==='/friends/requests'&&req.method==='GET')data=[{userId:user,requestId:session}];
  else if(p.pathname==='/friends/requests'&&req.method==='POST')status=201;
  else if(p.pathname==='/friends')data=[{userId:user,isFocusing:true,focusStartedAt:'2026-01-01T00:00:00Z'}];
  else if(p.pathname.startsWith('/me/screen-time/')){screen={date:p.pathname.split('/').at(-1),minutes:b.minutes,measurementStatus:b.measurementStatus};data=screen;}
  else if(p.pathname.endsWith('/statistics/screen-time')) data=screen?{scope:'me',totalMinutes:process.env.MOCK_BAD_SCREEN?8:7,series:[screen]}:{scope:'me',series:[],totalMinutes:null};
  else if(req.method!=='DELETE'&&!p.pathname.endsWith('/accept'))status=404;
  res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(p.pathname==='/api/v1/users/me/device-token'?data:{data}));
});
server.on('upgrade',(req,socket)=>{
  ws=socket;socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Protocol: v12.stomp\r\nSec-WebSocket-Accept: '+createHash('sha1').update(req.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64')+'\r\n\r\n');
  let pending=Buffer.alloc(0);socket.on('error',()=>{});socket.on('data',chunk=>{pending=Buffer.concat([pending,chunk]);while(pending.length>=6){let n=pending[1]&127,o=2;if(n===126){if(pending.length<8)return;n=pending.readUInt16BE(2);o=4}if(pending.length<o+4+n)return;const mask=pending.subarray(o,o+4),payload=pending.subarray(o+4,o+4+n);for(let i=0;i<n;i++)payload[i]^=mask[i%4];pending=pending.subarray(o+4+n);const s=payload.toString();if(s.startsWith('CONNECT\n'))sendFrame('CONNECTED\nversion:1.2\n\n\0');if(s.startsWith('SUBSCRIBE\n'))subscription=true;}});
});
server.listen(0,'127.0.0.1',()=>fs.writeFileSync(process.argv[2],String(server.address().port)));
