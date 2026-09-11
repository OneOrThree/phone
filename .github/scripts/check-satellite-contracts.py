#!/usr/bin/env python3
"""A22 경계의 정적 회귀 검사. 실행·경합 보장은 각 서비스의 실제 DB/Kafka 테스트가 검증한다."""
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[2]
errors = []


def source(path):
    return (ROOT / path).read_text()


def require(condition, message):
    if not condition:
        errors.append(message)


noti = ROOT / 'server/notification/src/main/java'
for path in noti.rglob('*.java'):
    text = path.read_text()
    require(not re.search(r'import com\.oneorthree\.phone\.', text),
            f'{path.relative_to(ROOT)}: 알림이 Data 코드에 직접 의존함')
    require(not re.search(r'import (jakarta\.persistence|io\.jsonwebtoken)\.', text),
            f'{path.relative_to(ROOT)}: 알림 서비스에 core ORM/JWT 경계가 유입됨')

kinds = source('server/data-api/src/main/java/com/oneorthree/phone/notification/producer/NotificationKind.java')
producer = set(re.findall(r'^\s+([A-Z][A-Z0-9_]+)\(NotificationSlotGranularity\.', kinds, re.M))
seed = source('server/notification/src/main/resources/db/migration/V2__notification_catalog.sql')
consumers = set(re.findall(r"INSERT INTO kinds\([^\n]+VALUES\('([^']+)'", seed))
bundles = {'BET_RESULT_BUNDLE', 'BET_VOID_REFUND_BUNDLE', 'BET_MIXED_BUNDLE', 'CHALLENGE_SESSION_OPEN_BUNDLE'}
require(bool(producer) and consumers == producer | bundles,
        f'producer/consumer kind 불일치: 수신 누락={producer-consumers}, 미정의={consumers-producer-bundles}')
for kind in consumers:
    for locale in ['ko', 'en', 'ja', 'zh-Hant']:
        require(f"'{kind}.{locale}','{kind}','{locale}'" in seed,
                f'{kind}/{locale}: 템플릿 시드 없음')

kafka = source('server/notification/src/main/java/com/oneorthree/notification/KafkaInbound.java')
require('record.topic() + ".DLT"' in kafka and 'setFailIfSendResultIsError(true)' in kafka,
        'A22 ㋱: 명시 .DLT destination 또는 DLT 실패 offset 보존 설정 없음')
relay_files = list((ROOT / 'server/data-api/src/main/java').rglob('HttpOutboxTransport.java'))
require(len(relay_files) == 1, 'HTTP outbox transport 경계 누락/중복')
if relay_files:
    relay = relay_files[0].read_text()
    require('Bearer ' in relay and 'X-Service-Token' not in relay,
            'HTTP outbox 인증이 위성의 Bearer 계약과 다름')

profile = source('server/data-api/src/main/resources/application-satellites.yml')
require('${NOTIFICATION_DISPATCH_MODE:LEGACY}' in profile, '구 FCM 컷오버 스위치 기본값이 LEGACY가 아님')
require('${OUTBOX_RELAY_ENABLED:false}' in profile, 'A18 미확정 상태에서 relay가 자동으로 켜짐')
for path in (ROOT / 'server/notification/src/main/resources').glob('application-*.yml'):
    require('API_DB_' not in path.read_text(), f'{path.relative_to(ROOT)}: 알림이 core DB 자격을 받음')

migration_records = source('server/data-api/src/main/java/com/oneorthree/phone/notification/migration/NotificationMigrationRecord.java')
export_resources = set(re.findall(r'RESOURCE_[A-Z]+ = "([a-z]+)"', migration_records))
noti_records = source('server/notification/src/main/java/com/oneorthree/notification/MigrationRecords.java')
resource_list = re.search(r'RESOURCES = List.of\(([^;]+)\);', noti_records)
import_resources = set(re.findall(r'"([a-z]+)"', resource_list.group(1))) if resource_list else set()
require(export_resources == import_resources == {'settings', 'device', 'delivery', 'user', 'participation'},
        'A22 ㋶: Data export와 Noti import의 다섯 이관 자원이 다름')
probe = source('.github/scripts/check-migration-checksum.py')
require('MigrationRecords.canonical(' in probe and 'NotificationMigrationRecord.of(' in probe,
        'A22 ㋳: 체크섬 검사가 실제 export/import 정규화 함수를 통과하지 않음')
frozen = source('server/data-api/src/main/java/com/oneorthree/phone/internal/service/InternalClickMigrationService.java')
for field in ['groupNameVersion', 'inviterNameVersion']:
    require(frozen.count(f'source.put("{field}"') == 2,
            f'A22 ㋸: frozen click/link 양쪽의 {field} 누락')

if errors:
    print('\n'.join(errors), file=sys.stderr)
    raise SystemExit(1)
print(f'A22 위성 계약 검사 통과: producer {len(producer)}종 · template {len(consumers)*4}개')
