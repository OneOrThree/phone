import subprocess,time,json,os
from pathlib import Path
root=Path(os.environ['REFACTOR_ARTIFACTS']);adb=os.environ.get('ADB','adb');device=os.environ['REFACTOR_ANDROID_DEVICE'];app='com.oneorthree.gromo'
def run(*args,check=True):return subprocess.run([adb,'-s',device,*args],capture_output=True,text=True,check=check)
def threads(pid):
 result={}
 for line in run('shell',f'cat /proc/{pid}/task/*/stat').stdout.splitlines():
  try:
   tid,name=line.split(' (',1);name,fields=name.rsplit(')',1);parts=fields.split();result[tid]=(name,(int(parts[11])+int(parts[12]))/100)
  except (ValueError,IndexError):pass
 return result
rows=[]
for stage in ['baseline','after']:
 run('uninstall',app,check=False);run('install',str(root/stage/'app-release.apk'));run('shell','am','start','-W','-n',app+'/.MainActivity');time.sleep(20)
 pid=int(run('shell','pidof',app).stdout);before=threads(pid);started=time.monotonic();samples=[]
 for n in range(6):
  time.sleep(10);now=threads(pid);elapsed=time.monotonic()-started
  used=sum(v[1]-before.get(k,(v[0],0))[1] for k,v in now.items());samples.append(dict(elapsedSeconds=elapsed,cpuPercent=used/elapsed*100))
 end=threads(pid);elapsed=time.monotonic()-started;byThread=[dict(name=v[0],cpuPercent=(v[1]-before.get(k,(v[0],0))[1])/elapsed*100) for k,v in end.items()]
 row=dict(stage=stage,pid=pid,elapsedSeconds=elapsed,samples=samples,threads=sorted(byThread,key=lambda v:v['cpuPercent'],reverse=True)[:10]);rows.append(row);print(json.dumps(row),flush=True)
 (root/'cpu-android-long.json').write_text(json.dumps(dict(method='fresh install, 20 seconds settle, 60 seconds home idle; CLK_TCK=100; sum of surviving thread CPU deltas; one run per version',runs=rows),indent=2))
