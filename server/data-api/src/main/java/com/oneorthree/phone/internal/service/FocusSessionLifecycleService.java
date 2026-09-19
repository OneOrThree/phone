package com.oneorthree.phone.internal.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.oneorthree.phone.common.port.FocusPresencePort;
import com.oneorthree.phone.common.util.ZonePolicy;
import com.oneorthree.phone.focus.dto.session.FocusFinishView;
import com.oneorthree.phone.focus.dto.session.FocusSessionStartCommandRequest;
import com.oneorthree.phone.focus.dto.session.FocusSessionView;
import com.oneorthree.phone.focus.dto.session.FocusSummaryView;
import com.oneorthree.phone.focus.dto.session.FocusVersionedCommandRequest;
import com.oneorthree.phone.focus.exception.FocusErrorCode;
import com.oneorthree.phone.focus.exception.FocusException;
import com.oneorthree.phone.focus.repository.DailyFocusStatRepository;
import com.oneorthree.phone.focus.repository.FocusSessionDetailRepository;
import com.oneorthree.phone.focus.repository.FocusSessionIntervalRepository;
import com.oneorthree.phone.focus.repository.FocusSessionOwnership;
import com.oneorthree.phone.focus.repository.FocusSessionRepository;
import com.oneorthree.phone.focus.repository.domain.DailyFocusStat;
import com.oneorthree.phone.focus.repository.domain.FocusIntervalKind;
import com.oneorthree.phone.focus.repository.domain.FocusSession;
import com.oneorthree.phone.focus.repository.domain.FocusSessionDetail;
import com.oneorthree.phone.focus.repository.domain.FocusSessionInterval;
import com.oneorthree.phone.focus.repository.domain.FocusSessionLifecycle;
import com.oneorthree.phone.focus.repository.domain.FocusType;
import com.oneorthree.phone.focus.support.FocusIntervalMath;
import com.oneorthree.phone.focus.support.FocusRewardPolicyGate;
import com.oneorthree.phone.focus.support.FocusSessionStartGate;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.group.repository.domain.UserIslandContext;
import com.oneorthree.phone.group.service.GroupMembershipMutationLocks;
import com.oneorthree.phone.group.service.UserIslandContextLockService;
import com.oneorthree.phone.outbox.dto.AggregateRef;
import com.oneorthree.phone.outbox.dto.EventEnvelope;
import com.oneorthree.phone.outbox.dto.OutboxAppendCommand;
import com.oneorthree.phone.outbox.dto.OutboxDeliveryRequest;
import com.oneorthree.phone.outbox.dto.PublicCommandRequest;
import com.oneorthree.phone.outbox.dto.PublicCommandResult;
import com.oneorthree.phone.outbox.exception.OutboxErrorCode;
import com.oneorthree.phone.outbox.exception.OutboxException;
import com.oneorthree.phone.outbox.service.OutboxCommandPort;
import com.oneorthree.phone.outbox.service.PublicCommandService;
import com.oneorthree.phone.outbox.support.OutboxEnvelopeCodec;
import com.oneorthree.phone.user.repository.UserQueryService;
import com.oneorthree.phone.user.repository.domain.User;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.DateTimeException;
import java.time.Instant;
import java.time.LocalDate;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * 집중 세션 수명주기 API 6종 (GROMO-1764) — {@code POST /focus-sessions}(start) ·
 * {@code GET /focus-sessions/current} · {@code .../pause} · {@code .../resume} ·
 * {@code .../finish} · {@code GET /me/focus-summary}. 설계 정본은
 * {@code docs/prd/fishcat/focus-rest-session/low-level-design.md}.
 *
 * <p><b>이 클래스가 여는 것은 공개 경로가 아니다.</b> 위 경로는 Business 의 공개 표면이고, data-api 는
 * {@code InternalFocusSessionController} 의 {@code /internal/users/{userId}/…} 위임만 받는다 — nginx 가
 * 무접두 {@code /focus-sessions}·{@code /me} 를 Business 로 보내기 때문이다. 아래 메서드 주석의 경로는
 * 「이 메서드가 구현하는 LLD §2 계약의 이름」이지 data-api 의 매핑이 아니다.
 *
 * <p>태그 5종({@link FocusService}의 태그 메서드)은 건드리지 않는다 — 별개 레거시 폐기 대상이라
 * 이 클래스로 옮기거나 지우지 않는다.
 *
 * <h2>잠금 순서(LLD §3)</h2>
 * start는 아직 진행 마커가 없어 <b>배타</b> 사용자 락({@link #requireActiveUserForUpdate})으로
 * "동시 start 둘 다 마커 없음을 보고 둘 다 INSERT"를 막는다(레거시 {@code startFocusSession}과 같은
 * 이유). pause/resume/finish는 이미 존재하는 상세 행 자체가 잠금 지점이라 <b>공유</b> 사용자 락
 * ({@link #requireActiveUser})만 잡고, {@link FocusSessionDetailRepository#findBySessionIdForUpdate}로
 * 그 행을 배타 잠근다(레거시 {@code endFocusSession}과 같은 결).
 *
 * <p><b>섬·멤버십을 상세보다 «먼저» 잠근다</b>(GROMO-1924, 선행 조건 #8). 순서는 LLD §3 그대로
 * 사용자 → (receipt) → 섬 행 배타 → 그 섬의 활성 멤버십 공유 → 상세 배타 → 구간이다. 강퇴
 * ({@code GroupMemberService.kickMember})가 사용자 공유 → 섬 행 배타 → 멤버십 배타 순으로 잡으므로,
 * 전이와 강퇴는 섬 행에서 줄을 서고 둘 중 먼저 온 쪽이 끝난 뒤에 나머지가 판정한다 — 강퇴가 이기면
 * 전이는 멤버십 없음(403)을 보고, 전이가 이기면 강퇴는 그 전이가 남긴 상태를 보고 종결한다. 멤버십을
 * 잠그지 않던 종전 순서에서는 강퇴가 «먼저» 커밋돼도 이미 검사를 통과한 전이가 outbox 까지 남겼다.
 * 상세를 먼저 잠그면 반대로 {@code pause} 의 섬 잠금과 강퇴가 서로를 기다린다 — 그래서 어느 섬을
 * 잠글지는 잠그지 않는 프로젝션({@link FocusSessionOwnership})으로 먼저 알아낸다.
 *
 * <h2>비활성 게이트 둘</h2>
 * {@link #finish}는 유효성 검사를 전부 통과해도 {@link FocusRewardPolicyGate#isOpen()}이 닫혀 있으면
 * {@link FocusErrorCode#REWARD_POLICY_UNAVAILABLE}로 막는다 — policy.md가 "정책 없을 때 성공 정산
 * receipt를 만들지 않는다"고 정했다.
 *
 * <p>그래서 {@link #start}도 {@link FocusSessionStartGate}로 먼저 막는다. finish가 항상 503인데
 * start만 열려 있으면 사용자는 <b>끝낼 수 없는 세션</b>에 갇힌다 — v0.3 상세가 달린 세션은 12시간
 * orphan 스윕에서도 제외되고(LLD §5), 다음 start는 열린 기본 마커 때문에 409다. 두 게이트를 여는 날의
 * 선행 조건 목록은 {@link FocusSessionStartGate}의 javadoc에 있다.
 *
 * <h2>기본 마커 외부 종료 방어</h2>
 * 진행 중 상세를 집는 세 지점({@link #start}·{@link #current}·{@link #authorizeSession})은
 * {@link #abandonIfMarkerClosed}로 「상세가 진행 중이면 기본 {@code focus_sessions.ended_at}이 null」
 * 이라는 불변식을 되본다 — 레거시 start가 그 사용자의 열린 마커를 전부 닫기 때문이다. 그래서
 * {@link FocusSessionLifecycle#ABANDONED}는 지급 게이트와 무관하게 관측될 수 있다.
 */
@Service
@Slf4j
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class FocusSessionLifecycleService {

    private static final int MAX_SUBJECT_LENGTH = 200;
    private static final String FOCUS_MEMBER_AGGREGATE_TYPE = "FOCUS_MEMBER";
    private static final String REST_MEMBER_AGGREGATE_TYPE = "REST_MEMBER";
    private static final String FOCUS_MEMBER_EVENT_TYPE = "focus.member.updated";
    private static final String REST_MEMBER_EVENT_TYPE = "rest.member.updated";
    /** 세션이 끝나 focus/rest 목록에서 지운다는 상태값 — LLD §6 의 {@code completed}(행 제거)다. */
    private static final String STATUS_ENDED = "completed";
    /** 「진행 중」으로 보는 lifecycle — 사용자당 최대 1건(V58 부분 UNIQUE)이 걸리는 집합 그대로다. */
    private static final List<FocusSessionLifecycle> PROGRESSING =
            List.of(FocusSessionLifecycle.ACTIVE, FocusSessionLifecycle.PAUSED);

    private final FocusSessionStartGate startGate;
    private final UserQueryService userQueryService;
    private final GroupMembershipMutationLocks membershipLocks;
    private final GroupMemberRepository groupMemberRepository;
    private final UserIslandContextLockService userIslandContextLockService;
    private final FocusSessionRepository focusSessionRepository;
    private final FocusSessionDetailRepository focusSessionDetailRepository;
    private final FocusSessionIntervalRepository focusSessionIntervalRepository;
    private final DailyFocusStatRepository dailyFocusStatRepository;
    private final PublicCommandService publicCommands;
    private final OutboxCommandPort outboxCommandPort;
    /**
     * 집중 프레즌스 리스(선행 조건 #5) — 채팅 서버가 「집중 중엔 채팅 불가」를 판정하는 근거다.
     * 레거시와 <b>같은 포트·같은 키</b>를 쓴다(LLD §6 「하나의 Data projection 포트」). 리스는 세션 단위라
     * start 가 놓고 세션을 끝내는 전이(finish·소속 상실·마커 desync 정리)가 지운다. pause/resume 은
     * 건드리지 않는다 — 휴식 중 채팅 허용은 미결 제품 결정 FR-D04 이고, 그 결정 전에는 세션이 끝날
     * 때까지 리스가 남는다(레거시 리컨실러도 열린 마커마다 같은 리스를 복구한다).
     */
    private final FocusPresencePort focusPresencePort;
    private final Clock clock;

    /**
     * {@code POST /focus-sessions} — LLD §2 start.
     *
     * <p><b>가장 앞에서</b> {@link FocusSessionStartGate}를 본다 — 입력 검증보다도 먼저다. finish가
     * 항상 503인 동안 세션을 만들면 끝낼 수도, 스윕으로 풀릴 수도, 다시 시작할 수도 없는 상태에
     * 갇히기 때문이다. 게이트가 막는 한 진행 행 자체가 생기지 않는다.
     */
    @Transactional
    public FocusSessionView start(UUID userId, FocusSessionStartCommandRequest body, UUID idempotencyKey) {
        if (!startGate.isOpen()) {
            throw new FocusException(FocusErrorCode.SESSION_START_UNAVAILABLE);
        }
        String subject = validateSubject(body == null ? null : body.subject());
        int targetMinutes = validateTargetMinutes(body == null ? null : body.targetMinutes());
        UUID islandId = requireIslandId(body == null ? null : body.islandId());

        PublicCommandRequest command = new PublicCommandRequest(userId, "POST:/focus-sessions:" + userId,
                idempotencyKey, tree(Map.of("islandId", islandId.toString(), "subject", subject,
                        "targetMinutes", targetMinutes)));
        JsonNode data = publicCommands.run(command,
                () -> requireActiveUserForUpdate(userId),
                ignored -> requireActiveUserForUpdate(userId),
                () -> {
                    User user = requireActiveUserForUpdate(userId);
                    // 새/구 프로토콜을 가리지 않는다 — v0.3 진행 세션도 기본 행이 endedAt=null이다.
                    if (focusSessionRepository.findFirstByUserAndEndedAtIsNullOrderByStartedAtDesc(user)
                            .isPresent()) {
                        throw new FocusException(FocusErrorCode.SESSION_IN_PROGRESS);
                    }
                    // 기본 행은 닫혔는데 상세만 진행 중인 경우를 여기서 정리한다. 두면 아래 상세
                    // INSERT가 부분 UNIQUE(V58)를 위반해 이 사용자는 영영 start에서 500을 받는다.
                    if (focusSessionDetailRepository.findFirstByUserIdAndLifecycleIn(userId, PROGRESSING)
                            .map(this::abandonIfMarkerClosed).orElse(false)) {
                        // UPDATE가 INSERT보다 먼저 DB에 닿아야 한다 — Hibernate는 한 flush 안에서
                        // insert를 update보다 먼저 실행하므로, 그냥 두면 부분 UNIQUE에 걸린다.
                        focusSessionDetailRepository.flush();
                    }
                    UserIslandContext context = userIslandContextLockService.lock(user);
                    if (context.getCurrentIslandId() == null || !context.getCurrentIslandId().equals(islandId)) {
                        throw new FocusException(FocusErrorCode.ISLAND_NOT_CURRENT);
                    }
                    // context → 섬 → 멤버십 — 섬 소속 경로(IslandMembershipService)와 같은 방향이다.
                    GroupMember membership = requireLockedMembership(userId, islandId);

                    Instant now = clock.instant();
                    FocusSession session = focusSessionRepository.save(FocusSession.builder()
                            .user(user)
                            .focusType(FocusType.INFINITE)
                            .startedAt(now)
                            .build());
                    FocusSessionDetail detail = focusSessionDetailRepository.save(FocusSessionDetail.builder()
                            .sessionId(session.getId())
                            .userId(userId)
                            .islandId(islandId)
                            .membershipEpochAtStart(membership.getMembershipEpoch())
                            .subject(subject)
                            .targetMinutes(targetMinutes)
                            .lifecycle(FocusSessionLifecycle.ACTIVE)
                            .version(1L)
                            .lastTransitionAt(now)
                            .build());
                    focusSessionIntervalRepository.save(FocusSessionInterval.builder()
                            .sessionId(session.getId())
                            .ordinal(1)
                            .kind(FocusIntervalKind.ACTIVE)
                            .startedAt(now)
                            .build());

                    FocusSessionView view = new FocusSessionView(session.getId(), islandId, subject, targetMinutes,
                            FocusSessionView.STATUS_ACTIVE, 0L, now, now, null, detail.getVersion());
                    EventEnvelope event = appendFocusMemberEvent(userId, islandId, view);
                    // 선행 조건 #9 — start 도 rest 투영을 내구화한다(LLD §6). active 는 「rest 목록에서
                    // 이 사용자를 지운다」라, 이전 세션이 남긴 옛 sessionId·restSeat 가 새 focus 상태와
                    // 함께 보이지 않는다.
                    EventEnvelope restEvent = appendRestMemberEvent(userId, islandId, session.getId(),
                            FocusSessionView.STATUS_ACTIVE, null, null, now, detail.getVersion());
                    // 반영은 커밋 이후다(RedisFocusPresence) — 롤백된 start 는 리스를 남기지 않는다.
                    focusPresencePort.focusStarted(userId, session.getId(), now);
                    return new PublicCommandResult(201, tree(view), tree(List.of(event, restEvent)));
                }).value().data();
        return decode(data, FocusSessionView.class);
    }

    /**
     * {@code GET /focus-sessions/current} — LLD §2 session. 본인만, 명령이 아니라 단일 snapshot 조회.
     *
     * <p><b>REPEATABLE READ인 이유</b>: 상세와 구간을 두 SELECT로 읽는다. PostgreSQL 기본 READ COMMITTED
     * 에서는 <b>문장마다 새 스냅샷</b>이라, 두 읽기 사이에 다른 기기의 pause가 커밋되면 「{@code status=active}
     * 인데 열린 REST 구간」 같은 <b>불가능한 응답</b>이 나간다. LLD §2가 "단일 DB snapshot의 현재 세션과
     * 상세·구간을 읽는다"고 정했으므로 트랜잭션 스냅샷을 하나로 고정한다.
     *
     * <p>조회인데도 {@code readOnly}가 아닌 것은 의도다 — {@link #abandonIfMarkerClosed}가 어긋난 행을
     * 그 자리에서 종결하고, 그 쓰기가 실제로 커밋돼야 다음 start가 풀린다(readOnly면 flush 자체가 없다).
     *
     * <p><b>{@code REQUIRES_NEW}인 이유.</b> 격리 수준은 «새 트랜잭션을 열 때만» 적용된다. 기본
     * {@code REQUIRED}로 두면, 나중에 누가 이 메서드를 이미 열린 트랜잭션 안에서 부르는 순간 Spring이
     * 예외 없이 <b>조용히 기존 격리(보통 READ COMMITTED)로 참여</b>하고 {@code REPEATABLE_READ}는
     * 무시된다. 그러면 위 단일 스냅샷 보장이 사라지는데, 애노테이션만 보는 테스트는 그대로 통과한다 —
     * 거짓 안심이다. 지금은 호출부가 내부 컨트롤러 하나뿐이라 «우연히» 맞지만, 우연을 코드로 바꾼다.
     * 선례: {@code InternalRealtimeMembershipAuthorizationService}.
     * 그 쓰기가 동시 수정과 겹치면 PostgreSQL이 {@code 40001}(could not serialize access)로 트랜잭션을
     * 통째로 되돌린다. 재시도를 달지 않는다 — Hibernate {@code LockAcquisitionException} → Spring
     * {@code CannotAcquireLockException}으로 번역돼
     * {@link com.oneorthree.phone.common.exception.GlobalExceptionHandler#handlePessimisticLock}가
     * 409 {@code CONCURRENT_UPDATE}("잠시 후 다시 시도해주세요")로 내보내는, <b>이미 사용자에게 보여 줄 만한</b>
     * 답이기 때문이다(500이 아니다). 게다가 이 쓰기는 마커 desync 정리 경로에서만 일어난다.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW, isolation = Isolation.REPEATABLE_READ)
    public FocusSessionView current(UUID userId) {
        userQueryService.getCaller(userId);
        Instant now = clock.instant();
        return focusSessionDetailRepository
                .findFirstByUserIdAndLifecycleIn(userId, PROGRESSING)
                // 어긋난 행은 정리하고 「진행 중 세션 없음」으로 답한다 — 그게 사용자에게 참이다.
                .filter(detail -> !abandonIfMarkerClosed(detail))
                .map(detail -> toView(detail, now))
                .orElse(null);
    }

    /** {@code POST /focus-sessions/{sessionId}/pause} — LLD §2 pause. */
    @Transactional
    public FocusSessionView pause(UUID userId, UUID sessionId, FocusVersionedCommandRequest body,
                                  UUID idempotencyKey) {
        long expectedVersion = requireExpectedVersion(body == null ? null : body.expectedVersion());
        PublicCommandRequest command = new PublicCommandRequest(userId,
                "POST:/focus-sessions/" + sessionId + "/pause:" + userId, idempotencyKey,
                tree(Map.of("expectedVersion", expectedVersion)));
        JsonNode data = publicCommands.run(command,
                () -> authorizeSession(userId, sessionId),
                ignored -> authorizeSession(userId, sessionId),
                () -> {
                    FocusSessionDetail detail = authorizeSession(userId, sessionId);
                    requireLifecycle(detail, FocusSessionLifecycle.ACTIVE);
                    requireVersion(detail, expectedVersion);

                    Instant now = transitionAnchor(detail);
                    List<FocusSessionInterval> intervals = focusSessionIntervalRepository
                            .findBySessionIdOrderByOrdinalAsc(sessionId);
                    FocusSessionInterval open = FocusIntervalMath.openInterval(intervals)
                            .orElseThrow(() -> new IllegalStateException(
                                    "active 세션에 열린 ACTIVE 구간이 없습니다 — session=" + sessionId));
                    open.close(now);
                    // 닫는 UPDATE가 새 구간 INSERT보다 «먼저» DB에 닿아야 한다 — Hibernate는 한 flush
                    // 안에서 insert를 update보다 먼저 내보내므로, 그냥 두면 열린 구간이 둘이 되어
                    // focus_session_intervals_open_uk 위반으로 첫 pause가 500이 된다(start와 같은 함정).
                    focusSessionIntervalRepository.flush();

                    // 섬 잠금 아래 빈 최소 자리를 배정한다 — 동시 pause 두 건이 같은 자리를 받지 않게(LLD §2).
                    // 그 섬 행은 authorizeSession 이 상세보다 먼저 이미 배타로 잡았다(선행 조건 #8).
                    int restSeat = smallestFreeSeat(
                            focusSessionDetailRepository.findUsedRestSeatsByIslandId(detail.getIslandId()));

                    focusSessionIntervalRepository.save(FocusSessionInterval.builder()
                            .sessionId(sessionId)
                            .ordinal(FocusIntervalMath.nextOrdinal(intervals))
                            .kind(FocusIntervalKind.REST)
                            .startedAt(now)
                            .build());
                    detail.applyPause(now, restSeat);

                    long activeSeconds = FocusIntervalMath.activeSecondsAsOf(intervals, now);
                    FocusSessionView view = new FocusSessionView(sessionId, detail.getIslandId(),
                            detail.getSubject(), detail.getTargetMinutes(), FocusSessionView.STATUS_PAUSED,
                            activeSeconds, now, FocusIntervalMath.sessionStartedAt(intervals), now,
                            detail.getVersion());
                    EventEnvelope focusEvent = appendFocusMemberEvent(userId, detail.getIslandId(), view);
                    EventEnvelope restEvent = appendRestMemberEvent(userId, detail.getIslandId(), sessionId,
                            FocusSessionView.STATUS_PAUSED, now, restSeat, now, detail.getVersion());
                    return new PublicCommandResult(200, tree(view), tree(List.of(focusEvent, restEvent)));
                }).value().data();
        return decode(data, FocusSessionView.class);
    }

    /** {@code POST /focus-sessions/{sessionId}/resume} — LLD §2 resume. */
    @Transactional
    public FocusSessionView resume(UUID userId, UUID sessionId, FocusVersionedCommandRequest body,
                                   UUID idempotencyKey) {
        long expectedVersion = requireExpectedVersion(body == null ? null : body.expectedVersion());
        PublicCommandRequest command = new PublicCommandRequest(userId,
                "POST:/focus-sessions/" + sessionId + "/resume:" + userId, idempotencyKey,
                tree(Map.of("expectedVersion", expectedVersion)));
        JsonNode data = publicCommands.run(command,
                () -> authorizeSession(userId, sessionId),
                ignored -> authorizeSession(userId, sessionId),
                () -> {
                    FocusSessionDetail detail = authorizeSession(userId, sessionId);
                    requireLifecycle(detail, FocusSessionLifecycle.PAUSED);
                    requireVersion(detail, expectedVersion);

                    Instant now = transitionAnchor(detail);
                    List<FocusSessionInterval> intervals = focusSessionIntervalRepository
                            .findBySessionIdOrderByOrdinalAsc(sessionId);
                    FocusSessionInterval open = FocusIntervalMath.openInterval(intervals)
                            .orElseThrow(() -> new IllegalStateException(
                                    "paused 세션에 열린 REST 구간이 없습니다 — session=" + sessionId));
                    open.close(now);
                    // pause와 같은 이유 — 닫는 UPDATE를 먼저 내보내지 않으면 열린 구간이 둘이 된다.
                    focusSessionIntervalRepository.flush();

                    focusSessionIntervalRepository.save(FocusSessionInterval.builder()
                            .sessionId(sessionId)
                            .ordinal(FocusIntervalMath.nextOrdinal(intervals))
                            .kind(FocusIntervalKind.ACTIVE)
                            .startedAt(now)
                            .build());
                    detail.applyResume(now);

                    // REST는 activeSeconds에 더하지 않는다 — 방금 닫은 구간은 REST라 합계가 그대로다.
                    long activeSeconds = FocusIntervalMath.activeSecondsAsOf(intervals, now);
                    FocusSessionView view = new FocusSessionView(sessionId, detail.getIslandId(),
                            detail.getSubject(), detail.getTargetMinutes(), FocusSessionView.STATUS_ACTIVE,
                            activeSeconds, now, FocusIntervalMath.sessionStartedAt(intervals), null,
                            detail.getVersion());
                    EventEnvelope focusEvent = appendFocusMemberEvent(userId, detail.getIslandId(), view);
                    // active 전이는 rest 목록에서 제거를 뜻한다 — restStartedAt/restSeat=null(LLD §6).
                    EventEnvelope restEvent = appendRestMemberEvent(userId, detail.getIslandId(), sessionId,
                            FocusSessionView.STATUS_ACTIVE, null, null, now, detail.getVersion());
                    return new PublicCommandResult(200, tree(view), tree(List.of(focusEvent, restEvent)));
                }).value().data();
        return decode(data, FocusSessionView.class);
    }

    /**
     * {@code POST /focus-sessions/{sessionId}/finish} — LLD §2 finish.
     *
     * <p>유효성 검사(본인·소속 세션·lifecycle·expectedVersion)를 전부 통과해도
     * {@link FocusRewardPolicyGate#isOpen()}이 닫혀 있으면 {@link FocusErrorCode#REWARD_POLICY_UNAVAILABLE}
     * 로 막는다 — FR-D01~06이 확정되기 전까지는 항상 이 경로다. 게이트가 열리면 여기서 구간을 닫고
     * 정산·outbox·지급을 붙인다(지금은 도달하지 않는 코드라 미리 만들지 않는다 — 값을 지어내지 않는다).
     */
    @Transactional
    public FocusFinishView finish(UUID userId, UUID sessionId, FocusVersionedCommandRequest body,
                                  UUID idempotencyKey) {
        long expectedVersion = requireExpectedVersion(body == null ? null : body.expectedVersion());
        PublicCommandRequest command = new PublicCommandRequest(userId,
                "POST:/focus-sessions/" + sessionId + "/finish:" + userId, idempotencyKey,
                tree(Map.of("expectedVersion", expectedVersion)));
        JsonNode data = publicCommands.run(command,
                () -> authorizeSession(userId, sessionId),
                ignored -> authorizeSession(userId, sessionId),
                () -> {
                    FocusSessionDetail detail = authorizeSession(userId, sessionId);
                    if (detail.getLifecycle() == FocusSessionLifecycle.COMPLETED) {
                        // LLD §2: 완료된 세션을 새 키로 finish하면 원 정산 결과를 재생해야 한다. 게이트가
                        // 닫혀 있는 한 이 상태 자체에 도달할 수 없어 아직 구현하지 않는다(값을 지어내지 않는다).
                        throw new FocusException(FocusErrorCode.SESSION_STATE_CONFLICT);
                    }
                    if (detail.getLifecycle() != FocusSessionLifecycle.ACTIVE
                            && detail.getLifecycle() != FocusSessionLifecycle.PAUSED) {
                        throw new FocusException(FocusErrorCode.SESSION_STATE_CONFLICT);
                    }
                    requireVersion(detail, expectedVersion);
                    if (!FocusRewardPolicyGate.isOpen()) {
                        throw new FocusException(FocusErrorCode.REWARD_POLICY_UNAVAILABLE);
                    }
                    throw new IllegalStateException(
                            "FocusRewardPolicyGate가 열렸는데 정산 구현이 없습니다 — GROMO-1764 범위 밖");
                }).value().data();
        return decode(data, FocusFinishView.class);
    }

    /**
     * {@code GET /me/focus-summary} — LLD §2 home-summary. completedSeconds(기존 DailyFocusStat)와
     * currentSessionSecondsToday(진행 세션 구간)를 읽는다.
     *
     * <p><b>REPEATABLE READ인 이유</b>: LLD §2가 "완료 집계·진행 상태·구간을 같은 읽기 snapshot(단일 SELECT
     * 또는 read-only REPEATABLE READ)에서 읽는다"고 못박았다. READ COMMITTED에서는 종료 TX와 겹친 GET이
     * 「완료 집계 갱신 후 + 아직 진행 중」을 각각 다른 스냅샷에서 읽어 같은 시간을 <b>두 번</b> 셀 수 있다.
     *
     * <p>{@code current}와 같은 이유로 {@code readOnly}가 아니다 — {@link #abandonIfMarkerClosed}가 어긋난
     * 행을 여기서도 걸러야 한다. 거르지 않으면 기본 마커가 닫힌 뒤에도 열린 ACTIVE 구간을 {@code now}까지
     * 계산해 {@code currentSessionSecondsToday}·{@code totalSeconds}를 계속 부풀린다. 그 쓰기의 직렬화
     * 실패({@code 40001}) 처리는 {@code current}와 같다 — 409 {@code CONCURRENT_UPDATE}다.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW, isolation = Isolation.REPEATABLE_READ)
    public FocusSummaryView summary(UUID userId, String rawDate, String rawTimezone) {
        User user = userQueryService.getCaller(userId);
        validateTimezone(rawTimezone);
        Instant now = clock.instant();
        LocalDate date = resolveDate(rawDate, now);

        Instant dayStart = date.atStartOfDay(ZonePolicy.KST).toInstant();
        Instant dayEnd = date.plusDays(1).atStartOfDay(ZonePolicy.KST).toInstant();

        long completedSeconds = dailyFocusStatRepository.findByUserAndDate(user, date)
                .map(DailyFocusStat::getTotalFocusSeconds)
                .orElse(0);

        long currentSeconds = focusSessionDetailRepository
                .findFirstByUserIdAndLifecycleIn(userId, PROGRESSING)
                .filter(detail -> !abandonIfMarkerClosed(detail))
                .map(detail -> FocusIntervalMath.activeSecondsOverlapping(
                        focusSessionIntervalRepository.findBySessionIdOrderByOrdinalAsc(detail.getSessionId()),
                        now, dayStart, dayEnd))
                .orElse(0L);

        return new FocusSummaryView(date, completedSeconds, currentSeconds, completedSeconds + currentSeconds, now);
    }

    // ─────────────────────────────────────────────────────────────────────────

    /**
     * 전이 anchor — 서버 벽시계가 NTP 보정으로 <b>뒤로 간</b> 경우에도 직전 전이보다 이르지 않은 시각.
     *
     * <p>진행 중인 구간의 {@code startedAt}은 언제나 그 세션의 {@code lastTransitionAt}과 같은 값이다
     * (start·pause·resume이 둘을 같은 시각으로 전진시킨다). 그래서 {@code clock.instant()}가 그보다
     * 이르면 구간을 닫는 순간 V58의 {@code focus_session_intervals_order_ck}
     * ({@code ended_at >= started_at})를 위반해 정상 pause가 500이 된다 — 물러난 벽시계는 사용자 잘못이
     * 아니므로 여기서 앞으로 눌러 둔다(시간이 «흐르지 않은» 것으로 보이지, 음수로 흐르지는 않는다).
     *
     * <p>finish는 게이트가 열려 정산 전이를 쓰게 되는 날 같은 anchor를 쓴다 — 지금은 게이트 앞에서
     * 막혀 전이 자체가 없다.
     *
     * @param detail 이미 잠근 상세 행
     * @return {@code max(clock.instant(), detail.lastTransitionAt)}
     */
    private Instant transitionAnchor(FocusSessionDetail detail) {
        return clampToLastTransition(detail, clock.instant());
    }

    /** {@code max(candidate, detail.lastTransitionAt)} — 시각을 «되돌아가지 않게» 눌러 둔다. */
    private Instant clampToLastTransition(FocusSessionDetail detail, Instant candidate) {
        Instant last = detail.getLastTransitionAt();
        return last != null && last.isAfter(candidate) ? last : candidate;
    }

    /**
     * 상세를 공개 응답으로 옮긴다.
     *
     * <p><b>{@code serverNow}와 {@code activeSeconds}는 «같은» 시각을 기준으로 해야 한다.</b>
     * 응답의 계약이 「{@code serverNow} 시점의 누적 집중 초」이기 때문이다. 앞서 넘어온 {@code now}를
     * 그대로 돌려주면서 길이는 {@code clock.instant()}를 다시 읽어 계산하면, 초 경계나 지연이 끼는
     * 순간 두 값이 어긋난다 — 물러난 벽시계에서는 확실히 어긋난다.
     *
     * <p>그래서 시계를 다시 읽지 않고 <b>넘어온 {@code now}를 clamp</b>해 하나의 anchor를 만들고,
     * 그 anchor로 길이를 재고 그 anchor를 {@code serverNow}로 돌려준다. clamp는 그대로 필요하다 —
     * 열린 구간의 시작보다 이른 시각으로 재면 음수가 나간다.
     */
    private FocusSessionView toView(FocusSessionDetail detail, Instant now) {
        List<FocusSessionInterval> intervals = focusSessionIntervalRepository
                .findBySessionIdOrderByOrdinalAsc(detail.getSessionId());
        Instant anchor = clampToLastTransition(detail, now);
        long activeSeconds = FocusIntervalMath.activeSecondsAsOf(intervals, anchor);
        boolean paused = detail.getLifecycle() == FocusSessionLifecycle.PAUSED;
        return new FocusSessionView(detail.getSessionId(), detail.getIslandId(), detail.getSubject(),
                detail.getTargetMinutes(), paused ? FocusSessionView.STATUS_PAUSED : FocusSessionView.STATUS_ACTIVE,
                activeSeconds, anchor, FocusIntervalMath.sessionStartedAt(intervals),
                paused ? FocusIntervalMath.openRestStartedAt(intervals) : null, detail.getVersion());
    }

    /**
     * pause/resume/finish 의 공통 잠금 지점 — 활성 검증(사용자 공유 락) → 주인 확인 → 섬 행 배타 →
     * 활성 멤버십 공유 → 세션 상세 배타. activeAuthorization·replayAuthorization·명령 본문에서 반복
     * 호출해도 같은 트랜잭션 안 재잠금은 안전하다(1차 캐시가 같은 관리 엔티티를 돌려주고, 그 행은 이미
     * 이 트랜잭션이 쥐고 있어 그 사이 바뀔 수 없다).
     *
     * <p>멤버십은 LLD §2가 pause·resume에 "본인·<b>소속</b>·상태·version"으로 적어 둔 전제다. 없으면
     * 섬을 탈퇴·강퇴당한 사용자가 그 섬의 세션을 계속 전이시키고, 그 전이가 {@code focus.member.updated}·
     * {@code rest.member.updated}로 방송돼 <b>비소속자가 섬 화면에 계속 뜬다</b>. {@link #start}와 같은
     * 코드({@link FocusErrorCode#ISLAND_MEMBERSHIP_REQUIRED})로 거절한다.
     *
     * <p><b>잠금 순서</b>는 클래스 주석의 「섬·멤버십을 상세보다 먼저」다. 주인·섬은 잠그지 않는
     * 프로젝션으로 먼저 읽는다 — 상세 엔티티를 잠금 전에 올리면 뒤이은 {@code FOR UPDATE} 가 그 낡은
     * 인스턴스를 돌려줘, 기다리는 동안 커밋된 다른 전이를 못 본다.
     */
    private FocusSessionDetail authorizeSession(UUID userId, UUID sessionId) {
        requireActiveUser(userId);
        FocusSessionOwnership ownership = focusSessionDetailRepository.findOwnershipBySessionId(sessionId)
                .orElseThrow(() -> new FocusException(FocusErrorCode.SESSION_NOT_FOUND));
        // userId 를 왼쪽에 둔다 — 탈퇴 익명화로 detail.userId 가 null 인 행에 NPE 로 500 을 내지 않는다.
        if (!userId.equals(ownership.userId())) {
            throw new FocusException(FocusErrorCode.FORBIDDEN);
        }
        requireLockedMembership(userId, ownership.islandId());
        FocusSessionDetail detail = focusSessionDetailRepository.findBySessionIdForUpdate(sessionId)
                .orElseThrow(() -> new FocusException(FocusErrorCode.SESSION_NOT_FOUND));
        if (abandonIfMarkerClosed(detail)) {
            throw new FocusException(FocusErrorCode.SESSION_STATE_CONFLICT);
        }
        return detail;
    }

    /**
     * 섬 행 배타 → 그 섬의 활성 멤버십 공유 — 선행 조건 #8 의 잠금이다(클래스 주석 「잠금 순서」).
     *
     * <p>공유 락인 이유: 같은 섬 주민의 전이끼리는 이미 섬 행에서 줄을 서므로 멤버십 행을 배타로 잡을
     * 필요가 없고, 멤버십을 바꾸는 쪽(강퇴·탈퇴)은 이 행을 배타로 잡는다 — 내기 참여
     * ({@code GroupMemberRepository#findActiveByUserIdAndGroupIdForShare})와 같은 짝이다.
     *
     * @return 잠긴 활성 멤버십. 없으면 {@link FocusErrorCode#ISLAND_MEMBERSHIP_REQUIRED}
     */
    private GroupMember requireLockedMembership(UUID userId, UUID islandId) {
        membershipLocks.lockGroup(islandId);
        return groupMemberRepository.findActiveByUserIdAndGroupIdForShare(userId, islandId)
                .orElseThrow(() -> new FocusException(FocusErrorCode.ISLAND_MEMBERSHIP_REQUIRED));
    }

    /**
     * 불변식 검사·정리 — 「상세 lifecycle이 ACTIVE/PAUSED면 그 세션의 {@code focus_sessions.ended_at}은
     * null이어야 한다」. 진행 중 상세를 집는 세 지점(current·{@link #authorizeSession}·{@link #start})이
     * 전부 이걸 통과해야 한다.
     *
     * <p>깨지는 이유는 하나다 — 레거시 {@code FocusService.startFocusSession}이
     * {@code autoCloseOpenMarkersOf}로 그 사용자의 열린 마커를 조건 없이 전부 닫는다(v0.3 세션의
     * 기본 행 포함). 레거시는 고치지 않는다(1.x 앱 동작·「열린 마커 1개」 관례가 바뀐다) — 방어는
     * 새 경로인 여기서 한다.
     *
     * <p>{@code log.warn}으로 남기는 것은 필수다. 조용히 고치면 레거시·신규 경로가 한 사용자에게
     * 섞여 쓰이는 빈도를 아무도 알 수 없다.
     *
     * <p><b>한계</b>: {@link #authorizeSession} 경로에서는 곧바로 409를 던져 트랜잭션이 롤백되므로
     * 여기서 건 전이는 남지 않는다(경고 로그만 남는다). 실제로 커밋되는 정리는 {@code current}와
     * {@code start}가 한다 — 영구 500을 푸는 자리는 {@code start}고, 앱은 current를 늘 먼저 부른다.
     *
     * @param detail 진행 중일 수 있는 상세(호출측이 잠갔거나 잠그지 않았을 수 있다)
     * @return 어긋나 있어 {@code ABANDONED}로 내렸으면 {@code true}
     */
    private boolean abandonIfMarkerClosed(FocusSessionDetail detail) {
        if (!PROGRESSING.contains(detail.getLifecycle())) {
            return false;
        }
        Instant markerEndedAt = focusSessionRepository.findById(detail.getSessionId())
                .map(FocusSession::getEndedAt)
                .orElse(null);
        if (markerEndedAt == null) {
            return false;
        }
        log.warn("집중 세션 기본 마커가 바깥에서 닫혔습니다 — ABANDONED로 정리합니다. "
                        + "session={}, user={}, lifecycle={}, markerEndedAt={}",
                detail.getSessionId(), detail.getUserId(), detail.getLifecycle(), markerEndedAt);
        Instant t = transitionAnchor(detail);
        List<FocusSessionInterval> intervals = focusSessionIntervalRepository
                .findBySessionIdOrderByOrdinalAsc(detail.getSessionId());
        detail.applyAbandon(t);
        // 선행 조건 #9 — 정리된 세션을 그 섬의 focus/rest 목록에서 지운다. 안 보내면 휴식 중에 정리된
        // 사용자의 옛 restSeat 가 그 섬의 rest 투영에 영영 남는다. 세션이 끝났으니 리스도 지운다.
        appendFocusMemberEvent(detail.getUserId(), detail.getIslandId(), detail.getSessionId(), STATUS_ENDED,
                detail.getSubject(), FocusIntervalMath.activeSecondsAsOf(intervals, t), t, detail.getVersion());
        appendRestMemberEvent(detail.getUserId(), detail.getIslandId(), detail.getSessionId(), STATUS_ENDED,
                null, null, t, detail.getVersion());
        focusPresencePort.focusEnded(detail.getUserId(), detail.getSessionId());
        return true;
    }

    private static void requireLifecycle(FocusSessionDetail detail, FocusSessionLifecycle expected) {
        if (detail.getLifecycle() != expected) {
            throw new FocusException(FocusErrorCode.SESSION_STATE_CONFLICT);
        }
    }

    private static void requireVersion(FocusSessionDetail detail, long expectedVersion) {
        if (detail.getVersion() != expectedVersion) {
            throw new FocusException(FocusErrorCode.SESSION_STATE_CONFLICT);
        }
    }

    /** 활성 검증 + 공유 락(GROMO-1287 관례) — pause/resume/finish 전용. */
    private User requireActiveUser(UUID userId) {
        return userQueryService.getCallerForShare(userId);
    }

    /** 활성 검증 + 배타 락 — start 전용(아직 잠글 상세 행이 없다). */
    private User requireActiveUserForUpdate(UUID userId) {
        return userQueryService.getCallerForUpdate(userId);
    }

    private static int smallestFreeSeat(List<Integer> used) {
        Set<Integer> taken = new HashSet<>(used);
        int seat = 1;
        while (taken.contains(seat)) {
            seat++;
        }
        return seat;
    }

    private EventEnvelope appendFocusMemberEvent(UUID userId, UUID islandId, FocusSessionView view) {
        return appendFocusMemberEvent(userId, islandId, view.id(), view.status(), view.subject(),
                view.activeSeconds(), view.serverNow(), view.version());
    }

    private EventEnvelope appendFocusMemberEvent(UUID userId, UUID islandId, UUID sessionId, String status,
                                                 String subject, long activeSeconds, Instant serverNow,
                                                 long sessionVersion) {
        Map<String, Object> params = new LinkedHashMap<>();
        params.put("userId", userId.toString());
        params.put("sessionId", sessionId.toString());
        params.put("status", status);
        params.put("subject", subject);
        params.put("activeSeconds", activeSeconds);
        params.put("serverNow", serverNow.toString());
        params.put("sessionVersion", sessionVersion);
        return outboxCommandPort.append(new OutboxAppendCommand(UUID.randomUUID().toString(), 1,
                FOCUS_MEMBER_EVENT_TYPE, userId, null, userId.toString(),
                new AggregateRef(FOCUS_MEMBER_AGGREGATE_TYPE, islandId + ":" + userId), null, params,
                List.of(OutboxDeliveryRequest.toRealtime(FOCUS_MEMBER_EVENT_TYPE, null))));
    }

    private EventEnvelope appendRestMemberEvent(UUID userId, UUID islandId, UUID sessionId, String status,
                                                Instant restStartedAt, Integer restSeat, Instant serverNow,
                                                long sessionVersion) {
        // nullable 필드는 키를 유지한다(LLD §6) — active/completed 전이는 restStartedAt/restSeat=null로
        // "이 사용자를 rest 목록에서 지운다"를 나타낸다.
        Map<String, Object> params = new LinkedHashMap<>();
        params.put("userId", userId.toString());
        params.put("sessionId", sessionId.toString());
        params.put("status", status);
        params.put("restStartedAt", restStartedAt == null ? null : restStartedAt.toString());
        params.put("restSeat", restSeat);
        params.put("serverNow", serverNow.toString());
        params.put("sessionVersion", sessionVersion);
        return outboxCommandPort.append(new OutboxAppendCommand(UUID.randomUUID().toString(), 1,
                REST_MEMBER_EVENT_TYPE, userId, null, userId.toString(),
                new AggregateRef(REST_MEMBER_AGGREGATE_TYPE, islandId + ":" + userId), null, params,
                List.of(OutboxDeliveryRequest.toRealtime(REST_MEMBER_EVENT_TYPE, null))));
    }

    private static String validateSubject(String subject) {
        if (subject == null || subject.isBlank()) {
            throw new FocusException(FocusErrorCode.INVALID_SUBJECT);
        }
        String trimmed = subject.trim();
        if (trimmed.length() > MAX_SUBJECT_LENGTH) {
            throw new FocusException(FocusErrorCode.INVALID_SUBJECT);
        }
        return trimmed;
    }

    /** 0 이하만 거절한다 — 상한/카탈로그(FR-D06)는 아직 결정되지 않아 여기서 지어내지 않는다. */
    private static int validateTargetMinutes(Integer targetMinutes) {
        if (targetMinutes == null || targetMinutes <= 0) {
            throw new FocusException(FocusErrorCode.INVALID_TARGET_MINUTES);
        }
        return targetMinutes;
    }

    private static UUID requireIslandId(UUID islandId) {
        if (islandId == null) {
            throw new FocusException(FocusErrorCode.ISLAND_NOT_CURRENT);
        }
        return islandId;
    }

    private static long requireExpectedVersion(Long expectedVersion) {
        if (expectedVersion == null) {
            throw new FocusException(FocusErrorCode.EXPECTED_VERSION_REQUIRED);
        }
        return expectedVersion;
    }

    /** timezone 누락은 Asia/Seoul 기본, 명시 값은 정확히 그 값만 허용한다(policy.md). */
    private static void validateTimezone(String timezone) {
        if (timezone != null && !timezone.equals(ZonePolicy.KST.getId())) {
            throw new FocusException(FocusErrorCode.INVALID_SUMMARY_TIMEZONE);
        }
    }

    /** date 누락은 서버 KST 오늘, 구문 오류는 400, 실존하지 않는 날짜(2월 30일 등)는 422(policy.md). */
    private LocalDate resolveDate(String rawDate, Instant now) {
        if (rawDate == null) {
            return now.atZone(ZonePolicy.KST).toLocalDate();
        }
        if (!rawDate.matches("\\d{4}-\\d{2}-\\d{2}")) {
            throw new FocusException(FocusErrorCode.INVALID_SUMMARY_DATE);
        }
        try {
            return LocalDate.parse(rawDate);
        } catch (DateTimeException e) {
            throw new FocusException(FocusErrorCode.SUMMARY_DATE_OUT_OF_RANGE);
        }
    }

    private static JsonNode tree(Object value) {
        try {
            return OutboxEnvelopeCodec.fromJson(OutboxEnvelopeCodec.toJson(value), JsonNode.class);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("집중 세션 명령 직렬화 실패", e);
        }
    }

    private static <T> T decode(JsonNode data, Class<T> type) {
        try {
            return OutboxEnvelopeCodec.fromJson(data.toString(), type);
        } catch (JsonProcessingException e) {
            throw new OutboxException(OutboxErrorCode.IDEMPOTENT_REPLAY_FAILED);
        }
    }
}
