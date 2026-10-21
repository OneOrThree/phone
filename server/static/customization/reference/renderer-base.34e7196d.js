/* 원본 PNG의 512px 좌표를 사용하는 검토용 합성기. 앱 런타임 연동은 별도. */
(() => {
const data=window.ASSET_DATA;
const items=data.manifest.groups.flatMap(g=>g.items);
const byId=Object.fromEntries(items.map(x=>[x.id,x]));
const images=new Map(), errors=[];
const motionInfo={walk:{n:6,ms:125,dir:'walking/walking',label:'걷기'},focus:{n:4,ms:250,dir:'fishing/fishing',label:'낚시'},reel:{n:4,ms:100,dir:'fishing/reel',label:'릴 감기'}};
const colors=['black','ginger','cream','gray','white','calico'];
const palette={cream:'#FFF7EB',paper:'#FFFDFA',pink:'#FFA6BC',sky:'#ADE1F8',butter:'#FFE08A',brown:'#8B6956',ink:'#493B39',muted:'#796256',night:'#1D2521'};
const defaultState={motion:'walk',frame:0,color:'black',flip:false,night:false,scene:'cat',play:true,debug:false,selection:{head:'head-mandarin',neck:'neck-picnic',shoes:null,flag:'flag-fish',mat:null,oar:null,cargo:null,lantern:null,canopy:null}};
const state=structuredClone(defaultState);
// [머리 위, 목, 등, 귀, 꼬리, 네 발]. 각 프레임을 독립적으로 지정한다.
const walk=[
 {head:[278,190],neck:[298,350],back:[190,337],ear:[188,206],tail:[111,297],feet:[[218,431,-5,35],[352,412,-22,43],[169,438,10,43],[278,451,0,47]]},
 {head:[278,190],neck:[298,350],back:[188,336],ear:[188,206],tail:[109,296],feet:[[180,434,0,35],[216,438,0,40],[270,450,0,46],[341,449,0,45]]},
 {head:[278,190],neck:[298,350],back:[187,334],ear:[188,206],tail:[108,295],feet:[[245,441,0,40],[168,432,12,44],[315,447,-10,47]]},
 {head:[266,190],neck:[284,350],back:[176,336],ear:[175,206],tail:[125,295],feet:[[219,440,0,34],[347,426,-20,43],[167,442,3,43],[255,451,0,46]]},
 {head:[278,190],neck:[298,350],back:[188,335],ear:[188,206],tail:[107,295],feet:[[181,435,8,43],[348,429,-20,44],[250,451,0,46]]},
 {head:[270,190],neck:[291,350],back:[183,336],ear:[182,206],tail:[113,297],feet:[[211,435,0,34],[181,440,8,43],[305,451,-8,46]]}
];
const focus=Array.from({length:4},(_,i)=>({head:[254,114+(i===1?2:0)],neck:[282,310],back:[167,331],ear:[148,135],tail:[99,277],feet:[[342,445,0,48],[264,450,0,50],[361,334,-55,37],[325,349,-15,42]]}));
const reel=[
 {head:[250,113],neck:[280,308],back:[162,331],ear:[145,136],tail:[90,295],feet:[[366,443,0,49],[274,448,0,51],[353,346,-35,43],[311,354,-10,45]]},
 {head:[241,115],neck:[283,312],back:[178,344],ear:[139,140],tail:[96,305],feet:[[411,418,-35,50],[293,448,0,51],[421,219,-65,44],[331,307,-30,43]]},
 {head:[224,121],neck:[264,308],back:[186,343],ear:[128,154],tail:[100,337],feet:[[408,419,-35,51],[290,449,0,51],[385,217,-65,43],[168,271,-135,44]]},
 {head:[250,113],neck:[280,308],back:[164,332],ear:[145,136],tail:[92,295],feet:[[369,443,0,49],[277,448,0,51],[355,346,-35,43],[315,354,-10,45]]}
];
const anchors={walk,focus,reel};
const logs=[];
function getImage(path){return images.get(path);}
async function loadImage(path){
 if(images.has(path))return images.get(path);
 const im=new Image();im.src=path;
 try{await im.decode();images.set(path,im);return im}catch(e){errors.push(path);return null}
}
function meta(path){return data.metadata[path];}
function crop(path){const m=meta(path);if(!m)return null;const [l,t,r,b]=m.bbox;return {x:l,y:t,w:r-l,h:b-t};}
function drawRaw(ctx,path,x,y,w,h){const im=getImage(path);if(im)ctx.drawImage(im,x,y,w,h);}
function drawPart(ctx,item,x,y,w,{rotation=0,anchorX=.5,anchorY=1,h,alpha=1,debug=false}={}){
 if(!item)return null;
 const im=getImage(item.path),c=crop(item.path);if(!im||!c)return null;
 const height=h??w*c.h/c.w;
 ctx.save();ctx.translate(x,y);ctx.rotate(rotation*Math.PI/180);ctx.globalAlpha=alpha;
 ctx.drawImage(im,c.x,c.y,c.w,c.h,-w*anchorX,-height*anchorY,w,height);
 if(debug){ctx.strokeStyle=palette.pink;ctx.lineWidth=1;ctx.strokeRect(-w*anchorX,-height*anchorY,w,height);ctx.beginPath();ctx.arc(0,0,3,0,7);ctx.fillStyle=palette.ink;ctx.fill();}
 ctx.restore();
 const b={id:item.id,x:x-w*anchorX,y:y-height*anchorY,w,h:height,rotation};
 logs.push(b);return b;
}
function item(s,slot){return byId[s.selection[slot]];}
function pathFor(s){return 'reference/cat/'+s.color+'/'+motionInfo[s.motion].dir+'-frame-'+(s.frame%motionInfo[s.motion].n)+'.png';}
function mappedAnchor(s){return structuredClone(window.CAT_FIT[s.color][s.motion][s.frame%motionInfo[s.motion].n]);}
function restoreHead(ctx,s,a,path){
 const [lx,ly,rx,ry]=a.jaw,[cx,cy]=a.chin;
 ctx.save();ctx.beginPath();ctx.moveTo(lx,ly);ctx.lineTo(80,0);ctx.lineTo(500,0);ctx.lineTo(rx,ry);
 ctx.bezierCurveTo(rx-18,cy-10,cx+43,cy+3,cx,cy);ctx.bezierCurveTo(cx-48,cy-1,lx+22,ly+25,lx,ly);ctx.closePath();ctx.clip();drawRaw(ctx,path,0,0,512,512);ctx.restore();
}
function restoreHands(ctx,s,a,path){
 if(s.motion==='walk')return;
 // 목 천 앞을 지나는 앞발만 원본에서 복원한다. 발바닥 신발은 이후 별도로 그린다.
 for(const [fx,fy,fw,rot]of a.feet.filter(f=>f[1]<380)){
  ctx.save();ctx.translate(fx,fy);ctx.rotate(rot*Math.PI/180);ctx.beginPath();ctx.ellipse(0,0,fw*.55,fw*.60,0,0,Math.PI*2);ctx.clip();ctx.rotate(-rot*Math.PI/180);ctx.translate(-fx,-fy);drawRaw(ctx,path,0,0,512,512);ctx.restore();
 }
}
function drawCat(ctx,s,x,y,extent){
 if(window.FinalFit?.readyState){window.FinalFit.drawCat(ctx,s,x,y,extent);return;}
 ctx.save();ctx.translate(x,y);ctx.scale(extent/512,extent/512);
 if(s.flip){ctx.translate(512,0);ctx.scale(-1,1);}
 const a=mappedAnchor(s),catPath=pathFor(s);
 drawRaw(ctx,catPath,0,0,512,512);
 const neck=item(s,'neck');
 if(neck){
  const compact=['bow','star','fishbell','shell'].includes(neck.slug),w=compact?86:132;
  drawPart(ctx,neck,a.neck[0],a.neck[1],w,{debug:s.debug});
  restoreHead(ctx,s,a,catPath);restoreHands(ctx,s,a,catPath);
 }
 const shoe=item(s,'shoes');
 if(shoe)a.feet.forEach(([fx,fy,fw,rot,view])=>{
  const sole=view==='sole'&&getImage(shoe.solePath),front=view==='front'&&getImage(shoe.frontPath);
  const asset=sole?{...shoe,path:shoe.solePath}:front?{...shoe,path:shoe.frontPath}:shoe;
  if(shoe.thinSlipper){
   const width=fw*1.02;
   const height=width*(view==='sole'?1.12:view==='front'?1.02:.64);
   const angle=rot*Math.PI/180;
   const tip=0;
   const x=fx-Math.sin(angle)*tip,y=(view==='side'?fy-height/2-1:fy)+Math.cos(angle)*tip;
   drawPart(ctx,asset,x,y,width,{h:height,anchorY:.5,rotation:angle*180/Math.PI,debug:s.debug});
  }else{
   const c=crop(asset.path),width=fw*1.06,height=width*c.h/c.w;
   const centered=view==='sole'||view==='front';
   drawPart(ctx,asset,fx,centered?fy:fy-height/2+2,width,{anchorY:.5,rotation:view==='front'&&!front?rot-90:rot,debug:s.debug});
  }
 });
 const prop=item(s,'head');
 if(prop){
  const [hx,hy,angle]=window.HEAD_CONTACT[s.color][s.motion][s.frame%motionInfo[s.motion].n];
  const width=prop.width;
  ctx.save();ctx.translate(hx,hy);ctx.rotate(angle*Math.PI/180);ctx.fillStyle='rgba(51,27,14,.15)';ctx.beginPath();ctx.ellipse(0,1,width*.24,2.5,0,0,Math.PI*2);ctx.fill();ctx.restore();
  drawPart(ctx,prop,hx,hy+1,width,{rotation:angle,debug:s.debug});
 }
 ctx.restore();
}
function drawRod(ctx,s,x,y,extent){
 if(s.motion==='walk')return;
 ctx.save();ctx.translate(x,y);ctx.scale(extent/512,extent/512);
 if(s.flip){ctx.translate(512,0);ctx.scale(-1,1);}
 // FocusSea: 293x325 / 406px cat, (206,40) relative to its image.
 ctx.translate(260,50);if(s.motion==='reel'){ctx.translate(185,205);ctx.rotate(-11*Math.PI/180);ctx.translate(-185,-205);}
 drawRaw(ctx,'reference/fishing-rod.png',0,0,369,410);
 ctx.restore();
}
function drawRaft(ctx,s){
 const side=s.scene==='side';
 const original=side?'reference/raft/sailing/day.png':'reference/raft/day.png';
 const clean=side?'reference/raft-clean-side.png':'reference/raft-clean-isometric.png';
 const path=item(s,'oar')&&getImage(clean)?clean:original;
 const c=crop(path);
 const boat={x:side?105:145,y:side?395:270,w:side?590:510,h:side?145:330};
 // 알파 경계를 표시 영역에 맞춰 생성본마다 다른 투명 여백을 보정한다.
 const im=getImage(path);if(im&&c)ctx.drawImage(im,c.x,c.y,c.w,c.h,boat.x,boat.y,boat.w,boat.h);
 const deco=(slot,x,y,w,opts={})=>drawPart(ctx,item(s,slot),x,y,w,{debug:s.debug,...opts});
 deco('canopy',side?550:565,side?405:403,side?150:150,{anchorX:.5});
 deco('flag',side?190:205,side?411:445,72,{anchorX:.08});
 const mat=item(s,'mat');if(mat){const asset=side&&getImage(mat.sidePath)?{...mat,path:mat.sidePath}:mat;drawPart(ctx,asset,side?378:385,side?414:441,175,{anchorY:.5,rotation:side||mat.slug==='picnic'?0:-15,debug:s.debug});}
 const catX=side?238:265,catY=side?166:214,catSize=side?270:252;
 drawCat(ctx,s,catX,catY,catSize);
 deco('cargo',side?630:330,side?418:520,70);
 deco('lantern',side?478:486,side?421:446,49);
 
 if(item(s,'oar'))deco('oar',side?412:510,side?493:464,side?345:258,{anchorY:.5,rotation:side?8:125});
 drawRod(ctx,s,catX,catY,catSize);
}
function render(canvas,s=state){
 const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.clearRect(0,0,canvas.width,canvas.height);
 ctx.save();ctx.scale(canvas.width/800,canvas.height/620);
 ctx.fillStyle=s.night?palette.night:palette.cream;ctx.fillRect(0,0,800,620);
 ctx.fillStyle=s.night?'#26302A':palette.sky;
 if(s.scene!=='cat'){ctx.beginPath();ctx.ellipse(400,527,344,55,0,0,7);ctx.fill();}
 else {ctx.fillStyle=s.night?'#313C33':'#F0E3D4';ctx.beginPath();ctx.ellipse(380,538,212,22,0,0,7);ctx.fill();}
 logs.length=0;
 if(s.scene==='cat'){drawCat(ctx,s,130,54,500);drawRod(ctx,s,130,54,500);}
 else drawRaft(ctx,s);
 ctx.restore();return structuredClone(logs);
}
function allSelection(index,target){
 const out={};
 for(const g of data.manifest.groups)out[g.id]=!target||g.target===target?g.items[index%10].id:null;
 return out;
}
function pairwise(target){
 const groups=data.manifest.groups.filter(g=>g.target===target);
 const out=[];
 for(let a=0;a<11;a++)for(let b=0;b<11;b++){
  const selection={};groups.forEach((g,k)=>{const index=(a+k*b)%11;selection[g.id]=index<10?g.items[index].id:null;});
  out.push({id:target+'-'+a+'-'+b,selection});
 }
 return out;
}
async function ready(){
 const paths=new Set(items.filter(x=>meta(x.path)).map(x=>x.path));
 for(const a of items)for(const p of [a.solePath,a.frontPath,a.sidePath])if(p&&meta(p))paths.add(p);
 for(const color of colors)for(const m of Object.keys(motionInfo))for(let f=0;f<motionInfo[m].n;f++)paths.add(pathFor({color,motion:m,frame:f}));
 for(const p of ['reference/raft/day.png','reference/raft/sailing/day.png','reference/fishing-rod.png','reference/raft-clean-isometric.png','reference/raft-clean-side.png'])if(meta(p))paths.add(p);
 const pending=[...paths];let cursor=0;
 await Promise.all(Array.from({length:8},async()=>{while(cursor<pending.length)await loadImage(pending[cursor++]);}));
 return {loaded:images.size,errors};
}
window.Studio={data,items,byId,images,errors,state,defaultState,motionInfo,colors,anchors,render,ready,drawPart,drawCat,allSelection,pairwise,pathFor,palette};
})();

