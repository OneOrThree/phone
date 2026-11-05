#!/usr/bin/env python3
"""전용 계정의 운영 조회와 데이터 변경 없는 intro 경로 검증."""
import json
import os
from pathlib import Path
import stat
import urllib.request
import urllib.error
import uuid
from response_contract import check as contract

BASE='https://catus-api-v2.oneorthree.world'
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args,**kwargs):return None

def request(method,path,token):
 headers={'Authorization':'Bearer '+token,'Accept':'application/json','User-Agent':'phone-release-smoke'}
 if method=='POST':headers['Idempotency-Key']=str(uuid.uuid4())
 req=urllib.request.Request(BASE+path,method=method,headers=headers)
 try:
  response=urllib.request.build_opener(NoRedirect).open(req,timeout=15)
 except urllib.error.HTTPError as error:response=error
 except (OSError,ValueError):raise ValueError('운영 연결 실패') from None
 with response:
  status=response.code;raw=response.read(1024*1024+1)
 if len(raw)>1024*1024:raise ValueError('운영 응답 크기 초과')
 try:return status,json.loads(raw)
 except ValueError:raise ValueError('운영 JSON 응답 오류') from None

def check(env=None,send=request):
 env=os.environ if env is None else env
 try:
  p=Path(env['APP_PROD_SMOKE_FIXTURE']);mode=p.lstat().st_mode
  if not stat.S_ISREG(mode) or mode&0o077:raise ValueError('전용 계정 파일 권한은 0600이어야 합니다')
  fixture=json.loads(p.read_text())
  if fixture.get('purpose')!='phone-production-smoke':raise ValueError('전용 계정 설정 필요')
  token=fixture['access_token'];user=fixture['user_id']
  if not isinstance(token,str) or not token or any(c.isspace() for c in token):raise ValueError('인증 정보 형식 오류')
  uuid.UUID(user)
 except (OSError,KeyError,TypeError,AttributeError):raise ValueError('APP_PROD_SMOKE_FIXTURE에 전용 운영 계정 정보가 필요합니다') from None
 for path in ['/me','/me/islands','/me/telescope','/screens/home']:
  status,payload=send('GET',path,token)
  if status!=200:raise ValueError('운영 조회 실패: '+path+' HTTP '+str(status))
  contract('GET',path,payload,required=True)
  if path=='/me' and payload['data']['id']!=user:raise ValueError('테스트 계정 불일치')
 # UUID 변환에서 거절되므로 도메인 쓰기·섬 생성까지 진입하지 않는다.
 status,payload=send('POST','/islands/not-a-uuid/intro-arrivals',token)
 error=payload.get('error',{}) if isinstance(payload,dict) else {}
 if status!=400 or error.get('code')!='INVALID_PARAMETER' or error.get('field')!='islandId':
  raise ValueError('운영 intro-arrivals 경로·검증 계약 확인 실패')
 return {'checks':5,'kind':'핵심 조회 4개와 intro 경로 검증; 도착 쓰기 성공 검증은 dev에서 수행'}

if __name__=='__main__':
 try:check();print('운영 핵심 조회·경로 검사 통과')
 except (ValueError,KeyError,TypeError):
  print('운영 핵심 검사 실패 — 계정 유효성·응답·라우팅 확인 필요');raise SystemExit(1)
