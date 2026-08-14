package com.oneorthree.phone.group.service;

import com.oneorthree.phone.common.support.IntegrationTestBase;
import com.oneorthree.phone.group.domain.Group;
import com.oneorthree.phone.group.domain.GroupBetStatus;
import com.oneorthree.phone.group.domain.GroupChallenge;
import com.oneorthree.phone.group.domain.GroupChallengeBet;
import com.oneorthree.phone.group.domain.GroupChallengeBetParticipant;
import com.oneorthree.phone.group.domain.GroupChallengeBetSession;
import com.oneorthree.phone.group.domain.MissionCategory;
import com.oneorthree.phone.group.domain.MissionType;
import com.oneorthree.phone.group.dto.ChallengeResultClaimResponse;
import com.oneorthree.phone.group.dto.MyChallengeResultResponse;
import com.oneorthree.phone.group.exception.ChallengeResultClaimHeldException;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.group.repository.GroupChallengeBetParticipantRepository;
import com.oneorthree.phone.group.repository.GroupChallengeBetRepository;
import com.oneorthree.phone.group.repository.GroupChallengeBetSessionRepository;
import com.oneorthree.phone.group.repository.GroupChallengeRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.notification.domain.NotificationSendStatus;
import com.oneorthree.phone.notification.domain.NotificationSentLog;
import com.oneorthree.phone.notification.repository.NotificationSentLogRepository;
import com.oneorthree.phone.notification.service.BetEventNotificationService;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.repository.UserRepository;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 결과 모달 표시 선점(claim) · 확인 표시(ack)의 통합 회귀 (GROMO-1577 · policy N58·B17 · IA §4.3).
 *
 * <p><b>실 DB 왕복으로만 검증한다</b> — 서비스를 서브클래싱해 리포지토리나 락을 스텁하면 동시성이
 * 전혀 검증되지 않는다(조건부 원자 UPDATE 가 하는 일이 정확히 그 부분이다). 잠그는 것:
 * <ol>
 *   <li>두 기기가 동시에 선점하면 <b>한쪽만</b> 성공한다(다른 쪽은 409 + 상대 지연)</li>
 *   <li><b>ack 가 끝난 회차의 선점은 거부</b>된다 — 리스가 만료돼도 마찬가지다(B17 원자성 ①)</li>
 *   <li>리스가 만료되면 <b>다른 기기가 회수</b>한다</li>
 *   <li>ack 는 <b>멱등</b> — 중복·동시 호출이 안전한 no-op, 토큰 불일치만 거절</li>
 *   <li>ack 가 <b>대기 중인 PENDING·DEFERRED 알림 클레임을 닫는다</b>(B17 원자성 ②)</li>
 *   <li><b>렌더 직전 재검증</b> — 정지됐다 깨어난 낡은 claimant 는 409 로 막히고, 현 소유자의
 *       재검증은 <b>같은 쓰기로 리스를 연장</b>한다(IA §4.3 TOCTOU)</li>
 *   <li><b>미확인 필터가 페이지 상한보다 먼저</b> 걸린다 — 확인된 10건이 상한을 채워도 11번째
 *       미확인 결과가 조회된다</li>
 *   <li><b>정산 전(OPEN) 회차는 선점·확인이 거부</b>된다 — 찍히면 나중에 정산된 그 결과를 어느
 *       기기에서도 못 본다</li>
 * </ol>
 */
class ChallengeResultAckIntegrationTest extends IntegrationTestBase {

    @Autowired
    ChallengeResultAckService challengeResultAckService;
    @Autowired
    GroupBetQueryService groupBetQueryService;
    @Autowired
    GroupRepository groupRepository;
    @Autowired
    GroupChallengeRepository groupChallengeRepository;
    @Autowired
    GroupChallengeBetRepository groupChallengeBetRepository;
    @Autowired
    GroupChallengeBetSessionRepository groupChallengeBetSessionRepository;
    @Autowired
    GroupChallengeBetParticipantRepository groupChallengeBetParticipantRepository;
    @Autowired
    NotificationSentLogRepository notificationSentLogRepository;
    @Autowired
    BetEventNotificationService betEventNotificationService;
    @Autowired
    UserRepository userRepository;

