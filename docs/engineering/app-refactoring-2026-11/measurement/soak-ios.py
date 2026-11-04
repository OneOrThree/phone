import subprocess,time,json,sys,re,os
from pathlib import Path
stage=sys.argv[1];root=Path(os.environ['REFACTOR_ARTIFACTS']);out=root/stage/'soak';out.mkdir(exist_ok=True)
sim=os.environ['REFACTOR_IOS_DEVICE'];app='com.oneorthree.focuscat'
def run(*cmd,check=True):return subprocess.run(cmd,capture_output=True,text=True,check=check)
def wait_until(at):
 while time.monotonic()<at:time.sleep(min(30,at-time.monotonic()))
run('xcrun','simctl','terminate',sim,app,check=False)
pid=int(run('xcrun','simctl','launch',sim,app).stdout.rsplit(':',1)[1]);time.sleep(10)
started=time.monotonic();rows=[]
def capture(label):
 if not run('ps','-p',str(pid),'-o','pid=',check=False).stdout.strip():raise SystemExit('App process exited during local observation')
 m=run('footprint',str(pid));(out/f'memory-{label}.txt').write_text(m.stdout)
 match=re.search(r'Footprint: ([\d.]+) (MB|GB|KB)',m.stdout)
 row=dict(label=label,elapsedSeconds=time.monotonic()-started,pid=pid,footprintValue=float(match[1]),footprintUnit=match[2]);rows.append(row)
 (out/'measurements.json').write_text(json.dumps(dict(scenario='same process; home-shop-home-focus-arrival-home; 10 cycles over at least 12 minutes; local DEMO only',runs=rows),indent=2))
 print(json.dumps(row),flush=True)
capture('start')
for n in range(1,11):
 wait_until(started+(n-1)*72)
 with (out/f'loop-{n}.log').open('w') as log:
  result=subprocess.run(['maestro','--udid',sim,'test','--test-output-dir',str(out/f'loop-{n}'),str(root/'warm-cycle.yaml')],stdout=log,stderr=subprocess.STDOUT)
 if result.returncode:raise SystemExit(f'Loop {n} failed; see log')
 capture(str(n))
wait_until(started+720)
capture('end')
run('xcrun','simctl','io',sim,'screenshot',str(out/'end.png'))
print('Observation complete',round(time.monotonic()-started,1),'seconds',flush=True)
