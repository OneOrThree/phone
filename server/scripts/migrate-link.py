#!/usr/bin/env python3
"""정지한 Data 스냅샷을 Link에 이관한다. 각 단계는 명시적으로 실행하고 같은 회차로 재개한다."""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request


class TransferError(RuntimeError):
    pass


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # 서비스 토큰은 지정한 origin 밖으로 전달하지 않는다. 잘못된 URL 은 바로 실패한다.
        return None


def call(base: str, path: str, token: str, body: dict | None = None) -> dict:
    request = urllib.request.Request(base.rstrip('/') + path,
        data=None if body is None else json.dumps(body, ensure_ascii=False).encode(),
        method='GET' if body is None else 'POST',
        headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
    try:
        with urllib.request.build_opener(NoRedirect()).open(request, timeout=15) as response:
            content = response.read()
            return json.loads(content) if content else {}
    except urllib.error.HTTPError as error:
        # 응답 원문에는 업무 식별자가 있을 수 있다. 운영자 로그에는 상태와 고정 코드만 남긴다.
        raise TransferError(f'{request.method} {path}: HTTP {error.code}') from error
    except (urllib.error.URLError, TimeoutError) as error:
        raise TransferError(f'{request.method} {path}: 연결 실패; 같은 회차로 재실행 가능') from error


def transfer(args: argparse.Namespace, request=call) -> dict:
    data_token = os.environ.get('BATCH_ADMIN_KEY', '')
    link_token = os.environ.get('LINK_MIGRATION_TOKEN', '')
    if not data_token or not link_token:
        raise TransferError('BATCH_ADMIN_KEY / LINK_MIGRATION_TOKEN이 필요합니다')
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,80}', args.migration_id):
        raise TransferError('migration-id는 영문·숫자·_·- 1~80자입니다')
    root = '/internal/migrations/' + args.migration_id
    clicks = root + '/invite-link-clicks'
    if args.step == 'freeze':
        if not args.source_drained:
            raise TransferError('구 landing/match/claim/발급 정지·drain 후 --source-drained를 명시하세요')
        return request(args.data_url, clicks + '/freeze', data_token, {})
    manifest = request(args.data_url, clicks + '/manifest', data_token)
    header = {key: manifest[key] for key in ('migrationId', 'expectedClicks', 'sourceChecksum',
                                           'expectedLinks', 'linkChecksum')}
    if args.step == 'import':
        if manifest.get('importClosed'):
            raise TransferError('Data IMPORT_CLOSED: import 대신 verify로 확인하세요')
        request(args.link_url, '/internal/migration/import', link_token, {**header, 'links': [], 'clicks': []})
        counts = {'links': 0, 'clicks': 0}
        for resource, path in (('links', root + '/invite-links'), ('clicks', clicks + '/clicks')):
            cursor = None
            while True:
                query = {'limit': args.batch_size}
                if cursor:
                    query['cursor'] = cursor
                page = request(args.data_url, path + '?' + urllib.parse.urlencode(query), data_token)
                entries = page['items']
                batch = {**header, 'links': [], 'clicks': [], resource: entries}
                send_batch(args.link_url, link_token, batch, resource, request)
                counts[resource] += len(entries)
                next_cursor = page.get('nextCursor')
                if next_cursor is None:
                    break
                if next_cursor == cursor or not entries:
                    raise TransferError('진행하지 않는 export 커서')
                cursor = next_cursor
        return {'imported': counts, 'migrationId': args.migration_id}
    if args.step == 'verify':
        return request(args.link_url, '/internal/migration/verify', link_token, {'migrationId': args.migration_id})
    # Link 먼저: 원자 검증 + importer drain + 닫기. 실패하면 Data를 닫지 않는다.
    result = request(args.link_url, '/internal/migration/close', link_token, {'migrationId': args.migration_id})
    request(args.data_url, clicks + '/close-import', data_token, {})
    return {**result, 'importClosed': True}


def send_batch(base: str, token: str, batch: dict, resource: str, request) -> None:
    try:
        request(base, '/internal/migration/import', token, batch)
    except TransferError as error:
        entries = batch[resource]
        # 응답 유실 뒤 이미 commit된 부분도 source checksum + marker로 안전하게 재생한다.
        if 'HTTP 503' not in str(error) or len(entries) < 2:
            raise
        middle = len(entries) // 2
        for part in (entries[:middle], entries[middle:]):
            send_batch(base, token, {**batch, resource: part}, resource, request)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('step', choices=('freeze', 'import', 'verify', 'close'))
    parser.add_argument('--data-url', required=True)
    parser.add_argument('--link-url', required=True)
    parser.add_argument('--migration-id', required=True)
    parser.add_argument('--batch-size', type=int, default=10, choices=range(1, 21), metavar='1..20')
    parser.add_argument('--source-drained', action='store_true')
    args = parser.parse_args()
    try:
        print(json.dumps(transfer(args), ensure_ascii=False))
        return 0
    except (TransferError, ValueError, KeyError) as error:
        print(str(error), file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