    private static final ZoneId KST = ZoneId.of("Asia/Seoul");
    private static final LocalDate TODAY = LocalDate.now(KST);
    private static final Instant NOW = Instant.parse("2026-08-14T05:00:00Z");
    private static final int STAKE = 30;

    private Group group;
    private GroupChallenge challenge;
    private GroupChallengeBet config;
    private User me;
    private User other;

    private final List<User> users = new ArrayList<>();
    private final List<GroupChallengeBetSession> sessions = new ArrayList<>();
    private final List<UUID> notificationRows = new ArrayList<>();

    @BeforeEach
    void setUp() {
        group = groupRepository.save(Group.builder().name("새벽반").build());
        challenge = groupChallengeRepository.save(GroupChallenge.builder()
                .group(group).category(MissionCategory.FOCUS).type(MissionType.DURATION).build());
        config = groupChallengeBetRepository.save(GroupChallengeBet.builder()
                .group(group).challenge(challenge).stake(STAKE).enabled(true).build());
        me = user("재영");
        other = user("남");
    }

    @AfterEach
    void tearDown() {
        if (!notificationRows.isEmpty()) {
            notificationSentLogRepository.deleteByIds(notificationRows);
        }
        sessions.forEach(s -> groupChallengeBetParticipantRepository
                .deleteAll(groupChallengeBetParticipantRepository.findBySessionIdIn(List.of(s.getId()))));
        groupChallengeBetSessionRepository.deleteAll(sessions);
        groupChallengeBetRepository.delete(config);
        groupChallengeRepository.delete(challenge);
        userRepository.deleteAll(users);
        groupRepository.delete(group);
        users.clear();
        sessions.clear();
        notificationRows.clear();
    }

    // ── ① 동시 선점 ─────────────────────────────────────────────────────

    @Test
    @DisplayName("두 기기가 동시에 선점하면 한쪽만 성공하고, 진 쪽은 409 + 상대 지연(retryAfterMs)을 받는다")
    void concurrentClaimsLetExactlyOneDeviceRender() throws Exception {
        GroupChallengeBetSession session = settledSession(TODAY.minusDays(1));
        joinSettled(session, me);
        CountDownLatch start = new CountDownLatch(1);
        AtomicInteger won = new AtomicInteger();
        AtomicInteger held = new AtomicInteger();
        List<Long> retryHints = java.util.Collections.synchronizedList(new ArrayList<>());

        List<CompletableFuture<Void>> devices = List.of(
                claimAsync(session.getId(), start, won, held, retryHints),
                claimAsync(session.getId(), start, won, held, retryHints));
        start.countDown();
        CompletableFuture.allOf(devices.toArray(new CompletableFuture[0])).get(20, TimeUnit.SECONDS);

        assertThat(won.get()).as("선점은 정확히 한 기기만 성공한다 — 둘 다 성공하면 같은 결과가 두 번 뜬다")
                .isEqualTo(1);
        assertThat(held.get()).isEqualTo(1);
        // 상대 지연이어야 한다 — 절대 만료 시각을 실으면 기기 시계 오차가 그대로 오작동이 된다.
        // 상한은 리스 수명이다: 진 쪽은 행 락을 기다린 만큼 자기 기준 시각이 낡아, 상한이 없으면
        // 승자의 claimed_at 과의 차가 수명을 넘어(실측 120,001ms) 재시도가 만료보다 뒤로 밀린다.
        assertThat(retryHints).hasSize(1);
        assertThat(retryHints.get(0))
                .isPositive()
                .isLessThanOrEqualTo(ChallengeResultAckService.DISPLAY_CLAIM_LEASE.toMillis());
    }

    private CompletableFuture<Void> claimAsync(UUID sessionId, CountDownLatch start,
            AtomicInteger won, AtomicInteger held, List<Long> retryHints) {
        return CompletableFuture.runAsync(() -> {
            try {
                start.await(10, TimeUnit.SECONDS);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return;
            }
            try {
                challengeResultAckService.claimDisplay(me.getId(), sessionId, null);
                won.incrementAndGet();
            } catch (ChallengeResultClaimHeldException e) {
                held.incrementAndGet();
                retryHints.add(e.getRetryAfterMs());
            }
        });
    }

