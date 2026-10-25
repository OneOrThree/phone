"""실제 k6/Node와 localhost HTTP/WebSocket 서버를 사용하는 장애 주입 회귀."""
import base64
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import importlib.util
import json
import os
from pathlib import Path
import signal
import socket
import struct
import subprocess
import sys
import tempfile
import threading
import time
from types import SimpleNamespace
import unittest
import uuid

SCRIPTS=Path(__file__).resolve().parents[1]/'scripts'
sys.path.insert(0,str(SCRIPTS))
spec=importlib.util.spec_from_file_location('capacity',SCRIPTS/'aws-capacity.py')
capacity=importlib.util.module_from_spec(spec)
spec.loader.exec_module(capacity)


def token(user):
    encode=lambda value:base64.urlsafe_b64encode(json.dumps(value).encode()).rstrip(b'=').decode()
    return encode({'alg':'none'})+'.'+encode({'sub':user,'type':'access','sid':'synthetic','gen':0,'exp':int(time.time())+3600})+'.synthetic'


def send_frame(connection, payload, opcode=1):
    data=payload.encode() if isinstance(payload,str) else payload
    connection.sendall(bytes([0x80|opcode])+ (bytes([len(data)]) if len(data)<126 else b'\x7e'+struct.pack('!H',len(data)))+data)


def read_frame(connection):
    def exact(count):
        value=b''
        while len(value)<count:
            chunk=connection.recv(count-len(value))
            if not chunk: raise EOFError()
            value+=chunk
        return value
    head=exact(2); length=head[1]&127
    if length==126: length=struct.unpack('!H',exact(2))[0]
    elif length==127: length=struct.unpack('!Q',exact(8))[0]
    mask=exact(4) if head[1]&128 else b'\0'*4
    payload=exact(length)
    return head[0]&15,bytes(c^mask[i%4] for i,c in enumerate(payload))

