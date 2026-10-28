#!/usr/bin/env python3
"""A22 경계의 정적 회귀 검사. 실행·경합 보장은 각 서비스의 실제 DB/Kafka 테스트가 검증한다.

앱(app/legacy/app-dev/**) 을 읽는 단언은 «의도적으로» 없다. 알림 서버 분리(GROMO-1659)는 서버만 다루고
앱 변경은 별도 PR 로 가므로, 이 스크립트가 앱 소스를 읽으면 서버 전용 브랜치에서 FileNotFoundError
로 죽는다 — 실제로 그렇게 CI 가 멈췄다. 그래서 ㋲ 축의 앱 절반(소유권 승계·세션 승격 저장·SDK 토큰
정리)은 여기서 검사하지 않고, 앱 PR 이 자기 CI(app-lint) 와 함께 들고 온다. 서버 절반은 그대로 남아
있으니 아래 ㋲ 단언들을 지우지 마라.
"""
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
producer = set(re.findall(r'^\s+([A-Z][A-Z0-9_]+)\(SubjectKind\.', kinds, re.M))
# 카탈로그는 «마이그레이션 전체»다. V2 하나만 읽으면 그 뒤에 새 파일로 더해진 kind·템플릿이 안 보여,
# 실제로는 등록된 종류를 「수신 누락」으로 잡는다. 이미 통합 브랜치에 있는 마이그레이션은 바이트가 계약이라
# (워크플로 「적용된 마이그레이션 불변」) 신규 kind 는 앞으로도 새 V 파일로만 들어온다 — 그래서 디렉터리를
# 통째로 합쳐 본다. 아래 템플릿 4로케일 검사도 같은 합본을 쓴다.
seed = '\n'.join(path.read_text() for path in sorted(
        (ROOT / 'server/notification/src/main/resources/db/migration').glob('V*.sql'),
        key=lambda path: int(path.name.split('__', 1)[0][1:])))
consumers = set(re.findall(r"INSERT INTO kinds\([^\n]+VALUES\('([^']+)'", seed))
require(producer == {'FRIEND_REQUEST', 'FRIEND_ACCEPTED', 'MAIN_ISLAND_TRANSFERRED',
                      'MAGAZINE_PUBLISHED', 'ISLAND_KICKED'},
        f'현재 제품 알림 종류 불일치: {producer}')
require(producer <= consumers, f'현재 알림 카탈로그 수신 누락: {producer-consumers}')
for kind in producer:
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
require('NOTIFICATION_DISPATCH_MODE' not in profile, '폐기한 직접 발송 스위치가 남아 있음')
require('${OUTBOX_RELAY_ENABLED:false}' in profile, 'A18 미확정 상태에서 relay가 자동으로 켜짐')
for path in (ROOT / 'server/notification/src/main/resources').glob('application-*.yml'):
    require('API_DB_' not in path.read_text(), f'{path.relative_to(ROOT)}: 알림이 core DB 자격을 받음')

keys = source('server/business-api/src/main/java/com/oneorthree/business/usecase/RequestIdempotencyKeys.java')
require('MAX_KEY_LENGTH = 150' in keys, '외부 멱등 키 상한 누락')

writer = source('.github/scripts/write-compose-env.py')
compose = source('server/scripts/docker-compose.satellites.yml')
require('business_redis_acl' in writer and '~cache:business:*' in writer
        and 'user default off' in writer and 'BUSINESS_REDIS_PASSWORD' in writer,
        'A22 ㋺: Business 전용 캐시 ACL 또는 시크릿 공급 누락')
require('networks: [business-cache]' in compose and 'internal: true' in compose,
        'A22 ㋺: Redis 캐시 전용 내부 네트워크 누락')

auth_service = source('server/data-api/src/main/java/com/oneorthree/phone/auth/service/AuthService.java')
refresh_entry = auth_service.split('public TokenRefreshResponse refreshSessionAccessToken(String refreshToken)', 1)[1]
require(refresh_entry.index('findActiveByIdForUpdate') < refresh_entry.index('findByRefreshToken'),
        '세션 갱신에서 사용자 잠금 뒤 세션 원장을 조회하는 순서 누락')