    // ── ② ack 이후 선점 거부 ────────────────────────────────────────────

    @Test
    @DisplayName("ack 가 끝난 회차는 리스가 만료된 뒤에도 선점되지 않는다 — B17 원자성 ①")
    void claimIsRejectedAfterAcknowledge() {
        GroupChallengeBetSession session = settledSession(TODAY.minusDays(1));
        joinSettled(session, me);
        ChallengeResultClaimResponse claim = claimAt(session, NOW);
        challengeResultAckService.acknowledge(me.getId(), session.getId(), claim.claimToken(), NOW);

        // 리스는 이미 만료된 시각이다 — 회수 조건만 보면 통과하므로, 막는 것은 acknowledged_at 조건뿐이다.
        assertThatThrownBy(() -> claimAt(session, NOW.plusSeconds(600)))
                .isInstanceOf(GroupException.class)
                .extracting(e -> ((GroupException) e).getErrorCode())
                .isEqualTo(GroupErrorCode.RESULT_ALREADY_ACKED);

        // 재검증 경로에도 같은 조건이 들어 있다 — 확인이 끝난 뒤에는 내 토큰이어도 되살릴 수 없다.
        assertThatThrownBy(() -> renewAt(session, claim.claimToken(), NOW.plusSeconds(1)))
                .isInstanceOf(GroupException.class)
                .extracting(e -> ((GroupException) e).getErrorCode())
                .isEqualTo(GroupErrorCode.RESULT_ALREADY_ACKED);
    }

    // ── ③ 리스 만료 회수 ────────────────────────────────────────────────

    @Test
    @DisplayName("리스가 만료되면 다른 기기가 회수한다 — 만료 전에는 회수되지 않는다")
    void expiredLeaseIsReclaimable() {
        GroupChallengeBetSession session = settledSession(TODAY.minusDays(1));
        joinSettled(session, me);
        ChallengeResultClaimResponse first = claimAt(session, NOW);

        Instant beforeExpiry = NOW.plus(ChallengeResultAckService.DISPLAY_CLAIM_LEASE).minusSeconds(1);
        assertThatThrownBy(() -> claimAt(session, beforeExpiry))
                .isInstanceOf(ChallengeResultClaimHeldException.class);

        Instant afterExpiry = NOW.plus(ChallengeResultAckService.DISPLAY_CLAIM_LEASE).plusSeconds(1);
        ChallengeResultClaimResponse reclaimed = claimAt(session, afterExpiry);
        assertThat(reclaimed.claimToken()).isNotEqualTo(first.claimToken());

        // 재선점된 뒤에는 낡은 토큰의 ack 가 통하지 않는다 — 띄우지도 못한 결과를 삼키면 안 된다.
        assertThatThrownBy(() -> challengeResultAckService
                .acknowledge(me.getId(), session.getId(), first.claimToken(), afterExpiry))
                .isInstanceOf(GroupException.class)
                .extracting(e -> ((GroupException) e).getErrorCode())
                .isEqualTo(GroupErrorCode.RESULT_CLAIM_STALE);
    }

    // ── ⑧ 렌더 직전 재검증 ──────────────────────────────────────────────

    @Test
    @DisplayName("정지됐다 깨어난 기기의 재검증은 409 — 그 사이 리스가 만료돼 다른 기기가 재선점했다")
    void staleClaimantIsRejectedOnReverification() {
        GroupChallengeBetSession session = settledSession(TODAY.minusDays(1));
        joinSettled(session, me);
        // A 가 선점하고 렌더 전에 정지된다.
        ChallengeResultClaimResponse deviceA = claimAt(session, NOW);
        // 리스가 만료되고 B 가 회수해 지금 표시 중이다.
        Instant afterExpiry = NOW.plus(ChallengeResultAckService.DISPLAY_CLAIM_LEASE).plusSeconds(1);
        ChallengeResultClaimResponse deviceB = claimAt(session, afterExpiry);

        // A 가 깨어나 렌더 직전에 자기 선점을 확인한다 — 여기서 막혀야 두 기기가 함께 뜨지 않는다.
        assertThatThrownBy(() -> renewAt(session, deviceA.claimToken(), afterExpiry.plusSeconds(1)))
                .as("낡은 claimant 가 최초 성공 응답만 믿고 띄우면 두 기기가 모두 모달을 본다")
                .isInstanceOf(ChallengeResultClaimHeldException.class)
                .extracting(e -> ((ChallengeResultClaimHeldException) e).getRetryAfterMs())
                .isEqualTo(ChallengeResultAckService.DISPLAY_CLAIM_LEASE.toMillis() - 1000);

        // 현 소유자 B 의 재검증은 통과한다.
        assertThat(renewAt(session, deviceB.claimToken(), afterExpiry.plusSeconds(1)).claimToken())
                .isEqualTo(deviceB.claimToken());
    }

