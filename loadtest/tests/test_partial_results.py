"""부하 발생기 신호 중단 회귀: 임시 k6 자식은 종료 때 집계만 반환한다."""
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest

SCRIPTS = Path(__file__).resolve().parents[1] / 'scripts'
SHIM = '''#!/usr/bin/env python3
import json, os, signal, time
from pathlib import Path
start=time.time()
Path(os.environ['TEST_READY']).write_text('ready')
def stop(*_):
    d=(time.time()-start)*1000
    vals={'http_reqs':{'count':2},'iterations':{'count':1},'completed_journeys':{'count':1},'started_journeys':{'count':2},'finished_journeys':{'count':1},'http_req_failed':{'rate':0},'api_errors':{'rate':0},'http_req_duration':{'p(95)':1},'iteration_duration':{'p(95)':1}}
    Path(os.environ['SUMMARY_PATH']).write_text(json.dumps({'state':{'testRunDurationMs':d},'metrics':{k:{'values':v} for k,v in vals.items()},'loadtest':{'runId':os.environ.get('RUN_ID'),'measurementStartEpochMs':start*1000,'measurementEndEpochMs':time.time()*1000}}))
    raise SystemExit(0)
signal.signal(signal.SIGINT,stop)
signal.signal(signal.SIGTERM,stop)
while True: time.sleep(.02)
'''

class PartialResultsTest(unittest.TestCase):
    def test_signals_preserve_active_stage(self):
        for sig in (signal.SIGINT, signal.SIGTERM):
            with self.subTest(signal=sig.name), tempfile.TemporaryDirectory() as temporary:
                root=Path(temporary)
                (root/'k6').write_text(SHIM)
                (root/'k6').chmod(0o700)
                (root/'users.json').write_text(json.dumps([{'userId':'synthetic-user','token':'synthetic-token'}]))
                ready=root/'ready'
                process=subprocess.Popen([sys.executable,str(SCRIPTS/'aws-capacity.py'),'--url','http://127.0.0.1:1','--users',str(root/'users.json'),'--out',str(root/'out'),'--cases','account','--rates','1'],env={**os.environ,'PATH':str(root)+os.pathsep+os.environ['PATH'],'TEST_READY':str(ready)},stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True)
                try:
                    deadline=time.monotonic()+5
                    while not ready.exists() and time.monotonic()<deadline: time.sleep(.02)
                    self.assertTrue(ready.exists())
                    process.send_signal(sig)
                    process.wait(timeout=5)
                    rows=json.loads((root/'out/results.json').read_text())
                    self.assertEqual(len(rows),1,'중단 중 실행된 단계가 사라지면 안 된다')
                    self.assertEqual(rows[0]['verdict'],'PARTIAL')
                    self.assertEqual(rows[0]['stopReason'],sig.name)
                    self.assertEqual(rows[0]['requests'],2)
                    self.assertEqual(rows[0]['inflightJourneysLowerBound'],1)
                    self.assertFalse(rows[0]['inflightOutcomeKnown'])
                    self.assertGreater(rows[0]['actualRps'],0)
                finally:
                    try: os.killpg(process.pid,signal.SIGKILL)
                    except ProcessLookupError: pass
                    process.wait()

if __name__=='__main__': unittest.main()

sys.path.insert(0,str(SCRIPTS))
from loadtest_evidence import atomic_json, measurement_windows, recover_http, assess_common_window, normalize_stage

class RecoveryTest(unittest.TestCase):
    def test_forced_child_exit_without_summary_is_unknown(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory=Path(temporary)
            checkpoint={'runId':'run','key':'account-1rps','case':'account','kind':'api','phase':'measurement',
                        'targetRate':1,'plannedSeconds':10,'latencyLimitMs':500,'startedAt':'2026-01-01T00:00:00+00:00','rawFile':'account-1rps.json'}
            atomic_json(directory/'account-1rps-checkpoint.json',checkpoint)
            rows=recover_http(directory,'focus:EXIT_FAILED')
            self.assertEqual(rows[0]['verdict'],'PARTIAL')
            for key in ('requests','completedJourneys','actualRps','inflightJourneysLowerBound','httpErrorRate'):
                self.assertIsNone(rows[0][key],key)
            self.assertFalse(rows[0]['inflightOutcomeKnown'])
            self.assertEqual(recover_http(directory,'SIGKILL'),rows)
            self.assertFalse(list(directory.glob('*.tmp')))

    def test_common_window_does_not_redivide_full_counts(self):
        row={'phase':'measurement','measurementStartAt':'2026-01-01T00:00:00+00:00','measurementEndAt':'2026-01-01T00:00:10+00:00','measuredSeconds':10,'requests':20,'actualRps':2,'completedTps':1,'verdict':'PARTIAL'}
        other={**row,'measurementStartAt':'2026-01-01T00:00:05+00:00','measurementEndAt':'2026-01-01T00:00:15+00:00'}
        epoch=1767225600000
        result=measurement_windows({'home':[row],'focus':[other]}, {'eventWindowStart':epoch+2000,'eventWindowEnd':epoch+12000,'measurementMs':10000})
        self.assertEqual(result['commonMeasurementOverlapSeconds'],5)
        self.assertEqual(result['measurementWindows'][0]['actualRps'],2)
        self.assertIsNone(result['commonWindowThroughput'])
        self.assertIsNone(measurement_windows({'home':[],'focus':[other]}, {})['commonMeasurementOverlapSeconds'])


class VerdictTest(unittest.TestCase):
    def test_component_pass_cannot_hide_short_common_window(self):
        for overlap in (None, 0, 119):
            result=assess_common_window(overlap,120,True)
            self.assertFalse(result['mixedPassed'])
            self.assertEqual(result['commonWindowVerdict'],'INCOMPLETE_WINDOW')
        self.assertTrue(assess_common_window(119.99,120,True)['mixedPassed'])
        self.assertFalse(assess_common_window(120,120,False)['mixedPassed'])

    def test_missing_journey_counters_never_pass(self):
        checkpoint={'kind':'api','phase':'measurement','latencyLimitMs':500,'plannedSeconds':1,'targetRate':1}
        raw={'state':{'testRunDurationMs':1000},'metrics':{name:{'values':value} for name,value in {'http_reqs':{'count':1},'iterations':{'count':1},'http_req_failed':{'rate':0},'api_errors':{'rate':0},'http_req_duration':{'p(95)':10}}.items()}}
        row=normalize_stage(checkpoint,raw,{'exitCode':0})
        self.assertEqual(row['verdict'],'INVALID')
        self.assertIsNone(row['inflightJourneysLowerBound'])
        self.assertFalse(row['inflightOutcomeKnown'])


class CounterConsistencyTest(unittest.TestCase):
    def test_unfinished_or_impossible_counters_never_pass(self):
        checkpoint={'kind':'api','phase':'measurement','latencyLimitMs':500,'plannedSeconds':1,'targetRate':1}
        for started,finished,completed in ((2,1,1),(1,2,1),(1,1,2)):
            with self.subTest(started=started,finished=finished,completed=completed):
                values={'http_reqs':{'count':2},'iterations':{'count':1},'http_req_failed':{'rate':0},'api_errors':{'rate':0},'http_req_duration':{'p(95)':10},'started_journeys':{'count':started},'finished_journeys':{'count':finished},'completed_journeys':{'count':completed}}
                raw={'state':{'testRunDurationMs':1000},'metrics':{key:{'values':value} for key,value in values.items()}}
                row=normalize_stage(checkpoint,raw,{'exitCode':0})
                self.assertNotEqual(row['verdict'],'PASS')
                self.assertFalse(row['inflightOutcomeKnown'])