require('getRefreshTokenHash()' not in auth_service,
        '폐기한 users 단일 refresh 해시 경로가 남아 있음')
user_commands = source('server/data-api/src/main/java/com/oneorthree/phone/user/service/UserSatelliteCommandService.java')
require('DeviceOwnershipTokens.isCanonicalOrAbsent(request.ownershipToken())' in user_commands,
        'A22 ㋗: 소유권 형식의 Data 내구 기록 전 검증 누락')

device = source('server/notification/src/main/java/com/oneorthree/notification/DeviceService.java')
inbound = source('server/notification/src/main/java/com/oneorthree/notification/InboundService.java')
require('requireCanonicalOwnership(owner)' in device and 'CANONICAL_UUID.matcher(owner).matches()' in device
        and 'rawOwnership(params)' in inbound,
        'A22 ㋗: 동기 삭제 검증 또는 잘못된 내구 소유권의 소비 경계 누락')
store = source('server/notification/src/main/java/com/oneorthree/notification/Store.java')
require('intent.remove("sessionEpoch")' in device and 'registerLocked(user, body, true)' in device
        and 'revalidate.run()' in store,
        'A22 ㋲: 기기 등록 의도와 현재 세션 fencing의 분리 또는 재생 검증 누락')
# 소유권 승계(inheritOwnership)의 대조 상대는 앱 큐다 — 앱 PR 과 함께 온다(머리말 참조).

biz_device = source('server/business-api/src/main/java/com/oneorthree/business/usecase/DeviceTokenUseCase.java')
require('notification.legacy-device-registration' in device and 'staleGeneration(generation, fence)' in device
        and 'legacyRow(previous, user)' in device and 'previous.get("bootstrap_hash") == null' in device
        and 'previous.get("legacy_session_id") == null' in device,
        'A22 ㋲: 구 앱 호환과 gen 축 분리 또는 현대 기기 소유권 보호 누락')
require('legacy_session_fences' in device and 'legacy_session_id' in device
        and 'legacyFirstUse ? legacyTakeover(previous)' in device
        and 'legacyLinkedActive && legacyRotation(previous, user, legacySession)' in device,
        'A22 ㋲: 구 앱 세션 최초 사용·활성 연결·폐기 경계 누락')
# 이 단언은 원래 서버·앱 혼합이었다. 앱 절반(승격 저장 키·같은 로그인 대조)은 빠졌지만 서버 절반은
# 남긴다 — Business 가 «서명된 sid 가 아직 살아 있는가»를 Data 에 확인하는 것이 ㋲ 의 서버측 계약이고,
# 통째로 지우면 그 확인이 사라진 것을 아무도 못 잡는다.
require('dataApiClient.verifySession(claims.userId(), claims.sessionId(), deadline)' in biz_device,
        'A22 ㋲: 서명된 sid 활성 확인 누락')


membership_transitions = source('server/data-api/src/main/java/com/oneorthree/phone/group/service/IslandMembershipTransitions.java')
require('mainIslandService.onMembershipRevoked(member)' in membership_transitions
        and 'userIslandContextRecovery.onMembershipRevoked(member)' in membership_transitions
        and 'member.advanceMembershipEpoch()' in membership_transitions,
        '현재 섬 복구 또는 초대 코드 멤버십 세대 갱신 누락')

fcm_transport = source('server/notification/src/main/java/com/oneorthree/notification/FcmTransport.java')
fcm_payload = source('server/notification/src/main/java/com/oneorthree/notification/FcmPayload.java')
require('return FcmPayload.create(token, push, sound, eventId);' in fcm_transport
        and 'if (push.title() != null)' in fcm_payload,
        'TemplateWrite: nullable title을 FCM 표시 payload에 안전하게 직렬화하지 않음')

settings_service = source('server/notification/src/main/java/com/oneorthree/notification/SettingsService.java')
require('DateTimeFormatter.ofPattern("HH:mm")' in settings_service
        and settings_service.count('.format(API_TIME)') == 2,
        'A22 ㋕: 앱용 야간 설정 응답이 HH:mm 계약을 보존하지 않음')