    @Test
    @DisplayName("재검증은 리스를 같은 쓰기로 연장한다 — 원래 만료 시각이 지나도 남이 못 가져간다")
    void reverificationExtendsLeaseAtomically() {
        GroupChallengeBetSession session = settledSession(TODAY.minusDays(1));
        joinSettled(session, me);
        UUID token = claimAt(session, NOW).claimToken();

        Instant renewedAt = NOW.plusSeconds(90);
        // 토큰은 회전시키지 않는다 — 갱신 응답이 유실돼도 앱이 든 토큰으로 ack 까지 갈 수 있어야 한다.
        assertThat(renewAt(session, token, renewedAt).claimToken()).isEqualTo(token);

        // 최초 선점 기준 만료(NOW + 2분)를 지난 시각 — 연장이 없었다면 회수됐어야 한다.
        Instant afterOriginalExpiry = NOW.plus(ChallengeResultAckService.DISPLAY_CLAIM_LEASE).plusSeconds(10);
        assertThatThrownBy(() -> claimAt(session, afterOriginalExpiry))
                .as("검증과 연장이 갈리면 모달이 마운트되기 전에 리스가 만료돼 다른 기기가 재선점한다")
                .isInstanceOf(ChallengeResultClaimHeldException.class);

        // 갱신 기준 만료(renewedAt + 2분) 뒤에는 정상적으로 회수된다.
        Instant afterRenewedExpiry = renewedAt.plus(ChallengeResultAckService.DISPLAY_CLAIM_LEASE).plusSeconds(1);
        assertThat(claimAt(session, afterRenewedExpiry).claimToken()).isNotEqualTo(token);
    }

    @Test
    @DisplayName("재검증 뒤 같은 토큰으로 ack 가 성사된다 — 토큰 회전이 ack 를 막지 않는다")
    void acknowledgeWorksWithTokenCarriedThroughReverification() {
        GroupChallengeBetSession session = settledSession(TODAY.minusDays(1));
        joinSettled(session, me);
        UUID token = claimAt(session, NOW).claimToken();
        UUID renewed = renewAt(session, token, NOW.plusSeconds(30)).claimToken();

        challengeResultAckService.acknowledge(me.getId(), session.getId(), renewed, NOW.plusSeconds(31));

        assertThat(acknowledgedAt(session)).isNotNull();
    }

    // ── ④ ack 멱등 ──────────────────────────────────────────────────────

    @Test
    @DisplayName("ack 는 멱등 — 중복·동시 호출이 안전한 no-op 이고 확인 시각은 최초 1회만 박힌다")
    void acknowledgeIsIdempotent() throws Exception {
        GroupChallengeBetSession session = settledSession(TODAY.minusDays(1));
        joinSettled(session, me);
        UUID token = claimAt(session, NOW).claimToken();

        CountDownLatch start = new CountDownLatch(1);
        List<CompletableFuture<Void>> callers = List.of(
                ackAsync(session.getId(), token, start),
                ackAsync(session.getId(), token, start));
        start.countDown();
        CompletableFuture.allOf(callers.toArray(new CompletableFuture[0])).get(20, TimeUnit.SECONDS);

        Instant acknowledgedAt = acknowledgedAt(session);
        assertThat(acknowledgedAt).isNotNull();
        // 대상 없음도 no-op — 참가하지 않은 유저의 ack 는 조용히 성공한다(멱등 계약).
        assertThatCode(() -> challengeResultAckService
                .acknowledge(other.getId(), session.getId(), token, NOW)).doesNotThrowAnyException();
        // 순차 중복 호출도 no-op — 확인 시각이 나중 호출로 덮이지 않는다.
        assertThatCode(() -> challengeResultAckService
                .acknowledge(me.getId(), session.getId(), token, NOW.plusSeconds(60)))
                .doesNotThrowAnyException();
        assertThat(acknowledgedAt(session)).isEqualTo(acknowledgedAt);
    }

