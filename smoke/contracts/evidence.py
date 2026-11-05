#!/usr/bin/env python3
"""전체 dev smoke 성공을 앱 소스·실제 서비스 이미지에 연결한다. 운영 출시 승인은 아니다."""
import argparse
import csv
import hashlib
import json
from pathlib import Path
import re

EXPECTED = {f'SMOKE-SERVER-{n:03}' for n in [*range(1, 11), *range(14, 20)]}
SERVICES = {'data-api', 'business-api', 'realtime', 'notification'}


def build(directory, inventory, revision):
    if not re.fullmatch('[0-9a-f]{40}', revision):
        raise ValueError('앱 소스 SHA 오류')
    targets = json.loads((directory/'targets.json').read_text())
    if targets.get('state') != 'matched' or set(targets.get('services', {})) != SERVICES:
        raise ValueError('검증된 dev 대상 4개가 필요합니다')
    for service in targets['services'].values():
        if (not re.fullmatch('[0-9a-f]{40}', service.get('revision', '')) or
                not re.fullmatch('sha256:[0-9a-f]{64}', service.get('image_id', ''))):
            raise ValueError('실제 서버 소스 SHA·image ID 근거 누락')
    if not re.fullmatch('[0-9a-f]{64}', inventory.get('sourceDigest', '')):
        raise ValueError('API 입력 소스 해시 누락')
    if (inventory.get('unresolved') or inventory.get('unsupportedServer') or inventory.get('unreviewedFetches') or
            not inventory.get('endpoints') or any(not e.get('server') for e in inventory['endpoints'])):
        raise ValueError('API 목록 해석·서버 경로 대조 실패')
    rows=[]
    results=[]
    for file in sorted(directory.rglob('results.tsv')):
        results.append({'file':str(file.relative_to(directory)), 'sha256':hashlib.sha256(file.read_bytes()).hexdigest()})
        with file.open() as stream:
            rows.extend(csv.DictReader(stream, delimiter='\t'))
    seen = {row.get('id') for row in rows if row.get('status') == 'PASS'}
    if EXPECTED - seen or any(row.get('status') != 'PASS' for row in rows):
        raise ValueError('전체 dev 시나리오 성공이 아닙니다')
    return {'schemaVersion':1,'environment':'dev','appRevision':revision,
            'sourceDigest':inventory['sourceDigest'],'services':targets['services'],
            'passedCases':sorted(EXPECTED),'results':results,
            'scope':'등록된 dev 시나리오와 서버 경로 대조; 운영 호환성 승인이 아님'}


if __name__ == '__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--results',type=Path,required=True)
    parser.add_argument('--inventory',type=Path,required=True)
    parser.add_argument('--revision',required=True)
    args=parser.parse_args()
    evidence=build(args.results,json.loads(args.inventory.read_text()),args.revision)
    (args.results/'compatibility-dev.json').write_text(json.dumps(evidence,indent=2)+'\n')