dispatch_service = source('server/notification/src/main/java/com/oneorthree/notification/DispatchService.java')
require('AND active AND NOT transport_invalid' in dispatch_service
        and 'SET transport_invalid=true' in dispatch_service
        and 'delivery_devices WHERE delivery_id=? AND device_key=?' in dispatch_service,
        'A22 ㊚: FCM 토큰 유효성·소유권·기기별 성공 이력을 같은 축으로 처리함')

# 앱 큐의 직렬화 경계(ownershipCritical)도 앱 PR 이 들고 온다(머리말 참조).
require('SELECT 1 FROM delivery_devices WHERE delivery_id=? LIMIT 1' in dispatch_service,
        'A22 ㊚: 성공 이력이 없는 UNREGISTERED 알림을 완료 처리함')
kafka_compose = source('server/scripts/docker-compose.kafka.yml')
require('KAFKA_LOG_DIRS: /var/lib/kafka/data' in kafka_compose
        and 'kafka-data:/var/lib/kafka/data' in kafka_compose,
        'A12: Kafka 로그 경로와 영속 볼륨 경로가 연결되지 않음')

data_settings = source('server/data-api/src/main/java/com/oneorthree/phone/user/service/UserSatelliteCommandService.java')
require('userQueryService.getNotificationSettingsForUpdate(userId)' in data_settings,
        'A22 ㋕: 설정을 잠금 없이 읽은 뒤 버전만 직렬화함')
# 첫 등록 전 구 기기 SDK 토큰 정리는 앱 전용 경로다 — 앱 PR 이 들고 온다(머리말 참조).

internal_http = source('server/business-api/src/main/java/com/oneorthree/business/common/http/InternalHttpClient.java')
# HTTP 실행의 실제 복구 동작은 InternalHttpClientRecoveryTest/DeadlineTest가 검증한다.
# 여기서는 현재 context 예산 검사와 탐침 종료 경계만 확인한다. 누락도 계약 오류로 보고한다.
exchange_start = internal_http.find('public <T> T exchange(InternalCall call, UpstreamRequestContext context,')
exchange_end = internal_http.find('private <T> T attempt(', max(0, exchange_start))
exchange = internal_http[exchange_start:exchange_end] if 0 <= exchange_start < exchange_end else ''
active_check = exchange.find('context.checkActive();')
probe_acquire = exchange.find('circuitBreaker.allowRequest(')
require(0 <= active_check < probe_acquire,
        'A22 ㋽: 요청 예산·취소 검사가 복구 탐침 획득보다 앞서지 않음')
require(bool(re.search(r'catch \(UpstreamDomainException.*?UpstreamContractMismatchException terminal\)'
                       r'\s*\{[^}]*circuitBreaker\.recordSuccess\(\);', exchange, re.S))
        and bool(re.search(r'catch \(RuntimeException terminal\)\s*\{'
                           r'\s*circuitBreaker\.recordIgnored\(\);', exchange)),
        'A22 ㋽: 비재시도 응답의 탐침 종료 또는 실행 취소·실패의 탐침 반환 경계 누락')


member_entity = source('server/data-api/src/main/java/com/oneorthree/phone/group/repository/domain/GroupMember.java')
require('@DynamicUpdate' in member_entity,
        '멤버 역할·권한 변경이 멤버십 상태를 전체 행 저장으로 덮을 수 있음')
data_internal = ROOT / 'server/data-api/src/main/java/com/oneorthree/phone/internal'
for path in data_internal.rglob('*.java'):
    body = path.read_text()
    require(not re.search(r'@(Get|Post)Mapping\("[^"\n]*(challenge-results|result-ack|/migrations/)', body),
            f'{path.relative_to(ROOT)}: 폐기한 결과 확인·이관 API가 남아 있음')
require(not list((ROOT / 'server/data-api/src/main/java/com/oneorthree/phone/notification/migration').rglob('*.java')),
        '폐기한 Data 알림 이관 exporter가 남아 있음')

if errors:
    print('\n'.join(errors), file=sys.stderr)
    raise SystemExit(1)
print(f'A22 위성 계약 검사 통과: producer {len(producer)}종 · template {len(producer)*4}개')