    private CompletableFuture<Void> ackAsync(UUID sessionId, UUID token, CountDownLatch start) {
        return CompletableFuture.runAsync(() -> {
            try {
                start.await(10, TimeUnit.SECONDS);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return;
            }
            challengeResultAckService.acknowledge(me.getId(), sessionId, token, NOW);
        });
    }

    // ── ⑤ 대기 중인 알림 클레임 종결 ────────────────────────────────────

    @Test
    @DisplayName("ack 는 그 회차의 PENDING·DEFERRED BET_RESULT 클레임을 닫는다 — 남의 것·남의 회차는 그대로")
    void acknowledgeClosesPendingAndDeferredNotificationClaims() {
        GroupChallengeBetSession pendingSession = settledSession(TODAY.minusDays(1));
        GroupChallengeBetSession deferredSession = settledSession(TODAY.minusDays(2));
        GroupChallengeBetSession untouchedSession = settledSession(TODAY.minusDays(3));
        joinSettled(pendingSession, me);
        joinSettled(deferredSession, me);
        joinSettled(untouchedSession, me);
        UUID mine = pendingClaim(me, pendingSession);           // 슬롯이 아직 안 닫힌 클레임
        UUID deferred = deferredClaim(me, deferredSession);     // 조용한 시간 이월분(N44)
        UUID others = pendingClaim(other, pendingSession);      // 남의 클레임 — 건드리면 안 된다
        UUID untouched = pendingClaim(me, untouchedSession);    // 아직 확인 안 한 다른 회차

        ackFully(pendingSession);
        ackFully(deferredSession);

        assertThat(statusOf(mine)).as("이미 본 결과의 푸시가 나중에 도착하면 안 된다")
                .isEqualTo(NotificationSendStatus.SENT);
        assertThat(statusOf(deferred)).as("조용한 시간 이월분도 함께 닫는다")
                .isEqualTo(NotificationSendStatus.SENT);
        assertThat(statusOf(others)).as("내 ack 가 남의 알림을 삼키면 안 된다")
                .isEqualTo(NotificationSendStatus.PENDING);
        assertThat(statusOf(untouched)).as("확인하지 않은 회차의 알림은 그대로 나가야 한다")
                .isEqualTo(NotificationSendStatus.PENDING);
    }

    @Test
    @DisplayName("ack 뒤에 도착한 알림 클레임도 막힌다 — 리스너가 AFTER_COMMIT·@Async 라 ack 이 먼저 끝날 수 있다")
    void lateNotificationClaimIsSuppressedAfterAck() {
        GroupChallengeBetSession session = settledSession(TODAY.minusDays(1));
        joinSettled(session, me);

        // 클레임이 아직 하나도 없는 상태에서 사용자가 조회로 먼저 보고 확인한다.
        ackFully(session);

        // 그제야 리스너가 도착한다 — 프로덕션 배선(notifySessionClosed)을 그대로 부른다.
        // 15분 재훑기도 같은 claimEvent 를 타므로 억제 지점이 동일하다(전역 스캔이라 여기서는
        // 부르지 않는다 — 다른 테스트 데이터까지 훑어 발송을 시도한다).
        betEventNotificationService.notifySessionClosed(session.getId(), NOW.plusSeconds(5));

        NotificationSentLog row = notificationSentLogRepository
                .findByUserIdAndKindAndSubjectId(
                        me.getId(), NotificationSentLog.TYPE_BET_RESULT, session.getId())
                .orElseThrow();
        notificationRows.add(row.getId());
        assertThat(row.getStatus())
                .as("PENDING 이면 flush 가 그대로 발송한다 — 이미 본 결과의 푸시가 뒤늦게 도착한다")
                .isEqualTo(NotificationSendStatus.SENT);
        assertThat(notificationSentLogRepository.findByStatus(NotificationSendStatus.PENDING))
                .extracting(NotificationSentLog::getSubjectId)
                .doesNotContain(session.getId());
    }

