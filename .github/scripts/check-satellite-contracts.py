#!/usr/bin/env python3
"""A22 경계의 정적 회귀 검사. 실행·경합 보장은 각 서비스의 실제 DB/Kafka 테스트가 검증한다.

앱(app/app-dev/**) 을 읽는 단언은 «의도적으로» 없다. 알림 서버 분리(GROMO-1659)는 서버만 다루고
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

keys = source('server/business-api/src/main/java/com/oneorthree/business/usecase/RequestIdempotencyKeys.java')
replay = source('server/business-api/src/main/java/com/oneorthree/business/usecase/ClaimIntentReplayService.java')
invite = source('server/business-api/src/main/java/com/oneorthree/business/usecase/InviteLinkUseCase.java')
intent = source('server/data-api/src/main/java/com/oneorthree/phone/invitelink/repository/domain/InviteClaimIntent.java')
require('MAX_KEY_LENGTH = 150' in keys and 'fromStepKey(intent.idempotencyKey(), "claim-intent")' in replay,
        'A22 ㋹: 외부 키 상한 또는 claim 재개 단계 키 복원 누락')
require('abandonClaimIntent' in invite and 'markCommandDelivered(' not in invite,
        'A22 ㋹: claim 의도 UUID를 알림 outbox 전달 완료에 사용함')
require('complete(at, this.leaseToken)' in intent,
        'A22 ㋹: 확정이 현재 리스 완료 토큰을 보존하지 않음')
claim_service = source('server/data-api/src/main/java/com/oneorthree/phone/internal/service/InternalInviteLinkService.java')
for lookup in ['findPendingByUserAndSlugForUpdate', 'findByIdForUpdate', 'findByIdAndUserIdForUpdate']:
    require(lookup in claim_service, f'A22 ㋹: claim 의도 전이 잠금 조회 {lookup} 누락')

require('claimIntentEventId(userId, key)' in claim_service
        and 'IDEMPOTENCY_KEY_CONFLICT' in claim_service
        and 'intent.isSettled()' in claim_service,
        'A22 ㋹: 요청 키별 의도 식별·본문 충돌 판정·종결 결과 재생 누락')
require('intent.completed()' in invite,
        'A22 ㋹: 종결된 요청을 하위 claim 없이 완료로 재생하지 않음')

termination = source('server/business-api/src/main/java/com/oneorthree/business/usecase/ClaimIntentTermination.java')
require('ClaimIntentTermination.isTerminal(e)' in invite and 'ClaimIntentTermination.isTerminal(e)' in replay,
        'A22 ㋹: 요청과 재개 경로의 확정 거절 종결 판정이 공유되지 않음')
require('"SLUG_NOT_FOUND"' in termination and '"USER_WITHDRAWN"' in termination
        and 'getRetryAfterMs()' in termination and '408' in termination and '429' in termination,
        'A22 ㋹: 확정 거절 허용목록 또는 일시적 실패 보존 누락')

writer = source('.github/scripts/write-compose-env.py')
require('if service == "business-api" and environment == "prod":' in writer
        and 'required += ("LINK_PROXY_SECRET",)' in writer,
        'A22 ㋯: 운영 Business 프록시 시크릿 필수 검증 누락')
compose = source('server/scripts/docker-compose.satellites.yml')
require('business_redis_acl' in writer and '~cache:business:*' in writer
        and 'user default off' in writer and 'BUSINESS_REDIS_PASSWORD' in writer,
        'A22 ㋺: Business 전용 캐시 ACL 또는 시크릿 공급 누락')
require('networks: [business-cache]' in compose and 'internal: true' in compose,
        'A22 ㋺: Redis 캐시 전용 내부 네트워크 누락')

auth_service = source('server/data-api/src/main/java/com/oneorthree/phone/auth/service/AuthService.java')
refresh_entry = auth_service.split('public TokenRefreshResponse refreshToken(String refreshToken)', 1)[1].split(
        'private TokenRefreshResponse refreshOnSession', 1)[0]
require(refresh_entry.index('findActiveByIdForUpdate') < refresh_entry.index('findByRefreshToken'),
        'A22 ㋣: 사용자 잠금 뒤 세션 원장을 조회하는 갱신 순서 누락')
require('rotateActive(session, refreshToken, rotatedRefreshToken)' in auth_service
        and 'currentHash.equals(user.getRefreshTokenHash())' in auth_service,
        'A22 ㋣: 세션별 RT 회전 또는 다른 기기 단일 해시 보존 누락')
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


end_producer = source('server/data-api/src/main/java/com/oneorthree/phone/notification/service/ChallengeEndPushDispatcher.java')
dispatch = source('server/notification/src/main/java/com/oneorthree/notification/DispatchService.java')
families = source('server/notification/src/main/java/com/oneorthree/notification/Bundles.java')
require('"bundleMembers"' in end_producer and '"bundleRepresentative"' in end_producer
        and '"bundleMembers"' in dispatch and 'containsAll(declared)' in dispatch,
        'A22 ㋴: 종료 묶음의 원본 구성원 선언 또는 수신 완료 대조 누락')
open_producer = source('server/data-api/src/main/java/com/oneorthree/phone/notification/service/SessionOpenNotificationService.java')
require('"bundleMembers"' in open_producer and 'openBundleMembers(due, joined, membersByGroupId)' in open_producer
        and 'key -> new ArrayList<>()).add(session.getId().toString())' in open_producer,
        'A22 ㋴: 모집 묶음의 수신자별 회차 구성원 선언 누락')
require('"CHALLENGE_WINDOW_END"' in families and '"CHALLENGE_ENDED"' in families
        and 'holdUntil(' in dispatch and 'held_until' in dispatch,
        'A22 ㋴: 종료 묶음 종류 또는 슬롯·ACK 보류의 후보 이월 누락')

batch_retry = source('server/data-api/src/main/java/com/oneorthree/phone/notification/service/NotificationBatchRetry.java')
require('"40001".equals(sql.getSQLState())' in batch_retry
        and 'properties.isOutboxMode() ? MAX_ATTEMPTS : 1' in batch_retry
        and 'batch.accept(slot)' in batch_retry and 'isActualTransactionActive()' in batch_retry,
        'A22 ㋴: RR 배치의 OUTBOX 한정·동일 슬롯·트랜잭션 외부 재시도 경계 누락')
for entry, count in [('scheduler/NotificationScheduler.java', 7),
                     ('NotificationBatchController.java', 5),
                     ('migration/NotificationCronReplayService.java', 7)]:
    body = source('server/data-api/src/main/java/com/oneorthree/phone/notification/' + entry)
    require(body.count('batchRetry.run(') == count,
            f'A22 ㋴: {entry}의 리그 판정 진입점이 재시도 경계를 우회함')

membership_events = source('server/data-api/src/main/java/com/oneorthree/phone/group/service/LinkMembershipEventService.java')
member_repository = source('server/data-api/src/main/java/com/oneorthree/phone/group/repository/GroupMemberRepository.java')
require(membership_events.count('lockActiveMembershipId(') == 2
        and 'member.applyDisplaySnapshot(' not in membership_events
        and 'SET gm.snapshotVersion = :snapshotVersion' in member_repository
        and 'gm.isLeft = false' in member_repository,
        'A22 ㋻: 표시정보 갱신이 멤버십 엔티티 전체를 덮거나 이탈 조건을 누락함')
require('AggregateRef.ofUser(joinedUserId)' in membership_events
        and 'joinedUserId + ":" + joinEpoch' in membership_events
        and 'LINK_SLUG.matcher(slug).matches()' in membership_events,
        'A22 ㋻: 가입 사실의 가입자 축·재가입 사건 키·선택 slug 형식 경계 누락')

migration_service = source('server/notification/src/main/java/com/oneorthree/notification/MigrationService.java')
require('for (String resource : MigrationRecords.RESOURCES)' in migration_service
        and 'REQUIRED_RESOURCE_MISSING' in migration_service,
        'A22 ㋭: manifest의 다섯 필수 자원 누락을 허용함')
require('resumed && pendingSource' in migration_service and 'ATTEMPTS_REGRESSED' in migration_service,
        'A22 ㋭: 최초 이관 검증과 개방 후 정상 재시도 재개를 구분하지 않음')
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
export_manifest = source('server/data-api/src/main/java/com/oneorthree/phone/notification/migration/NotificationMigrationManifest.java')
export_cli = source('server/data-api/src/main/java/com/oneorthree/phone/notification/migration/NotificationMigrationCliRunner.java')
require('String snapshot' in export_manifest
        and '"snapshot", document.manifest().snapshot(), "records", wire' in export_cli
        and 'Math.max(1, records.size())' in export_cli,
        'A22 ㋼: export 스냅샷 식별자·모든 청크 연결·명시적 빈 청크 중 일부 누락')
require('snapshot_id=?' in migration_service and 'migration_snapshots' in migration_service
        and 'retire(migrationId' in migration_service and 'settings.imported_by' in migration_service,
        'A22 ㋼: 최종 전체 집합 검증·빈 스냅샷 등록·이관 소유 행 정리 경계 누락')

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
        'A22 ㋻: 멤버 역할·권한 변경이 동시 표시 버전을 전체 행 저장으로 되돌릴 수 있음')
gate_commands = source('server/notification/src/main/java/com/oneorthree/notification/MigrationService.java')
close_command = gate_commands.split('public Map<String, Object> close(', 1)[1].split('// ──', 1)[0]
require('DISPATCH_OPEN_REPLAY_STALE' in gate_commands and 'activate.get();' in gate_commands
        and '}, true);' in close_command,
        'A22 ㋾: 게이트 재시도의 현재 검증·중지 보호·재차 drain 경계 누락')

if errors:
    print('\n'.join(errors), file=sys.stderr)
    raise SystemExit(1)
print(f'A22 위성 계약 검사 통과: producer {len(producer)}종 · template {len(consumers)*4}개')
