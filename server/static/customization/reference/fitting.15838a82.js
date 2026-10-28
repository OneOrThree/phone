window.FinalFit=(()=>{
const HEAD_SEATING={mandarin:9,duck:7,bear:8,bunny:8,chick:10,frog:8,peach:9,riceball:8,bun:9,seal:7};
const layers={neck:{},shoes:{}},frames=[];let neckRig,shoeRig,strip;const c512=()=>{const c=document.createElement('canvas');c.width=c.height=512;return c;};
const image=item=>Studio.images.get(item.path),view=item=>FINAL_CATALOG.views[item.id];
function sample(paths,x){let points=paths.flat();let best=points[0];for(let i=0;i<points.length-1;i++){const a=points[i],b=points[i+1];if(x>=a[0]&&x<=b[0]){const u=(x-a[0])/(b[0]-a[0]);return [a[1]+(b[1]-a[1])*u,a[2]+(b[2]-a[2])*u];}if(Math.abs(points[i][0]-x)<Math.abs(best[0]-x))best=points[i];}return best.slice(1);}
function drawBand(ctx,im,box,paths){const [l,t,r,b]=box;for(const path of paths){const start=path[0][0],end=path.at(-1)[0];for(let x=start;x<end;x+=.5){const [top,bottom]=sample([path],x),sx=l+(x-start)/(end-start)*(r-l-1);ctx.drawImage(im,sx,t,Math.max(1,(r-l)/(end-start)*.65),b-t,x,top,.65,bottom-top);}}}
function neck(item,id){const c=c512(),ctx=c.getContext('2d'),p=neckRig.frames[id],v=view(item),im=image(item),[l,t,r,b]=v.front.box;
 if(item.kind==='scarf'){
  const all=p.paths.flat(),left=Math.min(...all.map(a=>a[0])),right=Math.max(...all.map(a=>a[0])),w=Math.min(86,(right-left)*.83),cx=Math.max(left+w/2,Math.min(right-w/2,p.anchor[0]-10)),h=Math.min(48,w*(b-t)/(r-l));
  for(let x=0;x<w;x+=.5){const px=cx-w/2+x,[top,bt]=sample(p.paths,px),sx=l+x/w*(r-l);const sy=v.front.columns[Math.min(r-l-1,Math.floor(sx-l))];if(sy==null)continue;ctx.drawImage(im,sx,sy,Math.max(1,(r-l)/w*.65),b-sy,px,(top+bt)/2-1,.65,h*(b-sy)/(b-t));}
 }else{const w=item.kind==='bow'?54:29,h=w*(b-t)/(r-l);ctx.save();ctx.translate(...p.anchor);ctx.rotate(p.angle*Math.PI/180);ctx.drawImage(im,l,t,r-l,b-t,-w/2,-h*(item.kind==='bow'?.42:.14),w,h);ctx.restore();}
 // Render the wrapping strip above the scarf's seam; bows/pendants sit in front.
 if(item.kind==='scarf')drawBand(ctx,im,v.band.box,p.paths);
 else {const front=c512();front.getContext('2d').drawImage(c,0,0);ctx.clearRect(0,0,512,512);drawBand(ctx,v.band?im:strip,v.band?.box||FINAL_CATALOG.views['common-band'].box,p.paths);ctx.drawImage(front,0,0);}
 ctx.save();ctx.globalCompositeOperation='destination-out';
 // Shared jaw edge and forepaw occluders are independent of accessory artwork.
 const all=p.paths.flat();if(all.length){ctx.beginPath();ctx.moveTo(all[0][0],0);for(const [x,top] of all)ctx.lineTo(x,top-1);ctx.lineTo(all.at(-1)[0],0);ctx.closePath();ctx.fill();}
 for(const points of p.occluders){ctx.beginPath();points.forEach((pt,i)=>i?ctx.lineTo(...pt):ctx.moveTo(...pt));ctx.closePath();ctx.fill();}ctx.restore();return c;
}
function shoes(item,id){const c=c512(),ctx=c.getContext('2d'),im=image(item),views=view(item);for(const foot of shoeRig[id]){const src=views[foot.view],t=foot.box[1],b=foot.box[3],[sl,st,sr,sb]=src.box;for(const [y,l,r]of foot.rows){const sy=st+(y-t)/(b-t)*(sb-st-1),row=src.rows[Math.min(src.rows.length-1,Math.max(0,Math.floor(sy-st)))];if(!row)continue;ctx.drawImage(im,row[0],sy,row[1]-row[0],Math.max(1,(sb-st)/(b-t)),l,y,r-l,1.15);}}return c;}
function drawCat(ctx,s,x,y,extent){const id=s.motion+'-'+s.frame;ctx.save();ctx.translate(x,y);ctx.scale(extent/512,extent/512);if(s.flip){ctx.translate(512,0);ctx.scale(-1,1);}const original=Studio.images.get(Studio.pathFor({...s,color:'black'}));ctx.drawImage(original,0,0,512,512);for(const slot of ['neck','shoes'])if(s.selection[slot])ctx.drawImage(layers[slot][s.selection[slot]][id],0,0);
 const head=Studio.byId[s.selection.head];if(head){const [baseX,baseY,angle]=HEAD_CONTACT.black[s.motion][s.frame],raised=s.motion==='reel'&&s.frame===2,hx=baseX+(raised?12:0),hy=baseY+(raised?5:0),depth=HEAD_SEATING[head.slug];ctx.save();ctx.translate(hx,hy+depth);ctx.rotate(angle*Math.PI/180);ctx.fillStyle='rgba(51,27,14,.18)';ctx.beginPath();ctx.ellipse(0,0,head.width*.22,2.5,0,0,Math.PI*2);ctx.fill();ctx.restore();Studio.drawPart(ctx,head,hx,hy+depth,head.width,{rotation:angle,debug:s.debug});}ctx.restore();}
function preview(ctx,item,w,h){const v=FINAL_CATALOG.views[item.id];let box;if(v)box=(item.category==='shoes'?v.side:v.front).box;else box=ASSET_DATA.metadata[item.path].bbox;const [l,t,r,b]=box,scale=Math.min((w-36)/(r-l),(h-36)/(b-t));ctx.drawImage(image(item),l,t,r-l,b-t,(w-(r-l)*scale)/2,(h-(b-t)*scale)/2,(r-l)*scale,(b-t)*scale);}
async function ready(){[neckRig,shoeRig]=await Promise.all(['final/neck-rig.json','final/shoe-rig.json'].map(p=>fetch(p).then(r=>r.json())));strip=new Image();strip.src='final/assets/neck/common-band.png';await strip.decode();for(const motion of ['walk','focus','reel'])for(let frame=0;frame<(motion==='walk'?6:4);frame++)frames.push({id:motion+'-'+frame,motion,frame});for(const slot of ['neck','shoes'])for(const item of Studio.items.filter(a=>a.category===slot)){layers[slot][item.id]={};for(const f of frames)layers[slot][item.id][f.id]=slot==='neck'?neck(item,f.id):shoes(item,f.id);}api.readyState=true;}
const api={ready,readyState:false,drawCat,preview,layers,frames};return api;
})();
