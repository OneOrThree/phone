#!/usr/bin/env python3
"""출시 오류 모니터 정의·원격 검증·멱등 적용. 기본은 로컬 계획 출력."""
import argparse
import json
import os
import re
import urllib.request

TAG='managed-by:phone-release-safety'

def definitions(recipient):
 if not recipient or not re.fullmatch(r'@[A-Za-z0-9_.@+\-]+',recipient):raise ValueError('DD_RELEASE_ALERT_RECIPIENT에 실제 알림 수신처가 필요합니다')
 monitors=[]
 for code,filter_,threshold in [('404','404',4),('5xx','[500 TO 599]',4)]:
  for grouped in (False,True):
   group='.by("@app_version,@http_route")' if grouped else ''
   scope='앱 버전·API별' if grouped else '전체 요청'
   monitors.append({'name':f'[운영] 앱 API {code} 오류 증가 — {scope}','type':'log alert',
    'query':f'logs("env:prod service:business-api @event:business_request @status_code:{filter_}").index("*").rollup("count"){group}.last("5m") > {threshold}',
    'message':f'5분간 오류 5건 이상. 운영 배포·새 앱 버전·라우팅을 확인하세요. 404는 의도된 리소스 부재와 API 누락을 구분하세요. {recipient}',
    'tags':[TAG,'env:prod','scope:release-safety',f'error-kind:{code}',f'grouping:{"version-route" if grouped else "all"}'],
    'options':{'thresholds':{'critical':threshold},'notify_no_data':False,'include_tags':True,'enable_logs_sample':False}})
 return monitors


def api(method,path,body=None):
 site=os.environ.get('DD_SITE','us5.datadoghq.com')
 if site not in {'datadoghq.com','us3.datadoghq.com','us5.datadoghq.com','datadoghq.eu','ap1.datadoghq.com','ap2.datadoghq.com'}:raise ValueError('DD_SITE 오류')
 req=urllib.request.Request('https://api.'+site+'/api/v1/'+path,method=method,
  headers={'DD-API-KEY':os.environ['DD_API_KEY'],'DD-APPLICATION-KEY':os.environ['DD_APP_KEY'],'Content-Type':'application/json'},
  data=json.dumps(body).encode() if body is not None else None)
 with urllib.request.urlopen(req,timeout=20) as response:return json.load(response)


def apply(monitors,call=api):
 existing=call('GET','monitor?monitor_tags='+TAG)
 for desired in monitors:
  matches=[m for m in existing if TAG in m.get('tags',[]) and m.get('name')==desired['name']]
  if len(matches)>1:raise ValueError('관리 모니터 중복 — 수동 확인 필요')
  call('POST','monitor/validate',desired)
  call('PUT' if matches else 'POST','monitor/'+str(matches[0]['id']) if matches else 'monitor',desired)


if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--execute',action='store_true');args=parser.parse_args()
 try:
  monitors=definitions(os.environ.get('DD_RELEASE_ALERT_RECIPIENT',''))
  if args.execute:apply(monitors);print('출시 오류 모니터 4개 적용 완료')
  else:print(json.dumps(monitors,ensure_ascii=False,indent=2))
 except Exception:
  print('모니터 처리 실패 — 수신처·키·원격 검증·로그 필드 설정 확인 필요 (자격·응답 원문 생략)');raise SystemExit(1)