    // ── 조회 병기 ───────────────────────────────────────────────────────

    @Test
    @DisplayName("조회는 미확인만 싣고 settledAt 을 병기한다 — 확인된 회차는 빠진다(N58)")
    void resultsCarryOnlyUnacknowledgedWithSettledAt() {
        GroupChallengeBetSession acked = settledSession(TODAY.minusDays(1));
        GroupChallengeBetSession unseen = settledSession(TODAY.minusDays(2));
        joinSettled(acked, me);
        joinSettled(unseen, me);
        ackFully(acked);

        List<MyChallengeResultResponse> results =
                groupBetQueryService.getMyChallengeResults(me.getId(), null, null).results();

        assertThat(results).extracting(MyChallengeResultResponse::getSessionId)
                .containsExactly(unseen.getId());
        assertThat(results.get(0).isAcknowledged()).as("미확인만 실리므로 계약 필드는 항상 false").isFalse();
        assertThat(results.get(0).getSettledAt()).isNotNull();
    }

    @Test
    @DisplayName("확인된 결과가 상한(10건)을 채워도 11번째 미확인 결과가 조회된다 — 상한이 ack 보다 먼저 걸리는 데드락")
    void unacknowledgedResultSurvivesPageLimitFilledByAckedOnes() {
        // 가장 오래된 1건이 미확인 — 확인된 10건이 앞자리(최신순)를 전부 차지한다.
        GroupChallengeBetSession oldestUnseen = settledSession(TODAY.minusDays(11));
        joinSettled(oldestUnseen, me);
        for (int day = 1; day <= 10; day++) {
            GroupChallengeBetSession acked = settledSession(TODAY.minusDays(day));
            joinSettled(acked, me);
            ackFully(acked);
        }

        List<MyChallengeResultResponse> results =
                groupBetQueryService.getMyChallengeResults(me.getId(), null, null).results();

        assertThat(results).extracting(MyChallengeResultResponse::getSessionId)
                .as("미확인 필터가 limit 뒤에 오면 이 결과는 영영 조회되지 않는다")
                .containsExactly(oldestUnseen.getId());
    }

    // ── 정산 전 회차 차단 ───────────────────────────────────────────────

    @Test
    @DisplayName("정산 전(OPEN) 회차는 선점·확인이 모두 거부되고 행이 그대로다 — 나중에 정산된 결과를 잃지 않는다")
    void openSessionCannotBeClaimedOrAcknowledged() {
        GroupChallengeBetSession open = openSession(TODAY);
        join(open, me);   // 참가 행은 있다 — 앱이 /me/bet-sessions 로 이 회차 id 를 들고 있다

        assertThatThrownBy(() -> claimAt(open, NOW))
                .isInstanceOf(GroupException.class)
                .extracting(e -> ((GroupException) e).getErrorCode())
                .isEqualTo(GroupErrorCode.RESULT_NOT_SETTLED);
        assertThatThrownBy(() -> challengeResultAckService
                .acknowledge(me.getId(), open.getId(), UUID.randomUUID(), NOW))
                .isInstanceOf(GroupException.class)
                .extracting(e -> ((GroupException) e).getErrorCode())
                .isEqualTo(GroupErrorCode.RESULT_NOT_SETTLED);

        GroupChallengeBetParticipant participant = groupChallengeBetParticipantRepository
                .findBySessionIdAndUserId(open.getId(), me.getId()).orElseThrow();
        assertThat(participant.getAcknowledgedAt())
                .as("정산 전에 확인 표시가 찍히면 그 회차가 정산됐을 때 어느 기기에서도 안 뜬다").isNull();
        assertThat(participant.getDisplayClaimedAt()).isNull();
        assertThat(participant.getDisplayClaimToken()).isNull();
    }

    // ── 픽스처 ──────────────────────────────────────────────────────────

