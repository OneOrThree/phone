#!/usr/bin/env python3
"""GitHub의 특정 dev 실행 근거와 현재 운영 서비스 소스를 대조한다."""
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile

REPO='OneOrThree/phone'
SERVICES={'data-api','business-api','realtime','notification'}


def command(args):
    try:return subprocess.run(args,check=True,capture_output=True,text=True,timeout=120).stdout
    except (OSError,subprocess.SubprocessError):raise ValueError('배포 검증 근거 조회 실패 (원문 생략)') from None


def verify(evidence,production,app_tree,run):
    if (evidence.get('environment')!='dev' or evidence.get('appTree')!=app_tree or
        evidence.get('appRevision')!=run.get('head_sha') or
        run.get('status')!='completed' or run.get('conclusion')!='success' or run.get('head_branch')!='main' or
        run.get('path') not in ('.github/workflows/ops-smoke.dev-v2.yml','.github/workflows/cd-auto.dev-v2.yml')):
        raise ValueError('앱 소스와 성공한 dev 실행 근거가 일치하지 않습니다')
    if (production.get('status')!='Success' or set(production.get('service_revisions',{}))!=SERVICES or
        set(evidence.get('services',{}))!=SERVICES):raise ValueError('운영 서비스 배포 근거 누락')
    for name in SERVICES:
        revision=evidence['services'][name].get('revision','')
        if not re.fullmatch('[0-9a-f]{40}',revision) or production['service_revisions'][name]!=revision:
            raise ValueError('검증한 dev 서버와 운영 서비스 소스 버전이 다릅니다: '+name)


def check(env=None,execute=command):
    env=os.environ if env is None else env
    run_id=env.get('APP_COMPATIBILITY_RUN_ID','')
    if not re.fullmatch('[1-9][0-9]*',run_id):raise ValueError('성공한 dev 실행의 APP_COMPATIBILITY_RUN_ID가 필요합니다')
    run=json.loads(execute(['gh','api',f'repos/{REPO}/actions/runs/{run_id}']))
    production=json.loads(execute(['gh','api',f'repos/{REPO}/contents/prod-V2/app-proof.json?ref=deployment-status','-H','Accept: application/vnd.github.raw+json']))
    latest=json.loads(execute(['gh','api',f'repos/{REPO}/actions/workflows/prod-cd-V2.yml/runs?branch=release&per_page=1']))['workflow_runs'][0]
    def assert_current(value):
        if (value.get('status')!='completed' or value.get('conclusion')!='success' or
            production.get('run_url')!=f'https://github.com/{REPO}/actions/runs/{value.get("id")}' or
            production.get('run_attempt')!=value.get('run_attempt')):raise ValueError('운영 배포 기록과 최신 CD 실행 불일치')
    assert_current(latest)
    app_tree=execute(['git','rev-parse','HEAD:app/app-dev']).strip()
    with tempfile.TemporaryDirectory(prefix='phone-compat-') as d:
        execute(['gh','run','download',run_id,'--repo',REPO,'--name','smoke-results','--dir',d])
        evidence=json.loads((Path(d)/'compatibility-dev.json').read_text())
    verify(evidence,production,app_tree,run)
    after=json.loads(execute(['gh','api',f'repos/{REPO}/actions/workflows/prod-cd-V2.yml/runs?branch=release&per_page=1']))['workflow_runs'][0]
    assert_current(after)
    return production


if __name__=='__main__':
    try:check();print('앱·운영 서버 버전 검증 통과')
    except (ValueError,KeyError,IndexError,OSError,TypeError):
        print('앱·운영 서버 버전 검증 실패 — dev 실행·배포 기록을 확인하세요');raise SystemExit(1)
