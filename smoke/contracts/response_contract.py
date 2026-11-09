#!/usr/bin/env python3
"""핵심 사용자 흐름의 성공 응답을 공용 계약으로 검증한다."""
import json
from pathlib import Path
import re
import sys

TEXT='string'; NUMBER='number'; BOOL='boolean'
ACCOUNT={'id':TEXT,'name':(TEXT,'null'),'catColor':(TEXT,'null'),'mainIslandId':(TEXT,'null')}
ARRIVAL={'islandId':TEXT,'arrivedBefore':BOOL,'membershipStatus':TEXT,'currentIslandId':(TEXT,'null')}
CONTRACTS={
 'GET /me':ACCOUNT,
 'GET /me/islands':{'items':[{'id':TEXT}],'currentIslandId':(TEXT,'null')},
 'GET /me/telescope':{'items':[{'islandId':TEXT,'slot':TEXT}]},
 'GET /screens/home':{'buildings':[],'members':{'items':[]},'wallets':{'fish':NUMBER,'villagePoints':NUMBER}},
 'POST /islands/{}/intro-arrivals':ARRIVAL,
 'POST /focus-sessions':{'id':TEXT,'islandId':TEXT,'status':TEXT,'version':NUMBER},
 'GET /focus-sessions/current':({'id':TEXT,'status':TEXT,'version':NUMBER},'null'),
 'POST /focus-sessions/{}/finish':{'recordId':TEXT,'activeSeconds':NUMBER,'earnedFish':NUMBER,
                                 'allocation':{'personalFishAdded':NUMBER,'constructionFishAdded':NUMBER}},
}


def validate(value, schema):
    if isinstance(schema,tuple):
        for choice in schema:
            try: validate(value,choice);return
            except ValueError: pass
        raise ValueError('응답 타입 불일치')
    if isinstance(schema,dict):
        if not isinstance(value,dict) or any(k not in value for k in schema):raise ValueError('필수 응답 필드 누락')
        for key, child in schema.items():validate(value[key],child)
    elif isinstance(schema,list):
        if not isinstance(value,list):raise ValueError('배열 응답 불일치')
        if schema:
            for child in value:validate(child,schema[0])
    elif not {'string':isinstance(value,str),'number':type(value) in (int,float),
              'boolean':type(value) is bool,'null':value is None}[schema]:
        raise ValueError('응답 타입 불일치')


def key(method,path):
    return method+' '+re.sub(r'/[0-9a-fA-F-]{36}(?=/|$)','/{}',path.split('?')[0])


def check(method,path,payload,required=False):
    schema=CONTRACTS.get(key(method,path))
    if schema is None:
        if required:raise ValueError('등록되지 않은 응답 계약')
        return False
    if not isinstance(payload,dict) or 'data' not in payload or payload.get('error') is not None:
        raise ValueError('성공 응답 봉투 불일치')
    validate(payload['data'],schema)
    return True


if __name__=='__main__':
    try:check(sys.argv[1],sys.argv[2],json.loads(Path(sys.argv[3]).read_text()))
    except (ValueError,OSError,IndexError):
        print('응답 계약 검사 실패 (응답 원문 생략)',file=sys.stderr);sys.exit(1)
