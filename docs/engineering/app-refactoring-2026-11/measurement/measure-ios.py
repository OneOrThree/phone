import subprocess,time,json,re,sys,os
from pathlib import Path
from PIL import Image
fresh=len(sys.argv)>2 and sys.argv[2]=='fresh';prefix='fresh-' if fresh else ''
stage=sys.argv[1];root=Path(os.environ['REFACTOR_ARTIFACTS'])/stage
sim=os.environ['REFACTOR_IOS_DEVICE'];app='com.oneorthree.focuscat'
def run(*a,check=True):return subprocess.run(a,capture_output=True,text=True,check=check)
def cpu(pid):
 s=run('ps','-p',str(pid),'-o','time=').stdout.strip();parts=s.split(':');return sum(float(x)*60**i for i,x in enumerate(reversed(parts)))
rows=[]
for i in range(1,6):
 run('xcrun','simctl','terminate',sim,app,check=False)
 if fresh:
  run('xcrun','simctl','uninstall',sim,app,check=False)
  run('xcrun','simctl','install',sim,str(root/'Cattus.app'))
 started=time.monotonic();out=run('xcrun','simctl','launch',sim,app).stdout;pid=int(out.rsplit(':',1)[1])
 shot=root/f'{prefix}home-{i}.png';ready=None;captures=0
 while time.monotonic()-started<20:
  run('xcrun','simctl','io',sim,'screenshot',str(shot));captures+=1
  im=Image.open(shot).convert('RGB').resize((201,437))
  pink=sum(r>210 and 90<g<190 and 140<b<230 for r,g,b in im.crop((145,370,190,415)).getdata())
  paper=sum(r>225 and g>215 and b>205 for r,g,b in im.crop((20,65,80,90)).getdata())
  land=sum(r>120 and g>105 and b<r-20 and g>b+15 for r,g,b in im.crop((70,120,150,230)).getdata())
  roof=sum(60<r<155 and 100<g<190 and 110<b<200 and b>r+10 for r,g,b in im.crop((75,275,140,315)).getdata())
  cat=sum(r<110 and g<110 and b<110 for r,g,b in im.crop((16,40,30,55)).getdata())
  if pink>450 and paper>300 and land>2000 and roof>70 and cat>20:ready=time.monotonic()-started;break
 if ready is None:raise SystemExit('Home ready timeout')
 time.sleep(5)
 mem=run('footprint',str(pid),check=False)
 (root/f'{prefix}footprint-{i}.txt').write_text(mem.stdout+mem.stderr)
 t0=time.monotonic();c0=cpu(pid);time.sleep(10);used=cpu(pid)-c0;elapsed=time.monotonic()-t0
 row=dict(round=i,pid=pid,homeReadySeconds=ready,captures=captures,idleCpuPercent=used/elapsed*100,footprintExit=mem.returncode)
 rows.append(row);print(json.dumps(row),flush=True)
 (root/f'ios-{prefix}home-runs.json').write_text(json.dumps(dict(scenario=('process-cold, fresh app container, warm OS caches' if fresh else 'process-cold, persistent local DEMO data, warm OS caches'),readiness='pink focus CTA + quest card + island terrain + shop roof + cat portrait in first matching screenshot; includes simctl launch and capture overhead',runs=rows),indent=2))
