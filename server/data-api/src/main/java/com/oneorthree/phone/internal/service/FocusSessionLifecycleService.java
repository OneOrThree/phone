package com.oneorthree.phone.internal.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
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
import com.oneorthree.phone.group.repository.GroupQueryService;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.group.repository.domain.UserIslandContext;
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
 * 그 행을 배타 잠근다(레거시 {@code endFocusSession}과 같은 결). 이어서 섬/현재 membership·context
 * ({@link UserIslandContextLockService}·{@link GroupQueryService#getGroupForUpdate}) → 상세/구간
 * 순으로 잠근다. 이 6종은 전부 단일 사용자·단일 세션 스코프라, LLD의 "영향 사용자 UUID 정렬" 다중
 * 사용자 정렬 규칙과 회차/시설/지갑 단계는 해당하지 않는다(그 경로는 강퇴·정산 같은 교차 기능이며
 * 이 티켓 범위 밖이다).
 *
 * <h2>지급 비활성 게이트</h2>
 * {@link #finish}는 유효성 검사를 전부 통과해도 {@link FocusRewardPolicyGate#isOpen()}이 닫혀 있으면
 * {@link FocusErrorCode#REWARD_POLICY_UNAVAILABLE}로 막는다 — policy.md가 "정책 없을 때 성공 정산
 * receipt를 만들지 않는다"고 정했다. 게이트가 열리기 전까지 세션은 active/paused만 관측되고
 * completed에 닿지 않는다.
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
    /** 「진행 중」으로 보는 lifecycle — 사용자당 최대 1건(V58 부분 UNIQUE)이 걸리는 집합 그대로다. */
    private static final List<FocusSessionLifecycle> PROGRESSING =
            List.of(FocusSessionLifecycle.ACTIVE, FocusSessionLifecycle.PAUSED);

    private final UserQueryService userQueryService;
    private final GroupQueryService groupQueryService;
    private final UserIslandContextLockService userIslandContextLockService;
    private final FocusSessionRepository focusSessionRepository;
    private final FocusSessionDetailRepository focusSessionDetailRepository;
    private final FocusSessionIntervalRepository focusSessionIntervalRepository;
    private final DailyFocusStatRepository dailyFocusStatRepository;
    private final PublicCommandService publicCommands;
    private final OutboxCommandPort outboxCommandPort;
    private final Clock clock;

    /** {@code POST /focus-sessions} — LLD §2 start. */
    @Transactional
    public FocusSessionView start(UUID userId, FocusSessionStartCommandRequest body, UUID idempotencyKey) {
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
                    Group island = groupQueryService.getGroup(islandId);
                    GroupMember membership = groupQueryService.findMembership(user, island)
                            .orElseThrow(() -> new FocusException(FocusErrorCode.ISLAND_MEMBERSHIP_REQUIRED));

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
                    return new PublicCommandResult(201, tree(view), tree(List.of(event)));
                }).value().data();
        return decode(data, FocusSessionView.class);
    }

    /**
     * {@code GET /focus-sessions/current} — LLD §2 session. 본인만, 명령이 아니라 단일 snapshot 조회.
     *
     * <p>조회인데도 {@code readOnly}가 아닌 것은 의도다 — {@link #abandonIfMarkerClosed}가 어긋난 행을
     * 그 자리에서 종결하고, 그 쓰기가 실제로 커밋돼야 다음 start가 풀린다(readOnly면 flush 자체가 없다).
     */
    @Transactional
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

                    Instant now = clock.instant();
                    List<FocusSessionInterval> intervals = focusSessionIntervalRepository
                            .findBySessionIdOrderByOrdinalAsc(sessionId);
                    FocusSessionInterval open = FocusIntervalMath.openInterval(intervals)
                            .orElseThrow(() -> new IllegalStateException(
                                    "active 세션에 열린 ACTIVE 구간이 없습니다 — session=" + sessionId));
                    open.close(now);

                    // 섬 잠금 아래 빈 최소 자리를 배정한다 — 동시 pause 두 건이 같은 자리를 받지 않게(LLD §2).
                    groupQueryService.getGroupForUpdate(detail.getIslandId());
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

                    Instant now = clock.instant();
                    List<FocusSessionInterval> intervals = focusSessionIntervalRepository
                            .findBySessionIdOrderByOrdinalAsc(sessionId);
                    FocusSessionInterval open = FocusIntervalMath.openInterval(intervals)
                            .orElseThrow(() -> new IllegalStateException(
                                    "paused 세션에 열린 REST 구간이 없습니다 — session=" + sessionId));
                    open.close(now);

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
     * currentSessionSecondsToday(진행 세션 구간)를 같은 트랜잭션의 두 조회로 읽는다 — 종료 TX와 겹친 GET의
     * 이중 계산 회피는 REPEATABLE READ가 아니라 두 조회 사이 창이 매우 좁다는 완화다(ponytail, 아래 참고).
     */
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
                .map(detail -> FocusIntervalMath.activeSecondsOverlapping(
                        focusSessionIntervalRepository.findBySessionIdOrderByOrdinalAsc(detail.getSessionId()),
                        now, dayStart, dayEnd))
                .orElse(0L);

        return new FocusSummaryView(date, completedSeconds, currentSeconds, completedSeconds + currentSeconds, now);
    }

    // ─────────────────────────────────────────────────────────────────────────

    private FocusSessionView toView(FocusSessionDetail detail, Instant now) {
        List<FocusSessionInterval> intervals = focusSessionIntervalRepository
                .findBySessionIdOrderByOrdinalAsc(detail.getSessionId());
        long activeSeconds = FocusIntervalMath.activeSecondsAsOf(intervals, now);
        boolean paused = detail.getLifecycle() == FocusSessionLifecycle.PAUSED;
        return new FocusSessionView(detail.getSessionId(), detail.getIslandId(), detail.getSubject(),
                detail.getTargetMinutes(), paused ? FocusSessionView.STATUS_PAUSED : FocusSessionView.STATUS_ACTIVE,
                activeSeconds, now, FocusIntervalMath.sessionStartedAt(intervals),
                paused ? FocusIntervalMath.openRestStartedAt(intervals) : null, detail.getVersion());
    }

    /**
     * 활성 검증(공유 락) + 세션 상세 배타 락 + 소유 검사 — pause/resume/finish의 공통 잠금 지점.
     * activeAuthorization·replayAuthorization·명령 본문에서 반복 호출해도 같은 트랜잭션 안 재잠금은
     * 안전하다(1차 캐시가 같은 관리 엔티티를 돌려준다).
     */
    private FocusSessionDetail authorizeSession(UUID userId, UUID sessionId) {
        requireActiveUser(userId);
        FocusSessionDetail detail = focusSessionDetailRepository.findBySessionIdForUpdate(sessionId)
                .orElseThrow(() -> new FocusException(FocusErrorCode.SESSION_NOT_FOUND));
        if (!detail.getUserId().equals(userId)) {
            throw new FocusException(FocusErrorCode.FORBIDDEN);
        }
        if (abandonIfMarkerClosed(detail)) {
            throw new FocusException(FocusErrorCode.SESSION_STATE_CONFLICT);
        }
        return detail;
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
        detail.applyAbandon(clock.instant());
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
        Map<String, Object> params = new LinkedHashMap<>();
        params.put("userId", userId.toString());
        params.put("sessionId", view.id().toString());
        params.put("status", view.status());
        params.put("subject", view.subject());
        params.put("activeSeconds", view.activeSeconds());
        params.put("serverNow", view.serverNow().toString());
        params.put("sessionVersion", view.version());
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
