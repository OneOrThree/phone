#!/usr/bin/env python3
"""release 보호 현황·차이를 기록하고 명시한 계획만 적용한다."""
import argparse
import copy
import hashlib
import json
from pathlib import Path
import subprocess

POLICY = Path(__file__).parents[1] / 'release-protection.json'
REPOSITORY = 'OneOrThree/phone'
BRANCH = 'release'
BOOL_FIELDS = ('enforce_admins', 'required_linear_history', 'allow_force_pushes', 'allow_deletions',
               'required_conversation_resolution', 'block_creations', 'lock_branch', 'allow_fork_syncing')


def actors(value):
    value = value or {}
    return {key: [item if isinstance(item, str) else item['login' if key == 'users' else 'slug']
                  for item in value.get(key, [])] for key in ('users', 'teams', 'apps')}


def normalized(protection):
    if protection is None:
        return None
    result = {}
    for key in BOOL_FIELDS:
        value = protection.get(key, False)
        result[key] = value.get('enabled', False) if isinstance(value, dict) else value
    checks = protection.get('required_status_checks')
    result['required_status_checks'] = ({'strict': checks.get('strict', False),
        'contexts': checks.get('contexts', []),
        'checks': [{key: check[key] for key in ('context', 'app_id') if key in check and check[key] is not None}
                   for check in checks.get('checks', [])]} if checks else None)
    reviews = protection.get('required_pull_request_reviews')
    result['required_pull_request_reviews'] = None
    if reviews is not None:
        result['required_pull_request_reviews'] = {
            key: reviews.get(key, False if key != 'required_approving_review_count' else 0)
            for key in ('dismiss_stale_reviews', 'require_code_owner_reviews',
                        'required_approving_review_count', 'require_last_push_approval')}
        for key in ('dismissal_restrictions', 'bypass_pull_request_allowances'):
            if key in reviews:
                result['required_pull_request_reviews'][key] = actors(reviews[key])
    restrictions = protection.get('restrictions')
    result['restrictions'] = actors(restrictions) if restrictions is not None else None
    return result


def desired(snapshot, policy):
    if (policy.get('repository'), policy.get('branch')) != (REPOSITORY, BRANCH):
        raise ValueError('이 정책은 OneOrThree/phone의 release 전용이다')
    if (snapshot.get('repository'), snapshot.get('branch')) != (REPOSITORY, BRANCH):
        raise ValueError('조회한 저장소·브랜치가 정책 대상과 다르다')
    if not snapshot.get('allow_merge_commit'):
        raise ValueError('main 부모를 보존하려면 저장소의 merge commit 허용이 필요하다')
    result = normalized(snapshot.get('protection')) or normalized({})
    changes = copy.deepcopy(policy['protection'])
    reviews = result['required_pull_request_reviews'] or {}
    review_changes = changes.pop('required_pull_request_reviews')
    review_changes['required_approving_review_count'] = max(
        reviews.get('required_approving_review_count', 0), review_changes['required_approving_review_count'])
    result.update(changes)
    result['required_pull_request_reviews'] = {**reviews, **review_changes}
    # 기존 required checks·push 제한·코드오너/마지막 push 승인 조건은 유지한다.
    return result


def fingerprint(snapshot):
    return hashlib.sha256(json.dumps(snapshot, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


class GitHub:
    def request(self, path, method='GET', payload=None, missing_ok=False):
        command = ['gh', 'api', 'repos/' + REPOSITORY + path, '--method', method,
                   '-H', 'Accept: application/vnd.github+json', '-H', 'X-GitHub-Api-Version: 2022-11-28']
        if payload is not None:
            command += ['--input', '-']
        result = subprocess.run(command, input=json.dumps(payload) if payload is not None else None,
                                capture_output=True, text=True)
        if result.returncode:
            try:
                status = str(json.loads(result.stdout).get('status'))
            except (ValueError, AttributeError):
                status = ''
            if missing_ok and status == '404':
                return None
            raise RuntimeError('GitHub API 조회·적용 실패: ' + result.stderr.strip())
        return json.loads(result.stdout) if result.stdout.strip() else None


def capture(api):
    repository = api.request('')
    api.request('/branches/' + BRANCH)  # 없는 브랜치의 404를 미보호로 오인하지 않는다.
    protection = api.request('/branches/' + BRANCH + '/protection', missing_ok=True)
    rules = api.request('/rules/branches/' + BRANCH)
    return {'repository': REPOSITORY, 'branch': BRANCH, 'allow_merge_commit': repository['allow_merge_commit'],
            'protection': protection, 'rules': rules}


def make_plan(snapshot, policy):
    return {'before': snapshot, 'before_sha256': fingerprint(snapshot), 'policy': policy,
            'payload': desired(snapshot, policy)}


def apply_plan(plan, api):
    if plan.get('before_sha256') != fingerprint(plan['before']):
        raise ValueError('계획의 변경 전 스냅샷 checksum 불일치')
    if plan.get('payload') != desired(plan['before'], plan['policy']):
        raise ValueError('계획의 정책과 적용 payload 불일치')
    current = capture(api)
    if fingerprint(current) != plan['before_sha256']:
        raise ValueError('계획 생성 후 GitHub 설정이 변경됨 — 새 계획 필요')
    if current['rules']:
        raise ValueError('적용 중인 ruleset이 있음 — 통합 정책 검토 후 별도 적용 필요')
    api.request('/branches/' + BRANCH + '/protection', 'PUT', plan['payload'])
    after = capture(api)
    if normalized(after['protection']) != normalized(plan['payload']):
        raise RuntimeError('보호 설정 재조회 결과가 계획과 다름 — 현재 설정을 확인할 것')
    return after


def main():
    parser = argparse.ArgumentParser(description='release 보호 정책 점검·계획. 실제 변경은 --apply에서만 수행한다.')
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--snapshot', type=Path, help='로컬 스냅샷으로 오프라인 계획 생성')
    mode.add_argument('--apply', type=Path, help='검토한 계획 JSON을 실제 GitHub에 적용')
    parser.add_argument('--output', type=Path, required=True, help='계획 또는 적용 결과 JSON 저장 위치')
    args = parser.parse_args()
    policy = json.loads(POLICY.read_text())
    api = GitHub()
    if args.apply:
        plan = json.loads(args.apply.read_text())
        if plan.get('policy') != policy:
            raise ValueError('검토한 계획과 현재 저장소 정책이 다름')
        result = apply_plan(plan, api)
    else:
        snapshot = json.loads(args.snapshot.read_text()) if args.snapshot else capture(api)
        result = make_plan(snapshot, policy)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print('적용 결과 저장' if args.apply else '계획 저장 (GitHub 설정 변경 없음)')


if __name__ == '__main__':
    main()
