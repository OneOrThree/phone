import subprocess,time,json,sys,re,os
from pathlib import Path
from PIL import Image
fresh=len(sys.argv)>2 and sys.argv[2]=='fresh';prefix='fresh-' if fresh else ''
stage=sys.argv[1];root=Path(os.environ['REFACTOR_ARTIFACTS'])/stage;root.mkdir(exist_ok=True)
adb=os.environ.get('ADB', 'adb');device=os.environ['REFACTOR_ANDROID_DEVICE'];app='com.oneorthree.gromo'
def run(*args,check=True):return subprocess.run([adb,'-s',device,*args],capture_output=True,check=check)
def shell(*args):return run('shell',*args).stdout.decode().strip()
def cpu(pid):
 fields=shell('cat',f'/proc/{pid}/stat').rsplit(')',1)[1].split()
 return (int(fields[11])+int(fields[12]))/100
rows=[]
for i in range(1,6):
 shell('am','force-stop',app)
 if fresh:
  run('uninstall',app,check=False)
  run('install',str(root/'app-release.apk'))
 started=time.monotonic();launch=shell('am','start','-W','-n',app+'/.MainActivity');shot=root/f'android-{prefix}home-{i}.png';captures=0;ready=None
 while time.monotonic()-started<25:
  shot.write_bytes(run('exec-out','screencap','-p').stdout);captures+=1
  im=Image.open(shot).convert('RGB').resize((201,437))
  pink=sum(r>210 and 90<g<190 and 140<b<230 for r,g,b in im.crop((145,370,190,415)).getdata())
  paper=sum(r>225 and g>215 and b>205 for r,g,b in im.crop((20,65,80,90)).getdata())
  land=sum(r>120 and g>105 and b<r-20 and g>b+15 for r,g,b in im.crop((70,120,150,230)).getdata())
  roof=sum(60<r<155 and 100<g<190 and 110<b<200 and b>r+10 for r,g,b in im.crop((75,275,140,315)).getdata())
  cat=sum(r<110 and g<110 and b<110 for r,g,b in im.crop((16,40,30,55)).getdata())
  if pink>450 and paper>300 and land>2000 and roof>70 and cat>20:ready=time.monotonic()-started;break
 if ready is None:raise SystemExit('Home ready timeout')
 time.sleep(5);pid=int(shell('pidof',app));mem=shell('dumpsys','meminfo',str(pid));(root/f'android-{prefix}memory-{i}.txt').write_text(mem)
 t0=time.monotonic();c0=cpu(pid);time.sleep(10);used=cpu(pid)-c0;elapsed=time.monotonic()-t0
 row=dict(round=i,pid=pid,homeReadySeconds=ready,captures=captures,idleCpuPercent=used/elapsed*100,amStart=launch)
 rows.append(row);print(json.dumps(row),flush=True)
 (root/f'android-{prefix}home-runs.json').write_text(json.dumps(dict(scenario=('process-cold, fresh app container, warm OS caches; API 37 arm64 emulator' if fresh else 'process-cold, persistent local DEMO data, warm OS caches; API 37 arm64 emulator'),readiness='pink focus CTA + quest card + island terrain + shop roof + cat portrait in first matching screenshot; includes adb launch and capture overhead',runs=rows),indent=2))
