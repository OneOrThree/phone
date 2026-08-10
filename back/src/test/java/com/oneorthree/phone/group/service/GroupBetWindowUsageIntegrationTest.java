package com.oneorthree.phone.group.service;

import com.oneorthree.phone.common.support.IntegrationTestBase;
import com.oneorthree.phone.group.domain.Group;
import com.oneorthree.phone.group.domain.GroupBetStatus;
import com.oneorthree.phone.group.domain.GroupChallenge;
import com.oneorthree.phone.group.domain.GroupChallengeBet;
import com.oneorthree.phone.group.domain.GroupChallengeBetParticipant;
import com.oneorthree.phone.group.domain.GroupChallengeBetSession;
import com.oneorthree.phone.group.domain.GroupChallengeMember;
import com.oneorthree.phone.group.domain.GroupMember;
import com.oneorthree.phone.group.domain.GroupMemberRole;
import com.oneorthree.phone.group.domain.MissionCategory;
import com.oneorthree.phone.group.domain.MissionType;
import com.oneorthree.phone.group.dto.WindowUsageReportRequest;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.group.repository.GroupChallengeBetParticipantRepository;
import com.oneorthree.phone.group.repository.GroupChallengeBetRepository;
import com.oneorthree.phone.group.repository.GroupChallengeBetSessionRepository;
import com.oneorthree.phone.group.repository.GroupChallengeMemberRepository;
import com.oneorthree.phone.group.repository.GroupChallengeRepository;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.repository.UserRepository;
import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.IllegalTransactionStateException;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 창 사용분 보고(GROMO-1407) 통합 회귀 — 실 DB 로 자격의 <b>날짜 결속</b>(N43 · PR #573 codex ②)과
 * measured_at 단조(N34)를 끝까지 태운다:
 * <ul>
 *   <li>탈퇴자(멤버십 없음)가 <b>그 날짜의</b> 시작된 OPEN 회차 참가자면 보고가 성립한다</li>
 *   <li>오늘 회차 참가자가 <b>함께 예약한 미래 회차</b>에 낮은 값을 미리 심으려 하면 조용히 무시된다
 *       — 결속이 없던 시절의 선기록 구멍</li>
 *   <li>정산이 끝난 회차의 지연 도착 보고는 잠금 후 재확인에서 무시된다(정산 불가역)</li>
 *   <li>역전 보고는 저장값을 바꾸지 못하고, 같은 measuredAt 재전송은 멱등이다</li>
 *   <li><b>FR-9 양립</b>: 내기 없는 챌린지·미참가 멤버의 표시용 보고는 그대로 저장된다</li>
 * </ul>
 */
class GroupBetWindowUsageIntegrationTest extends IntegrationTestBase {

    @Autowired
    GroupBetWindowUsageService groupBetWindowUsageService;
    @Autowired
    GroupRepository groupRepository;
    @Autowired
    GroupMemberRepository groupMemberRepository;
    @Autowired
    GroupChallengeRepository groupChallengeRepository;
    @Autowired
    GroupChallengeBetRepository groupChallengeBetRepository;
    @Autowired
    GroupChallengeBetSessionRepository groupChallengeBetSessionRepository;
    @Autowired
    GroupChallengeBetParticipantRepository groupChallengeBetParticipantRepository;
    @Autowired
    GroupChallengeMemberRepository groupChallengeMemberRepository;
    @Autowired
    UserRepository userRepository;
    @Autowired
    EntityManager entityManager;
    @Autowired
    TransactionTemplate transactionTemplate;

    private static final ZoneId KST = ZoneId.of("Asia/Seoul");
    private static final LocalDate TODAY = LocalDate.now(KST);
    private static final LocalDate FUTURE = TODAY.plusDays(2);

    /** 내기가 걸린 창 챌린지 — 회차·참가가 붙는다(돈이 걸린 갈래). */
    private GroupChallenge betChallenge;
    /**
     * 내기가 꺼진 창 챌린지 — 회차가 아예 없다(FR-9 표시용 갈래). 같은 (카테고리, 타입) 활성
     * 챌린지는 그룹당 1개(V20 부분 유니크)라 별도 그룹에 둔다.
     */
    private GroupChallenge plainChallenge;

    private Group group;
    private Group plainGroup;
    private GroupChallengeBet config;
    private User member;      // 멤버 · 미참가 — 표시용 보고
    private User bettor;      // 멤버 · 오늘 참가 + 미래 예약
    private User leaver;      // 멤버십 없음 · 오늘 참가 — N43 최종 보고 경로
    private User stranger;    // 멤버십도 참가도 없음

    private final List<User> users = new ArrayList<>();
    private final List<GroupChallengeBetSession> sessions = new ArrayList<>();

    @BeforeEach
    void setUp() {
        group = groupRepository.save(Group.builder().name("보고자격").build());
        plainGroup = groupRepository.save(Group.builder().name("내기없는방").build());
        betChallenge = groupChallengeRepository.save(GroupChallenge.builder()
                .group(group).category(MissionCategory.SCREEN_TIME).type(MissionType.TIME_WINDOW).build());
        plainChallenge = groupChallengeRepository.save(GroupChallenge.builder()
                .group(plainGroup).category(MissionCategory.SCREEN_TIME).type(MissionType.TIME_WINDOW).build());
        config = groupChallengeBetRepository.save(GroupChallengeBet.builder()
                .group(group).challenge(betChallenge).stake(30).enabled(true).build());
        member = user("멤버", true);
        bettor = user("참가자", true);
        leaver = user("탈퇴자", false);
        stranger = user("외부인", false);
    }

    @AfterEach
    void tearDown() {
        for (LocalDate date : List.of(TODAY.minusDays(1), TODAY, FUTURE)) {
            groupChallengeMemberRepository.deleteAll(
                    groupChallengeMemberRepository.findByGroupChallengeIdInAndUsageDate(
                            List.of(betChallenge.getId(), plainChallenge.getId()), date));
        }
        sessions.forEach(s -> groupChallengeBetParticipantRepository
                .deleteAll(groupChallengeBetParticipantRepository.findBySessionIdIn(List.of(s.getId()))));
        groupChallengeBetSessionRepository.deleteAll(sessions);
        groupChallengeBetRepository.delete(config);
        groupChallengeRepository.deleteAll(List.of(betChallenge, plainChallenge));
        for (Group g : List.of(group, plainGroup)) {
            users.forEach(u -> groupMemberRepository.findAnyByUserAndGroup(u, g)
                    .ifPresent(groupMemberRepository::delete));
        }
        userRepository.deleteAll(users);
        groupRepository.deleteAll(List.of(group, plainGroup));
        users.clear();
        sessions.clear();
    }

    // ── 픽스처 ──────────────────────────────────────────────────────────

    private User user(String nickname, boolean withMembership) {
        User saved = userRepository.save(User.builder().nickname(nickname).isGuest(false).build());
        if (withMembership) {
            groupMemberRepository.save(GroupMember.builder()
                    .user(saved).group(group).role(GroupMemberRole.MEMBER).build());
            groupMemberRepository.save(GroupMember.builder()
                    .user(saved).group(plainGroup).role(GroupMemberRole.MEMBER).build());
        }
        users.add(saved);
        return saved;
    }

    private GroupChallengeBetSession session(LocalDate date, Instant startsAt, GroupBetStatus status) {
        Instant closesAt = date.plusDays(1).atStartOfDay(KST).toInstant();
        GroupChallengeBetSession saved = groupChallengeBetSessionRepository.save(
                GroupChallengeBetSession.builder()
                        .bet(config).group(group).challenge(betChallenge)
                        .sessionDate(date).stake(30).goalMinutes(90)
                        .missionCategory(betChallenge.getCategory())
                        .missionType(betChallenge.getType())
                        .windowStart(LocalTime.of(9, 0)).windowEnd(LocalTime.of(12, 0))
                        .status(status)
                        .startsAt(startsAt)
                        .joinClosesAt(closesAt).closesAt(closesAt).settleAfter(closesAt)
                        .settledAt(status == GroupBetStatus.OPEN ? null : Instant.now())
                        .build());
        sessions.add(saved);
        return saved;
    }

    /** 오늘 회차 — 이미 시작됐다(창 진행 중). */
    private GroupChallengeBetSession startedToday() {
        return session(TODAY, Instant.now().minusSeconds(3600), GroupBetStatus.OPEN);
    }

    /** join-week 로 예약된 미래 회차 — 아직 시작 전이다. */
    private GroupChallengeBetSession reservedFuture() {
        return session(FUTURE, Instant.now().plusSeconds(48 * 3600), GroupBetStatus.OPEN);
    }

    private void join(GroupChallengeBetSession session, User user) {
        groupChallengeBetParticipantRepository.save(
                GroupChallengeBetParticipant.builder().session(session).user(user).build());
    }

    private Optional<GroupChallengeMember> storedReport(GroupChallenge challenge, User user, LocalDate date) {
        // 네이티브 upsert 는 영속성 컨텍스트를 우회한다 — 캐시가 아니라 DB 를 본다.
        entityManager.clear();
        return groupChallengeMemberRepository
                .findByGroupChallengeIdInAndUsageDate(List.of(challenge.getId()), date).stream()
                .filter(row -> row.getUser().getId().equals(user.getId()))
                .findFirst();
    }

    /**
     * 참가 경로의 트랜잭션 경계를 재현한다 — 무효화는 참가 행 생성과 <b>원자</b>여야 해서
     * {@code MANDATORY} 로 트랜잭션을 요구한다(단독 호출은 계약 위반이라 예외다 — 아래 전용 테스트).
     */
    private void invalidateOnJoin(GroupChallengeBetSession session, User user) {
        transactionTemplate.executeWithoutResult(status ->
                groupBetWindowUsageService.invalidatePreJoinReport(session, user.getId()));
    }

    private WindowUsageReportRequest report(LocalDate date, int minutes, Instant measuredAt) {
        return new WindowUsageReportRequest(date, minutes, measuredAt);
    }

    private void reportBet(User user, WindowUsageReportRequest request) {
        groupBetWindowUsageService.reportWindowUsage(
                group.getId(), betChallenge.getId(), user.getId(), request);
    }

    // ── 자격의 날짜 결속 (codex ②) ────────────────────────────────────────

    @Test
    @DisplayName("예약된 미래 회차에 선기록 불가 — 오늘 참가자여도 시작 전 날짜 보고는 조용히 무시된다")
    void participantCannotPrePlantOnReservedFutureSession() {
        GroupChallengeBetSession today = startedToday();
        GroupChallengeBetSession future = reservedFuture();
        join(today, bettor);
        join(future, bettor);   // join-week 로 함께 예약 — 종전 구현이 자격을 열어주던 조합이다

        // 미래 회차 날짜에 0분을 미리 심으려는 보고 — 예외 없이(204) 저장만 되지 않는다
        reportBet(bettor, report(FUTURE, 0, Instant.now()));
        assertThat(storedReport(betChallenge, bettor, FUTURE)).isEmpty();

        // 같은 유저의 오늘(시작된 회차) 보고는 정상 저장된다 — 결속은 날짜별로만 닫힌다
        reportBet(bettor, report(TODAY, 45, Instant.now()));
        assertThat(storedReport(betChallenge, bettor, TODAY))
                .get().extracting(GroupChallengeMember::getProgressMinutes).isEqualTo(45);
        assertThat(future.getId()).isNotNull();
    }

    @Test
    @DisplayName("회차가 없는 미래 날짜에도 선기록 불가 — 이후 회차를 만들고 참가해도 값이 없다(codex ①)")
    void futureDateReportIsIgnoredEvenBeforeSessionExists() {
        // given: FUTURE 에는 회차가 아직 없다 — 회차 기준 게이트가 작동할 수 없는 자리다
        assertThat(groupChallengeBetSessionRepository
                .findByChallengeIdAndSessionDate(betChallenge.getId(), FUTURE)).isEmpty();

        // when: 미래 날짜에 0분을 미리 심으려는 보고(멤버 자격 — 표시용 갈래로 들어온다)
        reportBet(member, report(FUTURE, 0, Instant.now()));
        reportBet(bettor, report(FUTURE, 0, Instant.now()));

        // then: 저장되지 않는다
        assertThat(storedReport(betChallenge, member, FUTURE)).isEmpty();
        assertThat(storedReport(betChallenge, bettor, FUTURE)).isEmpty();

        // 그 뒤 그 날짜 회차가 생기고(레거시 createBet 은 보고보다 나중에 만들 수 있다) 참가해도
        // 정산이 주워 갈 선기록이 없다.
        GroupChallengeBetSession created = reservedFuture();
        join(created, bettor);
        assertThat(storedReport(betChallenge, bettor, FUTURE)).isEmpty();
    }

    @Test
    @DisplayName("미참가 멤버도 시작 전 회차에는 못 심는다 — '심어두고 창 시작 전에 참가' 우회 차단")
    void memberCannotPrePlantOnNotStartedSessionThenJoin() {
        GroupChallengeBetSession future = reservedFuture();   // 아직 시작 전 · member 는 미참가

        // 미참가 상태의 선기록 시도 — 표시용 갈래라도 시작 전이면 무시된다
        reportBet(member, report(FUTURE, 0, Instant.now()));
        assertThat(storedReport(betChallenge, member, FUTURE)).isEmpty();

        // 그 뒤 창 시작 전에 참가해도 심어둔 값이 없다 — 정산이 쓸 선기록 자체가 만들어지지 않는다
        join(future, member);
        reportBet(member, report(FUTURE, 0, Instant.now()));
        assertThat(storedReport(betChallenge, member, FUTURE)).isEmpty();
    }

    @Test
    @DisplayName("정산이 끝난 회차의 지연 도착 보고는 무시된다 — 잠금 후 OPEN 재확인(codex ①)")
    void reportOnSettledSessionIsIgnored() {
        GroupChallengeBetSession settled = session(
                TODAY, Instant.now().minusSeconds(7200), GroupBetStatus.SETTLED);
        join(settled, bettor);

        reportBet(bettor, report(TODAY, 10, Instant.now()));

        assertThat(storedReport(betChallenge, bettor, TODAY)).isEmpty();
    }

    // ── N43 탈퇴자 경로 + N34 단조 ────────────────────────────────────────

    @Test
    @DisplayName("탈퇴자 보고 성립(N43) — 그 날짜의 시작된 OPEN 회차 참가자는 멤버십 없이 보고하고, 역전·멱등이 지켜진다")
    void leaverReportsOnStartedOpenSessionWithMonotonicMeasuredAt() {
        GroupChallengeBetSession today = startedToday();
        join(today, leaver);
        Instant t1 = Instant.now().minusSeconds(600);
        Instant t2 = Instant.now().minusSeconds(60);

        // 최종 보고(t2)가 먼저 도착
        reportBet(leaver, report(TODAY, 95, t2));
        assertThat(storedReport(betChallenge, leaver, TODAY))
                .get().extracting(GroupChallengeMember::getProgressMinutes).isEqualTo(95);

        // 지연 도착한 낮은 옛 값(t1) — 조용히 204, 값 불변. finalize 후 덮어쓰기 구멍이 같은 비교로
        // 닫힌다(중간 보고의 measured_at 은 항상 최종 보고보다 오래됐다).
        reportBet(leaver, report(TODAY, 30, t1));
        GroupChallengeMember row = storedReport(betChallenge, leaver, TODAY).orElseThrow();
        assertThat(row.getProgressMinutes()).isEqualTo(95);
        assertThat(row.getMeasuredAt()).isEqualTo(t2);

        // 같은 measuredAt 재전송(재시도) — 멱등: 예외도 유실도 없다.
        reportBet(leaver, report(TODAY, 95, t2));
        assertThat(storedReport(betChallenge, leaver, TODAY))
                .get().extracting(GroupChallengeMember::getProgressMinutes).isEqualTo(95);
    }

    @Test
    @DisplayName("그 날짜에 참가도 멤버십도 없으면 MEMBER_ONLY — 미래 예약만으로는 오늘 자격이 없다")
    void nonMemberWithoutParticipationOnThatDateIsRejected() {
        GroupChallengeBetSession future = reservedFuture();
        join(future, leaver);   // 미래 예약만 있는 탈퇴자

        assertThatThrownBy(() -> reportBet(leaver, report(TODAY, 30, Instant.now())))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode").isEqualTo(GroupErrorCode.MEMBER_ONLY);

        assertThatThrownBy(() -> reportBet(stranger, report(TODAY, 30, Instant.now())))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode").isEqualTo(GroupErrorCode.MEMBER_ONLY);
    }

    // ── 참가 시 선기록 무효화 (PR #573 codex ③) ───────────────────────────

    @Test
    @DisplayName("창이 열린 뒤 미참가자가 심은 값은 참가 시점에 무효화된다 — 판정은 미보고로 떨어진다")
    void joiningInvalidatesReportsPlantedBeforeJoin() {
        GroupChallengeBetSession today = startedToday();

        // ① 창이 열린 뒤, 아직 참가하지 않은 멤버가 낮은 값을 먼저 보고한다 — 표시용이라 저장된다(FR-9)
        reportBet(member, report(TODAY, 0, Instant.now().minusSeconds(300)));
        assertThat(storedReport(betChallenge, member, TODAY))
                .get().extracting(GroupChallengeMember::getProgressMinutes).isEqualTo(0);

        // ② 그 뒤 참가한다(레거시 참가 경로는 창 종료까지 참가를 허용한다 — N36 브리지)
        invalidateOnJoin(today, member);
        join(today, member);

        // ③ 심어둔 값이 사라진다 — 정산이 읽을 행이 없으니 미보고 = 미달성(FR-21, 돈 안전 방향)
        assertThat(storedReport(betChallenge, member, TODAY)).isEmpty();

        // ④ 참가 이후의 정상 보고는 그대로 저장된다(참가자 게이트를 통과한다)
        reportBet(member, report(TODAY, 70, Instant.now()));
        assertThat(storedReport(betChallenge, member, TODAY))
                .get().extracting(GroupChallengeMember::getProgressMinutes).isEqualTo(70);
    }

    @Test
    @DisplayName("무효화는 그 (챌린지·유저·날짜)만 지운다 — 남의 보고·다른 날짜는 건드리지 않는다")
    void invalidationIsScopedToJoinedSessionOnly() {
        GroupChallengeBetSession today = startedToday();
        reportBet(member, report(TODAY, 11, Instant.now()));
        reportBet(bettor, report(TODAY, 22, Instant.now()));
        // 어제 날짜의 내 보고 — 다른 회차의 근거라 남아 있어야 한다
        groupChallengeMemberRepository.save(GroupChallengeMember.builder()
                .groupChallenge(betChallenge).user(member).usageDate(TODAY.minusDays(1))
                .progressMinutes(33).build());

        invalidateOnJoin(today, member);

        assertThat(storedReport(betChallenge, member, TODAY)).isEmpty();
        assertThat(storedReport(betChallenge, bettor, TODAY))
                .get().extracting(GroupChallengeMember::getProgressMinutes).isEqualTo(22);
        assertThat(storedReport(betChallenge, member, TODAY.minusDays(1)))
                .get().extracting(GroupChallengeMember::getProgressMinutes).isEqualTo(33);
    }

    @Test
    @DisplayName("무효화는 트랜잭션 밖에서 부를 수 없다(MANDATORY) — 참가 행 생성과 원자여야 한다")
    void invalidationRequiresCallerTransaction() {
        GroupChallengeBetSession today = startedToday();

        assertThatThrownBy(() -> groupBetWindowUsageService.invalidatePreJoinReport(today, member.getId()))
                .isInstanceOf(IllegalTransactionStateException.class);
    }

    // ── 보고 × 참가 동시성 (PR #573 잔여 경합) ─────────────────────────────

    /**
     * 참가 트랜잭션을 흉내 낸다 — {@code GroupBetService.stakeIn} 과 같은 순서(참가 행 생성 →
     * 무효화)로, 커밋 직전까지 잠금을 쥔 채 머문다.
     */
    private Future<?> joinTransactionHolding(ExecutorService pool, GroupChallengeBetSession session,
            User user, boolean insertParticipant, CountDownLatch lockHeld, long holdMillis,
            List<String> order) {
        return pool.submit(() -> transactionTemplate.executeWithoutResult(status -> {
            if (insertParticipant) {
                groupChallengeBetParticipantRepository.save(GroupChallengeBetParticipant.builder()
                        .session(session).user(user).build());
            }
            groupBetWindowUsageService.invalidatePreJoinReport(session, user.getId());
            lockHeld.countDown();
            try {
                Thread.sleep(holdMillis);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
            order.add("join-commit");
        }));
    }

    @Test
    @DisplayName("같은 축(챌린지·유저·날짜)의 보고는 무효화가 커밋될 때까지 기다린다 — advisory lock 직렬화")
    void reportWaitsWhileInvalidationHoldsTheSameAxisLock() throws Exception {
        GroupChallengeBetSession today = startedToday();
        List<String> order = Collections.synchronizedList(new ArrayList<>());
        CountDownLatch lockHeld = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Future<?> joinCall = joinTransactionHolding(pool, today, member, false, lockHeld, 700, order);
            assertThat(lockHeld.await(5, TimeUnit.SECONDS)).isTrue();

            // 잠금을 쥔 상태에서 같은 축의 보고를 넣는다 — 커밋 전에는 진행하지 못해야 한다.
            Future<?> reportCall = pool.submit(() -> {
                reportBet(member, report(TODAY, 0, Instant.now()));
                order.add("report-done");
            });
            joinCall.get(20, TimeUnit.SECONDS);
            reportCall.get(20, TimeUnit.SECONDS);
        } finally {
            pool.shutdownNow();
        }

        // 무효화 트랜잭션이 끝난 뒤에야 보고가 완료됐다 — "무효화 직후 커밋되는 선기록"이 불가능하다.
        assertThat(order).containsExactly("join-commit", "report-done");
    }

    @Test
    @DisplayName("다른 축(다른 유저)의 보고는 막히지 않는다 — 참가자 간 경합 없음(N34 저지연 유지)")
    void reportOnAnotherAxisIsNotBlocked() throws Exception {
        GroupChallengeBetSession today = startedToday();
        List<String> order = Collections.synchronizedList(new ArrayList<>());
        CountDownLatch lockHeld = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Future<?> joinCall = joinTransactionHolding(pool, today, member, false, lockHeld, 700, order);
            assertThat(lockHeld.await(5, TimeUnit.SECONDS)).isTrue();

            // 다른 유저의 보고 — 키가 달라 줄을 서지 않는다.
            Future<?> reportCall = pool.submit(() -> {
                reportBet(bettor, report(TODAY, 15, Instant.now()));
                order.add("report-done");
            });
            reportCall.get(20, TimeUnit.SECONDS);
            joinCall.get(20, TimeUnit.SECONDS);
        } finally {
            pool.shutdownNow();
        }

        assertThat(order).containsExactly("report-done", "join-commit");
        assertThat(storedReport(betChallenge, bettor, TODAY))
                .get().extracting(GroupChallengeMember::getProgressMinutes).isEqualTo(15);
    }

    @Test
    @DisplayName("참가(참가 행+무효화) × 보고 동시 실행 — 교착·예외 없이 끝나고 상태가 한쪽으로 확정된다")
    void concurrentJoinAndReportSettleWithoutDeadlock() throws Exception {
        GroupChallengeBetSession today = startedToday();
        List<String> order = Collections.synchronizedList(new ArrayList<>());
        CountDownLatch lockHeld = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            // 참가 행까지 넣는 진짜 참가 순서 — 보고 경로(advisory → 회차 행)와 잠금 순서가 반대라
            // 교착이 나면 여기서 드러난다.
            Future<?> joinCall = joinTransactionHolding(pool, today, member, true, lockHeld, 300, order);
            Future<?> reportCall = pool.submit(() -> {
                reportBet(member, report(TODAY, 0, Instant.now()));
                order.add("report-done");
            });
            joinCall.get(20, TimeUnit.SECONDS);
            reportCall.get(20, TimeUnit.SECONDS);
        } finally {
            pool.shutdownNow();
        }

        // 참가는 성립했고, 남은 보고 행이 있다면 그것은 무효화 <b>이후</b>에 참가자 게이트를 통과한
        // 값뿐이다(무효화 이전 값은 지워졌다). 둘 다 예외 없이 끝났다는 것이 이 테스트의 핵심이다.
        assertThat(groupChallengeBetParticipantRepository
                .existsBySessionIdAndUserId(today.getId(), member.getId())).isTrue();
        assertThat(order).contains("join-commit", "report-done");
    }

    // ── FR-9 양립 증명 ───────────────────────────────────────────────────

    @Test
    @DisplayName("FR-9 양립 — 내기 없는 챌린지(회차 없음)와 미참가 멤버의 표시용 보고는 그대로 저장된다")
    void displayOnlyReportsSurviveTheParticipantBinding() {
        // ① 내기가 꺼진 챌린지 — 회차가 아예 없다. 엄격 게이트였다면 여기서 죽는다.
        groupBetWindowUsageService.reportWindowUsage(
                plainGroup.getId(), plainChallenge.getId(), member.getId(),
                report(TODAY, 55, Instant.now()));
        assertThat(storedReport(plainChallenge, member, TODAY))
                .get().extracting(GroupChallengeMember::getProgressMinutes).isEqualTo(55);

        // ② 내기가 걸린 챌린지의 회차가 있어도, 참가하지 않은 멤버의 카드 진행률 보고는 통과한다
        //    (판정은 참가자만 대상이라 돈과 무관하다).
        GroupChallengeBetSession today = startedToday();
        join(today, bettor);
        groupBetWindowUsageService.reportWindowUsage(
                group.getId(), betChallenge.getId(), member.getId(),
                report(TODAY, 20, Instant.now()));
        assertThat(storedReport(betChallenge, member, TODAY))
                .get().extracting(GroupChallengeMember::getProgressMinutes).isEqualTo(20);
    }

    @Test
    @DisplayName("미래 measuredAt 은 참가·표시용 갈래 모두에서 INVALID_MEASURED_AT")
    void futureMeasuredAtIsRejectedOnBothBranches() {
        GroupChallengeBetSession today = startedToday();
        join(today, bettor);

        assertThatThrownBy(() -> reportBet(bettor, report(TODAY, 40, Instant.now().plusSeconds(180))))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode").isEqualTo(GroupErrorCode.INVALID_MEASURED_AT);
        assertThatThrownBy(() -> reportBet(member, report(TODAY, 40, Instant.now().plusSeconds(180))))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode").isEqualTo(GroupErrorCode.INVALID_MEASURED_AT);
    }
}
