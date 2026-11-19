from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlsplit, parse_qs
from datetime import datetime, timezone
import json, time
from pathlib import Path
ROOT=Path('/tmp/cattus-234-fixture-evidence'); ROOT.mkdir(exist_ok=True)
USER='00000000-0000-4000-8000-000000000234'
ISLAND='00000000-0000-4000-8000-000000000013'
STATE={'epoch':0, 'expired':False, 'focus':None}
ACCOUNT={'id':USER,'name':'재현고양이','catColor':'black','mainIslandId':ISLAND,'linkedProviders':[], 'onboardingComplete':True}
ISLAND_DATA={'id':ISLAND,'name':'로컬 재현 섬','intro':'2.3.4 로컬 검사','visibility':'public','approvalRequired':False,'memberCount':1,'maxMembers':15,'membershipStatus':'active','joinRequestId':None,'growthStage':None,'themeId':None,'role':'host','version':1,'arrivedBefore':True}
LOOK={'hat':None,'clothes':None,'accessory':None,'decor':None,'version':1}
MEMBERS={'items':[{'id':USER,'name':ACCOUNT['name'],'catColor':'black','role':'host','appearance':LOOK}], 'nextCursor':None,'version':1}
BUILDINGS=['hall','board','gram','library','mail','tower','shop']
class Handler(BaseHTTPRequestHandler):
 def log_message(self,*args): pass
 def do_GET(self): self.route()
 def do_POST(self): self.route()
 def do_PUT(self): self.route()
 def do_PATCH(self): self.route()
 def do_DELETE(self): self.route()
 def route(self):
  length=int(self.headers.get('Content-Length','0'))
  if length:self.rfile.read(length)
  p=urlsplit(self.path).path
  status=200; now=datetime.now(timezone.utc).isoformat(); data=None
  if STATE['focus']:STATE['focus']['serverNow']=now
  if p=='/__focus':
   STATE['focus']={'id':'00000000-0000-4000-8000-000000000099','islandId':ISLAND,'subject':'로컬 재현','targetMinutes':30,'status':'active','activeSeconds':300,'serverNow':now,'startedAt':now,'restStartedAt':None,'version':1,'kind':'island'};data=STATE['focus']
  elif p=='/focus-sessions/current':data=STATE['focus']
  elif p.startswith('/focus-sessions/') and p.endswith('/pause'):
   STATE['focus']['status']='paused';STATE['focus']['version']+=1;STATE['focus']['restStartedAt']=now;data=STATE['focus']
  elif p.startswith('/focus-sessions/') and p.endswith('/resume'):
   STATE['focus']['status']='active';STATE['focus']['version']+=1;STATE['focus']['restStartedAt']=None;data=STATE['focus']
  elif p.endswith('/focus-members') or p.endswith('/rest-members'):
   data={'items':[],'serverNow':now,'watermarks':[]}
  elif p=='/__expire':
   STATE['expired']=True; data={'armed':True}
  elif p=='/auth/sessions/app-requirements':data={'minVersion':None,'title':None,'body':None,'publicationId':None,'publishedAt':None}
  elif p=='/auth/sessions/guest':
   status=201; data={'accessToken':f'local-{STATE["epoch"]}','refreshToken':'local-refresh','userId':USER,'onboardingComplete':True}
  elif p=='/auth/sessions/current/refresh':
   time.sleep(.35); STATE['expired']=False; STATE['epoch']+=1
   data={'accessToken':f'local-{STATE["epoch"]}','refreshToken':None}
  elif p in ['/me','/me/member-appearances'] and (STATE['expired'] or self.headers.get('Authorization')!=f'Bearer local-{STATE["epoch"]}'):
   status=401
  elif p=='/me':data=ACCOUNT
  elif p=='/me/islands':data={'items':[ISLAND_DATA], 'nextCursor':None,'currentIslandId':ISLAND,'lossReason':None}
  elif p=='/screens/home':
   data={'island':ISLAND_DATA,'focusSummary':{'date':now[:10],'completedSeconds':0,'currentSessionSecondsToday':0,'totalSeconds':0,'serverNow':now},'session':STATE['focus'],'restMembers':{'items':[],'serverNow':now,'watermarks':[]},'wallets':{'fish':500,'villagePoints':1500,'fishVersion':1,'villagePointsVersion':1},'playback':None,'playbackAvailability':'facility_locked','buildings':BUILDINGS,'members':MEMBERS}
  elif p.endswith('/construction-options'):data={'islandVersion':1,'costPolicyVersion':1,'selectedBuildingId':None,'villagePoints':1500,'walletVersion':1,'items':[]}
  elif p.endswith('/members'):data=MEMBERS
  elif p=='/me/member-appearances':data={'members':[{'userId':USER,'name':ACCOUNT['name'],'catColor':'black','appearance':LOOK}], 'hiddenUserIds':[]}
  elif p=='/me/appearance':data=LOOK
  elif p=='/me/tutorial':data={'step':22,'completed':True,'version':1}
  elif p in ['/focus-sessions/current','/focus-sessions/pending-result']:data=None
  elif p.endswith('/playback'):data=None
  elif p in ['/blocks','/me/developer-notices','/me/blocked-users','/me/join-requests','/me/subjects','/me/notifications','/me/friends']:data={'items':[],'nextCursor':None}
  else:status=404
  body={'data':data} if status<400 else {'error':{'code':'UNAUTHORIZED' if status==401 else 'RESOURCE_NOT_FOUND','message':'로컬 재현 응답','retryable':False}}
  with (ROOT/'requests.jsonl').open('a') as f:f.write(json.dumps({'time':now,'method':self.command,'path':self.path,'status':status,'epoch':STATE['epoch']},ensure_ascii=False)+'\n')
  raw=json.dumps(body,ensure_ascii=False).encode(); self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw)
ThreadingHTTPServer(('127.0.0.1',18735),Handler).serve_forever()