    private User user(String nickname) {
        User saved = userRepository.save(User.builder().nickname(nickname).isGuest(false).build());
        users.add(saved);
        return saved;
    }

    private GroupChallengeBetSession settledSession(LocalDate date) {
        return sessionOn(date, GroupBetStatus.SETTLED);
    }

    /** 정산 전 회차 — 앱은 {@code /me/bet-sessions} 로 이 회차 id 도 들고 있다. */
    private GroupChallengeBetSession openSession(LocalDate date) {
        return sessionOn(date, GroupBetStatus.OPEN);
    }

    private GroupChallengeBetSession sessionOn(LocalDate date, GroupBetStatus status) {
        Instant startsAt = date.atStartOfDay(KST).toInstant();
        Instant closesAt = date.plusDays(1).atStartOfDay(KST).toInstant();
        GroupChallengeBetSession saved = groupChallengeBetSessionRepository.save(
                GroupChallengeBetSession.builder()
                        .bet(config).group(group).challenge(challenge)
                        .sessionDate(date).stake(STAKE).goalMinutes(90)
                        .missionCategory(challenge.getCategory())
                        .missionType(challenge.getType())
                        .status(status)
                        .startsAt(startsAt)
                        .joinClosesAt(closesAt).closesAt(closesAt).settleAfter(closesAt)
                        .settledAt(status == GroupBetStatus.OPEN ? null : Instant.now())
                        .build());
        sessions.add(saved);
        return saved;
    }

    private void joinSettled(GroupChallengeBetSession session, User user) {
        GroupChallengeBetParticipant participant = groupChallengeBetParticipantRepository.save(
                GroupChallengeBetParticipant.builder().session(session).user(user).build());
        participant.recordSettlement(true, STAKE, 120);
        groupChallengeBetParticipantRepository.save(participant);
    }

    /** 참가만 — 정산 판정 없음(OPEN 회차의 정상 상태). */
    private void join(GroupChallengeBetSession session, User user) {
        groupChallengeBetParticipantRepository.save(
                GroupChallengeBetParticipant.builder().session(session).user(user).build());
    }

    /** 선점 → ack 한 벌 — 앱의 순서(D8: slot → 선점 → 검증 → 노출 → ack)를 그대로 따른다. */
    private void ackFully(GroupChallengeBetSession session) {
        UUID token = claimAt(session, NOW).claimToken();
        challengeResultAckService.acknowledge(me.getId(), session.getId(), token, NOW);
    }

    /** 최초 획득 — 바디 없는 호출(토큰 null)과 같은 경로다. */
    private ChallengeResultClaimResponse claimAt(GroupChallengeBetSession session, Instant now) {
        return challengeResultAckService.claimDisplay(me.getId(), session.getId(), null, now);
    }

    /** 렌더 직전 재검증 + 리스 연장 — 바디에 내 토큰을 실은 호출. */
    private ChallengeResultClaimResponse renewAt(
            GroupChallengeBetSession session, UUID token, Instant now) {
        return challengeResultAckService.claimDisplay(me.getId(), session.getId(), token, now);
    }

    private Instant acknowledgedAt(GroupChallengeBetSession session) {
        return groupChallengeBetParticipantRepository
                .findBySessionIdAndUserId(session.getId(), me.getId())
                .map(GroupChallengeBetParticipant::getAcknowledgedAt)
                .orElse(null);
    }

    private UUID pendingClaim(User user, GroupChallengeBetSession session) {
        UUID rowId = UUID.randomUUID();
        notificationSentLogRepository.insertPendingClaim(rowId, user.getId(),
                NotificationSentLog.TYPE_BET_RESULT, session.getId(), group.getId(), NOW, NOW);
        notificationRows.add(rowId);
        return rowId;
    }

    private UUID deferredClaim(User user, GroupChallengeBetSession session) {
        UUID rowId = pendingClaim(user, session);
        notificationSentLogRepository.updateStatusByIds(
                List.of(rowId), NotificationSendStatus.DEFERRED, null);
        return rowId;
    }

    private NotificationSendStatus statusOf(UUID rowId) {
        return notificationSentLogRepository.findById(rowId)
                .map(NotificationSentLog::getStatus)
                .orElse(null);
    }
}
