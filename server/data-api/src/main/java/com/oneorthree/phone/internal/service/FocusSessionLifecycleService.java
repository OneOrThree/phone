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
import com.oneorthree.phone.focus.repository.FocusSessionOwnership;
import com.oneorthree.phone.focus.repository.FocusRewardAccrualRepository;
import com.oneorthree.phone.focus.repository.FocusRewardPolicyRepository;
import com.oneorthree.phone.focus.repository.FocusSessionRepository;
import com.oneorthree.phone.focus.repository.FocusSettlementRepository;
import com.oneorthree.phone.focus.repository.domain.DailyFocusStat;
import com.oneorthree.phone.focus.repository.domain.FocusIntervalKind;
import com.oneorthree.phone.focus.repository.domain.FocusRewardPolicy;
import com.oneorthree.phone.focus.repository.domain.FocusSession;
import com.oneorthree.phone.focus.repository.domain.FocusSessionDetail;
import com.oneorthree.phone.focus.repository.domain.FocusSessionInterval;
import com.oneorthree.phone.focus.repository.domain.FocusSessionLifecycle;
import com.oneorthree.phone.focus.repository.domain.FocusSettlement;
import com.oneorthree.phone.focus.repository.domain.FocusType;
import com.oneorthree.phone.focus.service.FocusPresenceProjection;
import com.oneorthree.phone.focus.support.FocusIntervalMath;
import com.oneorthree.phone.focus.support.FocusSessionStartGate;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.group.repository.domain.UserIslandContext;
import com.oneorthree.phone.group.service.GroupMembershipMutationLocks;
import com.oneorthree.phone.group.service.UserIslandContextLockService;
import com.oneorthree.phone.outbox.dto.EventEnvelope;
import com.oneorthree.phone.outbox.dto.PublicCommandRequest;
import com.oneorthree.phone.outbox.dto.PublicCommandResult;
import com.oneorthree.phone.outbox.exception.OutboxErrorCode;
import com.oneorthree.phone.outbox.exception.OutboxException;
import com.oneorthree.phone.outbox.service.PublicCommandService;
import com.oneorthree.phone.outbox.support.OutboxEnvelopeCodec;
import com.oneorthree.phone.user.repository.UserQueryService;
import com.oneorthree.phone.user.repository.domain.User;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Limit;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.DateTimeException;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.NavigableMap;
import java.util.Set;
import java.util.TreeSet;
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
 * <h2>게이트와 보상 정책</h2>
 * {@link #start}는 {@link FocusSessionStartGate}(배포 설정)를 가장 앞에서 보고, 현재 보상 정책
 * revision({@link FocusRewardPolicy})이 없으면 열지 않는다 — 정책 없는 세션을 시작시켰다가 finish 에서
 * 영구히 막는 일을 만들지 않는다(LLD §2 start). 세션은 시작한 revision 을 고정하고, {@link #finish}는 그
 * revision 으로 정산한다. revision 이 없는 세션(이 티켓 이전 행)의 finish 는
 * {@link FocusErrorCode#REWARD_POLICY_UNAVAILABLE} 이다 — 값을 지어내 「성공 정산」을 만들지 않는다.
 * 선행 조건 목록과 해소 근거는 {@link FocusSessionStartGate}의 javadoc에 있다.
 *
 * <h2>기본 마커 외부 종료 방어</h2>
 * 진행 중 상세를 집는 세 지점({@link #start}·{@link #current}·{@link #authorizeSession})은
 * {@link #abandonIfMarkerClosed}로 「상세가 진행 중이면 기본 {@code focus_sessions.ended_at}이 null」
 * 이라는 불변식을 되본다 — 레거시 start가 그 사용자의 열린 마커를 전부 닫기 때문이다. 그래서
 * {@link FocusSessionLifecycle#ABANDONED}는 지급 게이트와 무관하게 관측될 수 있다.
 *
 * <h2>휴식 1시간 자동 종료(GROMO-1998)</h2>
 * {@link #autoCloseTimedOutRest} 가 {@link #REST_AUTO_CLOSE_AFTER} 를 넘긴 휴식을
 * <b>{@code finish} 와 같은 {@link #settle}</b> 로 끝낸다 — 정책이 「정상 종료와 같게 집중 기록·퀘스트
 * 진행에 반영」이라고 정했으므로 별도 종결 경로를 만들지 않는다. 포기({@code ABANDONED})·소속 상실
 * ({@code MEMBERSHIP_LOST})과 달리 <b>정산 행이 남는다</b>. 그 결과는
 * {@link #pendingResult} 가 다음 접속에 돌려주고 {@link #acknowledgeResult} 가 한 번만 소비한다.
 */
@Service
@Slf4j
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class FocusSessionLifecycleService {

    private static final int MAX_SUBJECT_LENGTH = 200;

    /**
     * 휴식 자동 종료 유예 (GROMO-1998) — 정책 정본
     * ({@code planning-document/policy-2026-09-14.md} 「집중·휴식·도서관」)의
     * 「휴식하기를 누른 순간부터 1시간」이다. 세션 없이 방치된 마커를 회수하는 레거시
     * {@code FocusService.ORPHAN_TIMEOUT} 과 같은 결로 코드 상수에 둔다 — 보상 산식(60·480 등)과 달리
     * 운영이 흔드는 값이 아니라 제품 정책의 고정 수치다.
     */
    public static final Duration REST_AUTO_CLOSE_AFTER = Duration.ofHours(1);
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
    private final FocusRewardPolicyRepository focusRewardPolicyRepository;
    private final FocusSettlementRepository focusSettlementRepository;
    /** 적립 원장 — finish 는 여기서 합계를 <b>읽기만</b> 한다(GROMO-1990). 지갑은 아예 모른다. */
    private final FocusRewardAccrualRepository focusRewardAccrualRepository;
    /**
     * 종료 직전 적립 — 마지막 틱 이후에 «찬» 분을 확정한다(그 클래스 javadoc). 지급 계산은 전부 저쪽에
     * 있고 이 서비스는 결과 합만 정산 행에 옮긴다.
     */
    private final FocusRewardAccrualService rewardAccruals;
    /**
     * 섬 focus/rest 투영과 집중 프레즌스 리스를 <b>한 자리에서</b> 적는 포트(선행 조건 #5 ·
     * LLD §6 「하나의 Data projection 포트」, GROMO-2003). 레거시와 같은 포트·같은 키를 쓴다.
     *
     * <p>pause/resume 도 여기를 거친다 — 리스 값이 {@code active}/{@code paused} 를 구분하게 되면서
     * 휴식 전이도 반영돼야 값이 정본과 어긋나지 않기 때문이다. <b>키는 세션이 끝날 때까지 남으므로
     * 채팅 차단 판정은 그대로다</b>(휴식 중 채팅 허용은 미결 제품 결정 FR-D04 이고, 그 결정이 나면
     * 바뀌는 것은 읽는 쪽의 매핑이지 이 쓰기가 아니다).
     */
    private final FocusPresenceProjection focusPresenceProjection;
    private final Clock clock;

    /**
     * {@code POST /focus-sessions} — LLD §2 start.
     *
     * <p><b>가장 앞에서</b> {@link FocusSessionStartGate}를 본다 — 입력 검증보다도 먼저다. 게이트가 막는 한
     * 진행 행 자체가 생기지 않는다. 보상 정책 revision 이 없어도 같은 503 이다(클래스 주석).
     */
    @Transactional
    public FocusSessionView start(UUID userId, FocusSessionStartCommandRequest body, UUID idempotencyKey) {
        if (!startGate.isOpen()) {
            throw new FocusException(FocusErrorCode.SESSION_START_UNAVAILABLE);
        }
        String subject = validateSubject(body == null ? null : body.subject());
        Integer targetMinutes = validateTargetMinutes(body == null ? null : body.targetMinutes());
        UUID islandId = requireIslandId(body == null ? null : body.islandId());

        // targetMinutes 는 선택이라 null 일 수 있다 — Map.of 는 null 값을 못 담는다.
        Map<String, Object> fingerprint = new LinkedHashMap<>();
        fingerprint.put("islandId", islandId.toString());
        fingerprint.put("subject", subject);
        fingerprint.put("targetMinutes", targetMinutes);
        PublicCommandRequest command = new PublicCommandRequest(userId, "POST:/focus-sessions:" + userId,
                idempotencyKey, tree(fingerprint));
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
                    // 시작 시 정책 revision 을 고정한다(LLD §3) — 없으면 끝낼 때 정산할 근거가 없다.
                    FocusRewardPolicy policy = focusRewardPolicyRepository.findFirstByOrderByRevisionDesc()
                            .orElseThrow(() -> new FocusException(FocusErrorCode.SESSION_START_UNAVAILABLE));

                    Instant now = storedNow();
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
                            .policyRevision(policy.getRevision())
                            .build());
                    focusSessionIntervalRepository.save(FocusSessionInterval.builder()
                            .sessionId(session.getId())
                            .ordinal(1)
                            .kind(FocusIntervalKind.ACTIVE)
                            .startedAt(now)
                            .build());

                    FocusSessionView view = new FocusSessionView(session.getId(), islandId, subject, targetMinutes,
                            FocusSessionView.STATUS_ACTIVE, 0L, now, now, null, detail.getVersion());
                    // 순번은 INSERT 때 DB 시퀀스가 채운다(GROMO-1743) — 쓰기 지연을 여기서 내보내야 보인다.
                    focusSessionRepository.flush();
                    // 선행 조건 #9 — start 도 rest 투영을 내구화한다(LLD §6). active 는 「rest 목록에서
                    // 이 사용자를 지운다」라, 이전 세션이 남긴 옛 sessionId·restSeat 가 새 focus 상태와
                    // 함께 보이지 않는다. 리스 반영은 커밋 이후다(RedisFocusPresence) — 롤백된 start 는
                    // 리스를 남기지 않는다.
                    List<EventEnvelope> events = focusPresenceProjection.progressing(userId, islandId, view,
                            null, session.getPresenceOrder());
                    return new PublicCommandResult(201, tree(view), tree(events));
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
                    return new PublicCommandResult(200, tree(view), tree(focusPresenceProjection.progressing(
                            userId, detail.getIslandId(), view, restSeat, presenceOrderOf(sessionId))));
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
                    // active 전이는 rest 목록에서 제거를 뜻한다 — restStartedAt/restSeat=null(LLD §6).
                    return new PublicCommandResult(200, tree(view), tree(focusPresenceProjection.progressing(
                            userId, detail.getIslandId(), view, null, presenceOrderOf(sessionId))));
                }).value().data();
        return decode(data, FocusSessionView.class);
    }

    /**
     * {@code POST /focus-sessions/{sessionId}/finish} — LLD §2 finish. 선행 조건 #6.
     *
     * <p><b>finish 는 새로 «계산»하지 않는다</b>(GROMO-1990). 물고기는 진행 중에 매분 적립 틱
     * ({@link FocusRewardAccrualService})이 유효 집중 60초마다 섬 통장에 넣어 두었고, 여기서는 <b>마지막 틱
     * 이후에 찬 분만</b> 같은 적립 경로로 확정한 뒤 그 합을 정산 행에 옮겨 적는다. 1분이 안 찬 자투리는
     * 주지 않는다 — 그것이 「종료 시 추가 지급 없음」이다. 이미 찬 분을 버리는 뜻이 아니다.
     * 개인 지갑 적립 경로는 없다(D5-귀속-개정 — 섬 통장 100%, 재화는 섬 단일). 그래서 정산 행은
     * {@code P=0, C=E} 로 E=P+C 보존식만 유지한다.
     *
     * <p>한 TX 에서 열린 구간을 닫고 일 집계·기본 마커·정산 행·사건을 남긴다(FR-P09). 하루 상한(480)은
     * 적립 틱이 {@code focus_reward_accruals} 의 <b>UTC 날짜</b>(D8) 합으로 판정하며, 상한에 닿아도 집중
     * 기록(일 집계·activeSeconds)은 그대로 쌓인다(1830).
     *
     * <p><b>잠금 순서</b>(LLD §3): 사용자 공유 → 섬 행 → 멤버십 공유 → 상세 → 기본 마커 → 일 집계.
     * 지갑을 더 이상 여기서 건드리지 않으므로 종전의 「섬 건설 상태 → 섬 통장 → 개인 지갑」 구간이 빠졌다
     * (적립 틱이 상세 잠금 아래에서 같은 순서로 잡는다). 마커는 더티 체킹 flush 가 아니라 행 잠금
     * 조회로 «이 자리에서» 잡는다.
     *
     * <p><b>이미 완료된 세션을 새 키로 finish</b> 하면 정산 행의 원 결과를 그대로 돌려준다(LLD §2 도메인
     * 복구) — 새 원장·통계·사건을 만들지 않는다. 멤버십을 잃은 뒤에는 {@link #authorizeSession}이 먼저 403 이다.
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
                        FocusSettlement settled = focusSettlementRepository.findById(sessionId)
                                .orElseThrow(() -> new IllegalStateException(
                                        "정산 없는 COMPLETED 세션입니다 — 자동 재지급하지 않고 운영 복구한다"
                                                + "(LLD §2). session=" + sessionId));
                        return new PublicCommandResult(200, tree(finishView(detail, settled)), tree(List.of()));
                    }
                    requireProgressing(detail);
                    requireVersion(detail, expectedVersion);
                    FocusRewardPolicy policy = detail.getPolicyRevision() == null ? null
                            : focusRewardPolicyRepository.findById(detail.getPolicyRevision()).orElse(null);
                    if (policy == null) {
                        throw new FocusException(FocusErrorCode.REWARD_POLICY_UNAVAILABLE);
                    }
                    return settle(userId, detail, policy, false);
                }).value().data();
        return decode(data, FocusFinishView.class);
    }

    /**
     * 휴식 1시간 초과 자동 종료 (GROMO-1998) — 세션 하나를 <b>정상 완료</b>로 끝낸다.
     *
     * <p>정책({@code policy-2026-09-14.md} 「집중·휴식·도서관」)은 「휴식하기를 누른 순간부터 1시간이
     * 지나면 서버가 이번 집중을 자동 종료한다. <b>정상 종료와 같게</b> 집중 기록·퀘스트 진행에 반영하고,
     * 다음에 앱을 켤 때 결과창을 한 번 보여준다」이다. 그래서 {@code finish} 와 <b>같은</b>
     * {@link #settle} 을 부른다 — 일 집계·기본 마커·정산 행·focus/rest 사건·프레즌스 해제가 전부 같은
     * 경로로 나간다. 다른 것은 정산 행의 {@code autoClosed} 뿐이고, 그 표지가 「아직 안 보여 준 결과」를
     * 만든다({@link #pendingResult}). 물고기는 이미 섬 통장에 들어가 있어 따로 정산하지 않는다 —
     * {@code settle} 이 마지막 틱 이후에 «찬» 분만 확정하고 그 합을 옮겨 적는다(GROMO-1990).
     *
     * <p><b>잠금과 경합.</b> {@link #authorizeSession} 을 그대로 써서 전이와 <b>같은 순서</b>
     * (사용자 공유 → 섬 배타 → 멤버십 공유 → 상세 배타)로 잡는다 — 상세를 먼저 잠그면 {@code pause} 와
     * 교착한다. 스캔이 고른 뒤 잠그기까지 {@code resume}·{@code finish} 가 이길 수 있으므로
     * <b>잠근 뒤 다시 판정</b>한다: 여전히 {@code PAUSED} 이고 여전히 1시간을 넘겼을 때만 끝낸다.
     * 반대로 이 쪽이 이기면 뒤늦은 {@code resume} 은 {@code SESSION_STATE_CONFLICT}(409)를 본다 —
     * 어느 쪽이 이기든 세션은 정확히 한 번 종결된다.
     *
     * <p><b>도메인 거절은 실패가 아니다.</b> 소속 상실·마커 desync 처럼 {@link #authorizeSession} 이 거절하는
     * 세션은 여기서 고칠 수 있는 것이 아니라 사용자 요청 경로(current·start)가 정리한다 — 던져 올리면 매분
     * 에러 로그가 찍히고 {@link #abandonIfMarkerClosed} 가 이미 건 정리까지 롤백돼 다음 틱에 같은 일이
     * 되풀이된다. 그래서 {@link FocusException} 만 잡아 그 정리를 커밋하고 넘어간다. 그 밖의
     * {@code RuntimeException} 은 그대로 올려 호출측({@code FocusRestAutoCloseScheduler})이 건별로 잡는다.
     *
     * @param sessionId 종결 후보 세션
     * @return 실제로 종결했으면 {@code true}. 그 사이 사용자가 먼저 움직였으면 {@code false}
     */
    @Transactional
    public boolean autoCloseTimedOutRest(UUID sessionId) {
        // 주인·섬은 잠그지 않는 프로젝션으로 먼저 읽는다 — authorizeSession 의 전제와 같다.
        FocusSessionOwnership ownership = focusSessionDetailRepository.findOwnershipBySessionId(sessionId)
                .orElse(null);
        if (ownership == null || ownership.userId() == null) {
            return false;
        }
        FocusSessionDetail detail;
        try {
            detail = authorizeSession(ownership.userId(), sessionId);
        } catch (FocusException e) {
            // 여기서 «고칠» 수 있는 것이 아니다 — 소속을 잃었거나(강퇴 TX 가 이미 종결했다) 기본 마커가
            // 바깥에서 닫힌 세션이다. 둘 다 사용자 요청 경로가 처리한다. 예외를 밖으로 던지면 매분
            // 에러 로그가 찍히고 {@link #abandonIfMarkerClosed} 가 이미 건 정리까지 롤백돼 다음 틱에
            // 같은 일이 되풀이된다 — 잡아서 «그 정리를 커밋»하고 넘어간다(current 와 같은 결).
            log.info("휴식 자동 종료 대상이 아닙니다({}) — session={}, user={}",
                    e.getErrorCode(), sessionId, ownership.userId());
            return false;
        }
        if (detail.getLifecycle() != FocusSessionLifecycle.PAUSED
                || detail.getLastTransitionAt().isAfter(clock.instant().minus(REST_AUTO_CLOSE_AFTER))) {
            return false;
        }
        FocusRewardPolicy policy = detail.getPolicyRevision() == null ? null
                : focusRewardPolicyRepository.findById(detail.getPolicyRevision()).orElse(null);
        if (policy == null) {
            // finish 와 같은 판단이다 — 정책 없이 값을 지어내 「성공 정산」을 만들지 않는다. 다만 여기서는
            // 사용자가 보는 요청이 아니므로 409 를 던져 봐야 갈 곳이 없다: 로그로 남기고 운영이 복구한다.
            log.error("보상 정책이 없어 휴식 자동 종료를 건너뜁니다 — 운영 복구 필요. session={}, revision={}",
                    sessionId, detail.getPolicyRevision());
            return false;
        }
        settle(ownership.userId(), detail, policy, true);
        log.info("휴식 {}분 초과로 집중을 자동 종료했습니다(정상 완료). session={}, user={}",
                REST_AUTO_CLOSE_AFTER.toMinutes(), sessionId, ownership.userId());
        return true;
    }

    /**
     * {@code GET /focus-sessions/pending-result} (GROMO-1998) — 아직 안 보여 준 자동 종료 결과 <b>한 건</b>.
     *
     * <p>앱을 다시 켰을 때 결과창을 띄우는 자리다. 보여 준 뒤 {@link #acknowledgeResult} 를 부르지 않으면
     * 다음 접속에 또 온다 — <b>그게 의도다</b>. 네트워크가 끊기거나 앱이 죽어 결과창을 못 본 사용자에게
     * 「영영 못 받음」이 생기지 않게, 확인은 앱이 실제로 보여 준 뒤에만 남긴다.
     *
     * @param userId 조회 주체
     * @return 미확인 자동 종료 결과 중 가장 오래된 것. 없으면 {@code null}
     */
    @Transactional(readOnly = true)
    public FocusFinishView pendingResult(UUID userId) {
        userQueryService.getCaller(userId);
        return focusSettlementRepository.findUnacknowledgedAutoClosed(userId, Limit.of(1)).stream()
                .findFirst()
                .map(settlement -> finishView(focusSessionDetailRepository.findById(settlement.getSessionId())
                        .orElseThrow(() -> new IllegalStateException(
                                "정산은 있는데 상세가 없습니다 — session=" + settlement.getSessionId())),
                        settlement))
                .orElse(null);
    }

    /**
     * {@code POST /focus-sessions/{sessionId}/acknowledge} (GROMO-1998) — 결과창을 보여 줬다고 표시한다.
     *
     * <p>「한 번만」의 근거는 인메모리 플래그가 아니라 {@code acknowledged_at IS NULL} 조건부 UPDATE 다
     * ({@code FocusSettlementRepository#acknowledge}) — 재접속·동시 접속·재시도가 몇 번 오든 최초 1회만
     * 세팅되고 나머지는 0행 no-op 이다. 그래서 멱등 키가 필요 없다.
     *
     * <p>확인할 것이 없어도(이미 확인했거나 자동 종료가 아닌 세션) <b>성공</b>이다. 앱이 재시도하다
     * 에러를 보고 결과창을 다시 띄우는 것이 더 나쁘다. 다만 <b>남의 세션</b>은 거절한다 — 확인 시각은
     * 그 사람의 결과가 사라지는 부작용이다.
     *
     * @param userId    확인 주체
     * @param sessionId 확인할 세션
     */
    @Transactional
    public void acknowledgeResult(UUID userId, UUID sessionId) {
        userQueryService.getCaller(userId);
        FocusSessionOwnership ownership = focusSessionDetailRepository.findOwnershipBySessionId(sessionId)
                .orElseThrow(() -> new FocusException(FocusErrorCode.SESSION_NOT_FOUND));
        if (!userId.equals(ownership.userId())) {
            throw new FocusException(FocusErrorCode.FORBIDDEN);
        }
        focusSettlementRepository.acknowledge(sessionId, storedNow());
    }

    /**
     * finish·자동 종료의 공통 정산 — 호출측이 사용자·섬·멤버십·상세를 잠갔다.
     *
     * @param autoClosed 서버가 끝냈는가(GROMO-1998). 정산 행의 표지 하나만 갈리고 나머지는 전부 같다 —
     *                   정책이 「정상 종료와 같게」라고 정했기 때문이다
     */
    private PublicCommandResult settle(UUID userId, FocusSessionDetail detail, FocusRewardPolicy policy,
                                       boolean autoClosed) {
        UUID sessionId = detail.getSessionId();
        UUID islandId = detail.getIslandId();
        User user = requireActiveUser(userId);
        Instant t = transitionAnchor(detail);
        List<FocusSessionInterval> intervals = focusSessionIntervalRepository
                .findBySessionIdOrderByOrdinalAsc(sessionId);
        FocusIntervalMath.openInterval(intervals).ifPresent(open -> open.close(t));
        long activeSeconds = FocusIntervalMath.activeSecondsAsOf(intervals, t);
        FocusSession marker = focusSessionRepository.findByIdAndUserForUpdate(sessionId, user)
                .orElseThrow(() -> new IllegalStateException("상세는 있는데 기본 마커가 없습니다 — session=" + sessionId));

        // 마지막 틱 이후에 «찬» 분을 여기서 확정한다 — 구간을 닫은 뒤라 activeSeconds 와 같은 값을 본다.
        // 「종료 시 추가 지급 없음」은 자투리(1분이 안 찬 초)를 주지 않는다는 뜻이지, 이미 찬 분을 버린다는
        // 뜻이 아니다. 크론 게이트가 닫혀 있는 동안에는 이 호출이 그 세션의 «유일한» 지급 경로다.
        rewardAccruals.accrue(sessionId);
        // 그렇게 확정된 적립 합을 그대로 옮겨 적는다(GROMO-1990 — 여기서 새로 계산하지 않는다).
        int earned = Math.toIntExact(focusRewardAccrualRepository.sumEarnedFishOfSession(sessionId));

        // 일 집계는 KST 날짜 축(date-axis 규약)의 순수 초 — 목표 코인·스트릭 같은 레거시 부수효과는 붙이지
        // 않는다(LLD §4 「recordCompletion 을 그대로 호출해 코인 보너스를 중복 지급하지 않는다」).
        NavigableMap<LocalDate, Integer> secondsByDate =
                FocusIntervalMath.activeSecondsByDate(intervals, ZonePolicy.KST);
        recordDailyStats(user, secondsByDate, FocusIntervalMath.sessionStartedAt(intervals));
        Map<String, Integer> storedByDate = new LinkedHashMap<>();
        secondsByDate.forEach((date, seconds) -> storedByDate.put(date.toString(), seconds));
        marker.end(t, 0, t, storedByDate);
        detail.applyComplete(t);

        FocusSettlement settlement = focusSettlementRepository.save(FocusSettlement.builder()
                .sessionId(sessionId)
                .policyRevision(policy.getRevision())
                .activeSeconds(activeSeconds)
                .goalAchieved(goalAchieved(detail, activeSeconds))
                .earnedFish(earned)
                // 개인 몫은 언제나 0 이다(D5-귀속-개정 — 섬 통장 100%). E=P+C 보존식만 유지한다.
                .personalFishAdded(0)
                .constructionFishAdded(earned)
                .completedAt(t)
                // 서버가 끝낸 정산만 「아직 안 보여 준 결과」가 된다 — finish 는 응답으로 이미 돌려줬다.
                .autoClosed(autoClosed)
                .build());
        // 사건(projection 버전)은 잠금 순서의 맨 끝이다(LLD §3). 지갑 사건은 적립 틱이 그때그때 냈으므로
        // 여기서는 내지 않는다 — finish 는 잔액을 바꾸지 않는다.
        List<EventEnvelope> events = focusPresenceProjection.ended(userId, islandId, sessionId,
                detail.getSubject(), activeSeconds, t, detail.getVersion(), marker.getPresenceOrder());
        return new PublicCommandResult(200, tree(finishView(detail, settlement)), tree(events));
    }

    /**
     * 날짜별 순수 초를 일 집계에 더한다 — 세션 1건은 시작일에만 센다(레거시 recordCompletion 과 같은 관례).
     * 0초인 세션은 행을 만들지 않는다.
     */
    private void recordDailyStats(User user, NavigableMap<LocalDate, Integer> secondsByDate, Instant startedAt) {
        if (secondsByDate.isEmpty()) {
            return;
        }
        LocalDate startDate = startedAt.atZone(ZonePolicy.KST).toLocalDate();
        TreeSet<LocalDate> dates = new TreeSet<>(secondsByDate.keySet());
        dates.add(startDate);
        for (LocalDate date : dates) {
            int seconds = secondsByDate.getOrDefault(date, 0);
            int sessions = date.equals(startDate) ? 1 : 0;
            DailyFocusStat stat = dailyFocusStatRepository.findByUserAndDateForUpdate(user, date).orElse(null);
            if (stat == null) {
                dailyFocusStatRepository.save(DailyFocusStat.builder()
                        .user(user).date(date).totalFocusSeconds(seconds).sessionCount(sessions).build());
            } else {
                stat.setTotalFocusSeconds(Math.addExact(stat.getTotalFocusSeconds(), seconds));
                stat.setSessionCount(stat.getSessionCount() + sessions);
            }
        }
    }

    /** 목표가 없으면 달성도 없다(GROMO-1990 — 목표는 선택). */
    private static boolean goalAchieved(FocusSessionDetail detail, long activeSeconds) {
        return detail.getTargetMinutes() != null && activeSeconds >= detail.getTargetMinutes() * 60L;
    }

    private static FocusFinishView finishView(FocusSessionDetail detail, FocusSettlement settlement) {
        // 퀘스트 진행률은 1772/1773 계약이 아직 없어 이 세션이 기여한 퀘스트가 없다 — 빈 목록이 사실이다.
        return new FocusFinishView(detail.getSessionId(), detail.getIslandId(), detail.getSubject(),
                detail.getTargetMinutes(), settlement.getActiveSeconds(), settlement.isGoalAchieved(),
                settlement.getEarnedFish(),
                new FocusFinishView.Allocation(settlement.getPersonalFishAdded(),
                        settlement.getConstructionFishAdded()),
                settlement.getCompletedAt(), List.of());
    }

    private static void requireProgressing(FocusSessionDetail detail) {
        if (!PROGRESSING.contains(detail.getLifecycle())) {
            throw new FocusException(FocusErrorCode.SESSION_STATE_CONFLICT);
        }
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
     * <p>finish 와 소속 상실 종결도 같은 규칙을 쓴다.
     *
     * @param detail 이미 잠근 상세 행
     * @return {@code max(clock.instant(), detail.lastTransitionAt)}
     */
    private Instant transitionAnchor(FocusSessionDetail detail) {
        return clampToLastTransition(detail, storedNow());
    }

    /**
     * 저장할 시각 — {@code timestamptz} 정밀도(마이크로초)로 자른 서버 시각.
     *
     * <p>응답·사건에 싣는 시각과 DB 에 남는 시각이 같아야 한다. 리눅스 시계는 나노초를 주므로 자르지 않으면
     * 첫 finish 응답의 {@code completedAt} 과, 같은 세션을 새 키로 다시 finish 해 정산 행에서 읽은 값이
     * 어긋난다(LLD §2 「원 결과를 그대로」가 깨진다). pause 응답의 {@code restStartedAt} 과 뒤이은 current 도
     * 같은 이유다. 직전 전이(DB 에서 읽은 값)는 이미 마이크로초라 자른 값과 비교해도 역전이 생기지 않는다.
     */
    private Instant storedNow() {
        return clock.instant().truncatedTo(ChronoUnit.MICROS);
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
        // 스칼라로 읽는다 — finish 가 뒤에서 같은 마커를 FOR UPDATE 로 잡을 때 잠금 전 캐시가 남지 않게.
        Instant markerEndedAt = focusSessionRepository.findEndedAtById(detail.getSessionId()).orElse(null);
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
        focusPresenceProjection.ended(detail.getUserId(), detail.getIslandId(), detail.getSessionId(),
                detail.getSubject(), FocusIntervalMath.activeSecondsAsOf(intervals, t), t, detail.getVersion(),
                presenceOrderOf(detail.getSessionId()));
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

    /**
     * 프레즌스 리스의 순서 키 — 상세가 아니라 기본 마커({@code focus_sessions})에 있다.
     *
     * <p>스칼라로 읽는다 — 마커 엔티티를 잠금 전에 올리면 뒤이은 {@code FOR UPDATE} 가 그 낡은
     * 인스턴스를 돌려준다({@link #abandonIfMarkerClosed} 와 같은 이유).
     */
    private Long presenceOrderOf(UUID sessionId) {
        return focusSessionRepository.findPresenceOrderById(sessionId).orElse(null);
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

    /**
     * 목표는 <b>선택</b>이다(GROMO-1990) — 보상이 목표가 아니라 순수 집중 시간에만 걸리므로 목표 없이도
     * 시작할 수 있다. 값이 «있는데» 0 이하인 것만 거절한다 — 상한/카탈로그(FR-D06)는 아직 결정되지
     * 않아 여기서 지어내지 않는다.
     *
     * @return 목표 분. 요청에 없으면 {@code null}
     */
    private static Integer validateTargetMinutes(Integer targetMinutes) {
        if (targetMinutes != null && targetMinutes <= 0) {
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
