"""실제 감독자 프로세스에 신호·자식 실패를 주입한다. 자식은 원시 집계 후 결과 저장 전에 멈춘다."""
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest

SCRIPTS=Path(__file__).resolve().parents[1]/'scripts'
CHILD='''import json, os, signal, sys, time
from pathlib import Path
def cleanup_focus(*args): return {'complete':True,'failed':0}
if __name__=='__main__':
    args=dict(zip(sys.argv[1::2],sys.argv[2::2]));out=Path(args['--out']);out.mkdir(parents=True)
    cp={'runId':args['--run-id'],'key':'stage','case':args['--cases'],'kind':'journey','phase':'measurement','targetRate':1,'plannedSeconds':1,'latencyLimitMs':1000,'startedAt':'2026-01-01T00:00:00+00:00','rawFile':'stage.json'}
    (out/'stage-checkpoint.json').write_text(json.dumps(cp))
    metrics={name:{'values':{'count':count}} for name,count in {'http_reqs':2,'iterations':1,'completed_journeys':1,'started_journeys':2,'finished_journeys':1}.items()}
    (out/'stage.json').write_text(json.dumps({'state':{'testRunDurationMs':500},'metrics':metrics,'loadtest':{'measurementStartEpochMs':1767225600000,'measurementEndEpochMs':1767225600500}}))
    signal.signal(signal.SIGINT,lambda *_:sys.exit(0));signal.signal(signal.SIGTERM,lambda *_:sys.exit(0))
    if os.environ.get('TEST_CHILD_FAILURE') and out.name=='focus':
        time.sleep(.5);sys.exit(3)
    while True:time.sleep(.05)
'''

class MixedSupervisorTest(unittest.TestCase):
    def test_interrupts_and_child_failure_recover_partial_raw(self):
        for interruption in ('SIGINT','SIGTERM','CHILD_FAILURE'):
            with self.subTest(interruption=interruption),tempfile.TemporaryDirectory() as temporary:
                root=Path(temporary);scripts=root/'loadtest/scripts';scripts.mkdir(parents=True)
                (scripts/'aws-capacity.py').write_text(CHILD)
                (scripts/'aws-realtime.mjs').write_text("process.on('SIGINT',()=>process.exit(0)); setInterval(()=>{},100);\n")
                users=[{'userId':f'synthetic-{i}','islandId':f'island-{i//10}','token':'synthetic'} for i in range(301)]
                (root/'users.json').write_text(json.dumps(users))
                env={**os.environ}
                if interruption=='CHILD_FAILURE':env['TEST_CHILD_FAILURE']='1'
                process=subprocess.Popen([sys.executable,str(SCRIPTS/'aws-mixed.py'),'--root',str(root),'--url','http://127.0.0.1:1','--ws-url','ws://127.0.0.1:1/ws','--users','users.json','--out','out','--chat-connections','1','--common-seconds','1','--seconds','1','--chat-seconds','1','--runtime-seconds','20','--stop-grace-seconds','1'],env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True)
                try:
                    deadline=time.monotonic()+5
                    while not (root/'out/focus/stage.json').exists() and time.monotonic()<deadline:time.sleep(.02)
                    self.assertTrue((root/'out/focus/stage.json').exists())
                    if interruption!='CHILD_FAILURE':process.send_signal(getattr(signal,interruption))
                    process.wait(timeout=8)
                    self.assertNotEqual(process.returncode,0)
                    meta=json.loads((root/'out/mixed-meta.json').read_text())
                    self.assertEqual(meta['status'],'aborted')
                    self.assertEqual(meta['stopReason'],'focus:EXIT_FAILED' if interruption=='CHILD_FAILURE' else interruption)
                    self.assertFalse(meta['mixedPassed'])
                    self.assertIsNone(meta['commonMeasurementOverlapSeconds'])
                    for component in ('home','focus'):
                        row=json.loads((root/f'out/{component}/results.json').read_text())[0]
                        self.assertEqual(row['verdict'],'PARTIAL')
                        self.assertEqual(row['requests'],2)
                        self.assertEqual(row['inflightJourneysLowerBound'],1)
                    self.assertTrue(json.loads((root/'out/ws/chat.json').read_text())['countsUnknown'])
                finally:
                    try:os.killpg(process.pid,signal.SIGKILL)
                    except ProcessLookupError:pass
                    process.wait()
                    if (root/'out/mixed-meta.json').exists():
                        for child in json.loads((root/'out/mixed-meta.json').read_text()).get('processes',{}).values():
                            try:os.killpg(child['pid'],signal.SIGKILL)
                            except ProcessLookupError:pass

if __name__=='__main__':unittest.main()