class Handler(BaseHTTPRequestHandler):
    def log_message(self,*_): pass
    def user(self):
        try:
            claim=self.headers['Authorization'].split('.')[1]
            return json.loads(base64.urlsafe_b64decode(claim+'='*(-len(claim)%4)))['sub']
        except (KeyError,ValueError,IndexError): return 'synthetic'
    def reply(self,data):
        body=json.dumps({'data':data}).encode()
        self.send_response(200);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
    def do_POST(self):
        self.rfile.read(int(self.headers.get('Content-Length',0)))
        user=self.user()
        with self.server.lock:
            if self.path=='/focus-sessions':
                self.server.focus[user]={'id':str(uuid.uuid4()),'version':0}
                result=dict(self.server.focus[user])
            elif self.path.endswith('/finish'):
                self.server.focus.pop(user,None)
                result={'recordId':str(uuid.uuid4())}
            else:
                self.server.focus[user]['version']+=1
                result=dict(self.server.focus[user])
        self.reply(result)
    def do_GET(self):
        if self.headers.get('Upgrade','').lower()!='websocket':
            with self.server.lock:
                result=self.server.focus.get(self.user()) if self.path=='/focus-sessions/current' else {'id':'synthetic'}
            self.reply(result);return
        self.server.paths.append(self.path)
        key=self.headers['Sec-WebSocket-Key']
        accept=base64.b64encode(hashlib.sha1((key+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').encode()).digest()).decode()
        self.send_response(101);self.send_header('Upgrade','websocket');self.send_header('Connection','Upgrade');self.send_header('Sec-WebSocket-Accept',accept);self.send_header('Sec-WebSocket-Protocol','v12.stomp');self.end_headers()
        self.connection.settimeout(5)
        try:
            opcode,payload=read_frame(self.connection)
            send_frame(self.connection,'CONNECTED\nversion:1.2\n\n\0')
            # 첫 구독 이후에만 종료하므로 초기 연결 실패와 구분한다.
            read_frame(self.connection)
            behavior=self.server.behavior
            if behavior in ('secret-code', 'secret-nested', 'secret-reason', 'secret-type'):
                body={'secret-code':{'code':'SECRET_PAYLOAD'},'secret-nested':{'error':{'code':'SECRET_PAYLOAD'}},'secret-reason':{'type':'MoveRejected','reason':'SECRET_PAYLOAD'},'secret-type':{'type':'SECRET_PAYLOAD'}}[behavior]
                destination='/user/queue/errors' if behavior in ('secret-code','secret-nested') else '/topic/groups/island'
                send_frame(self.connection,'MESSAGE\ndestination:'+destination+'\n\n'+json.dumps(body)+'\0')
                behavior='intentional'
            if behavior=='transport':
                self.connection.shutdown(socket.SHUT_RDWR);return
            if behavior not in ('intentional','echo','ignore-close'):
                code,reason={'early':(1001,''),'heartbeat':(1001,'HEARTBEAT_TIMEOUT'),'policy':(1008,'POLICY_VIOLATION'),'private':(1008,'user@example.com Bearer secret')}[behavior]
                send_frame(self.connection,struct.pack('!H',code)+reason.encode(),8)
            while True:
                opcode,payload=read_frame(self.connection)
                if opcode==8:
                    if behavior=='ignore-close':
                        time.sleep(5)
                        return
                    if behavior in ('intentional','echo'): send_frame(self.connection,payload,8)
                    return
                if behavior=='echo' and opcode==1 and payload.startswith(b'SEND\n'):
                    body=payload.split(b'\n\n',1)[1].rstrip(b'\0')
                    send_frame(self.connection,b'MESSAGE\ndestination:/topic/groups/island\n\n'+body+b'\0')
        except (EOFError,OSError): pass

class LocalHarnessTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
        cls.server.daemon_threads=True;cls.server.paths=[];cls.server.behavior='intentional';cls.server.focus={};cls.server.lock=threading.Lock()
        cls.thread=threading.Thread(target=cls.server.serve_forever,daemon=True);cls.thread.start()
    @classmethod
    def tearDownClass(cls): cls.server.shutdown();cls.server.server_close();cls.thread.join()

    def test_real_k6_summary_window_and_counts(self):
        with tempfile.TemporaryDirectory() as temporary:
            out=Path(temporary);users=out/'users.json';users.write_text(json.dumps([{'userId':'synthetic','token':'synthetic'}]))
            args=SimpleNamespace(url=f'http://127.0.0.1:{self.server.server_port}',users=users,pre_vus=1,max_vus=1,run_id='17e1faf5-7094-4aa6-a5be-83ac87d12345',journey_p95_limit=500,p95_limit=500,stop=capacity.StopController())
            row=capacity.stage(args,{'id':'account','kind':'api'},1,1,'account-1rps',out)
            self.assertEqual(row['verdict'],'PASS')
            self.assertGreaterEqual(row['requests'],1)
            self.assertEqual(row['startedJourneys'],row['finishedJourneys'])
            self.assertEqual(row['inflightJourneysLowerBound'],0)
            self.assertIsNotNone(row['measurementStartAt'])
            self.assertIsNotNone(row['measurementEndAt'])
            self.assertAlmostEqual(row['actualRps']*row['measuredSeconds'],row['requests'],places=5)

    def test_real_mixed_happy_path_has_measured_common_window(self):
        self.server.behavior='echo'
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary)
            users=[{'userId':f'synthetic-{i}','islandId':f'island-{i//10}','token':token(f'synthetic-{i}')} for i in range(301)]
            (root/'users.json').write_text(json.dumps(users))
            result=subprocess.run([sys.executable,str(SCRIPTS/'aws-mixed.py'),'--url',f'http://127.0.0.1:{self.server.server_port}','--ws-url',f'ws://127.0.0.1:{self.server.server_port}/ws','--users',str(root/'users.json'),'--out',str(root/'results'),'--home-rate','1','--focus-rate','1','--chat-connections','1','--chat-frequency','1','--common-seconds','2','--seconds','4','--chat-seconds','20','--runtime-seconds','45'],capture_output=True,text=True,timeout=60)
            meta=json.loads((root/'results/mixed-meta.json').read_text())
            self.assertEqual(result.returncode,0,json.dumps(meta)+result.stderr)
            self.assertEqual(meta['status'],'complete')
            self.assertTrue(meta['mixedPassed'])
            self.assertGreaterEqual(meta['commonMeasurementOverlapSeconds'],1.9)
            print(f"[MIXED PASS] 공통 목표=2s, 실제 겹침={meta['commonMeasurementOverlapSeconds']:.3f}s",flush=True)
            for component in ('home','focus'):
                rows=json.loads((root/f'results/{component}/results.json').read_text())
                self.assertEqual([row['verdict'] for row in rows],['PASS','PASS'])
            self.assertTrue(json.loads((root/'results/ws/chat.json').read_text())['sloPassed'])
            # 증거 디렉터리(결과·메타·로그·k6 진단)에 토큰·Bearer 값이 남지 않아야 한다.
            leaked=[str(f) for f in (root/'results').rglob('*') if f.is_file() and any(u['token'] in f.read_text(errors='ignore') or 'Bearer ' in f.read_text(errors='ignore') for u in users[:5]+users[300:301])]
            self.assertEqual(leaked,[])

    def test_node_close_types_over_localhost(self):
        for behavior in ('intentional','early','heartbeat','policy','transport','private','secret-code','secret-nested','secret-reason','secret-type','ignore-close'):
            with self.subTest(behavior=behavior), tempfile.TemporaryDirectory() as temporary:
                self.server.behavior=behavior
                out=Path(temporary);users=out/'users.json';users.write_text(json.dumps([{'userId':'synthetic','islandId':'island','token':token('synthetic')}]))
                result=subprocess.run(['node',str(SCRIPTS/'aws-realtime.mjs'),'--url',f'ws://127.0.0.1:{self.server.server_port}/ws','--users',str(users),'--out',str(out/'result.json'),'--connections','1','--mode','idle','--seconds','1','--ready-timeout-ms','100','--runtime-seconds','10','--drain-ms','0'],capture_output=True,text=True,timeout=8)
                data=json.loads((out/'result.json').read_text())
                self.assertEqual(data['valid'],behavior in ('intentional','secret-type'),result.stderr)
                if behavior=='ignore-close':
                    self.assertEqual(data['shutdownCloseUnconfirmed'],1)
                    self.assertFalse(data['sloPassed'])
                    self.assertNotEqual(result.returncode,0)
                    continue
                self.assertTrue(data['closeEvents'])
                event=data['closeEvents'][0]
                self.assertEqual(event['rootCause'],'UNKNOWN')
                self.assertIn('loadtestRunId='+data['runId'],self.server.paths[-1])
                self.assertIn('loadtestConnectionId='+event['connectionId'],self.server.paths[-1])
                self.assertIn('T',event['at'])
                self.assertNotIn('user@example.com',json.dumps(data))
                self.assertNotIn('SECRET_PAYLOAD',json.dumps(data)+result.stdout+result.stderr)
                if behavior=='intentional': self.assertTrue(event['duringShutdown']);self.assertEqual(event['initiator'],'CLIENT')
                if behavior=='transport': self.assertEqual(event['initiator'],'UNKNOWN')
                if behavior=='heartbeat': self.assertEqual(event['declaredCause'],'HEARTBEAT_TIMEOUT')
                if behavior=='policy': self.assertEqual(event['declaredCause'],'POLICY_CLOSE')

if __name__=='__main__': unittest.main()
