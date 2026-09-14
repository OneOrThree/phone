package com.oneorthree.phone.notification.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.oneorthree.phone.common.exception.GlobalExceptionHandler;
import com.oneorthree.phone.group.dto.CreateChallengeRequest;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupBetStatus;
import com.oneorthree.phone.group.repository.domain.GroupBetVoidReason;
import com.oneorthree.phone.group.repository.domain.GroupChallenge;
import com.oneorthree.phone.group.repository.domain.GroupChallengeBet;
import com.oneorthree.phone.group.repository.domain.GroupChallengeBetParticipant;
import com.oneorthree.phone.group.repository.domain.GroupChallengeBetSession;
import com.oneorthree.phone.group.repository.domain.GroupChallengeDuration;
import com.oneorthree.phone.group.repository.domain.GroupChallengeWindow;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.group.repository.domain.GroupMemberRole;
import com.oneorthree.phone.group.repository.domain.MissionCategory;
import com.oneorthree.phone.group.repository.domain.MissionType;
import com.oneorthree.phone.group.service.GroupBetSettler;
import com.oneorthree.phone.group.service.GroupChallengeService;
import com.oneorthree.phone.notification.producer.NotificationEventKey;
import com.oneorthree.phone.notification.producer.NotificationKind;
import com.oneorthree.phone.notification.producer.ResultBundleCompletionService;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import com.oneorthree.phone.outbox.support.PostgresLockWaits;
import com.oneorthree.phone.outbox.support.RawUserLock;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.user.repository.domain.UserWallet;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.PessimisticLockingFailureException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowableOfType;

/**
 * 조건 ③ — fan-out 생산 경로 각각을 <b>여러 그룹·회차에 걸친 겹치는 수신자</b>로 실물 PostgreSQL 에서 돌린다 (GROMO-893).
 *
 * <p>CI 프로파일은 USER 잠금 순서 감시를 강제한다. 그래서 여기 있는 모든 실행은 «한 트랜잭션 안에서 정본 순서를 거스르는
 * 획득이 한 번도 없었다»는 증거이기도 하다. 경로마다 같은 수신자를 두 트랜잭션이 동시에 적게 해 교착·중복이 없음을 본다.
 */
@SpringBootTest(properties = "notification.dispatch.mode=OUTBOX")
class NotificationFanOutProductionPathIntegrationTest {

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
    }

    private static final ZoneId KST = ZoneId.of("Asia/Seoul");

    @Autowired GroupChallengeService challenges;
    @Autowired GroupBetSettler settler;
    @Autowired BetEventNotificationService betEvents;
    @Autowired ResultBundleCompletionService resultBundles;
    @Autowired SilentFlushPushService silentFlush;
    @Autowired SessionOpenNotificationService sessionOpen;
    @Autowired ChallengeWindowEndNotificationService windowEnd;
    @Autowired GlobalExceptionHandler exceptionHandler;
    @Autowired PlatformTransactionManager transactions;
    @Autowired JdbcTemplate jdbc;
    @PersistenceContext EntityManager em;

    private final ObjectMapper objectMapper = new ObjectMapper().findAndRegisterModules();

    // ── 픽스처 ───────────────────────────────────────────────────────────────────

    private <T> T tx(Supplier<T> work) {
        return new TransactionTemplate(transactions).execute(status -> work.get());
    }

    private User user() {
        User user = User.builder().nickname("팬아웃" + UUID.randomUUID().toString().substring(0, 8))
                .isGuest(false).language("ko").build();
        em.persist(user);
        em.persist(UserWallet.builder().userId(user.getId()).balance(10_000).build());
        return user;
    }

    private Group group(String name, User owner, List<User> members) {
        Group group = Group.builder().name(name).maxMembers(20).build();
        em.persist(group);
        if (owner != null) {
            em.persist(GroupMember.builder().group(group).user(owner).role(GroupMemberRole.OWNER).build());
        }
        for (User member : members) {
            em.persist(GroupMember.builder().group(group).user(member).role(GroupMemberRole.MEMBER).build());
        }
        return group;
    }

    private GroupChallengeBet durationBet(Group group) {
        GroupChallenge challenge = GroupChallenge.builder().group(group).category(MissionCategory.FOCUS)
                .type(MissionType.DURATION).build();
        em.persist(challenge);
        em.persist(GroupChallengeDuration.builder().challenge(challenge).category(MissionCategory.FOCUS)
                .durationMinutes(30).build());
        GroupChallengeBet bet = GroupChallengeBet.builder().group(group).challenge(challenge).stake(100)
                .enabled(true).build();
        em.persist(bet);
        return bet;
    }

    private GroupChallengeBetSession session(GroupChallengeBet bet, LocalDate date, Instant joinClosesAt,
                                             Instant settleAfter, GroupBetStatus status, Instant settledAt,
                                             GroupBetVoidReason voidReason) {
        GroupChallengeBetSession session = GroupChallengeBetSession.builder().bet(bet).group(bet.getGroup())
                .challenge(bet.getChallenge()).sessionDate(date).stake(100).goalMinutes(30)
                .missionCategory(MissionCategory.FOCUS).missionType(MissionType.DURATION)
                .startsAt(date.atStartOfDay(KST).toInstant()).joinClosesAt(joinClosesAt).closesAt(joinClosesAt)
                .settleAfter(settleAfter).status(status).settledAt(settledAt).voidReason(voidReason).build();
        em.persist(session);
        return session;
    }

    private void participants(GroupChallengeBetSession session, List<User> users) {
        for (User user : users) {
            em.persist(GroupChallengeBetParticipant.builder().session(session).user(user).achieved(true).build());
        }
    }

    private static void concurrently(Runnable... tasks) throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(tasks.length);
        CountDownLatch start = new CountDownLatch(1);
        try {
            List<Future<?>> futures = new ArrayList<>();
            for (Runnable task : tasks) {
                futures.add(pool.submit(() -> {
                    start.await(10, TimeUnit.SECONDS);
                    task.run();
                    return null;
                }));
            }
            start.countDown();
            for (Future<?> future : futures) {
                future.get(120, TimeUnit.SECONDS);
            }
        } finally {
            pool.shutdownNow();
        }
    }

    private List<String> eventIds(UUID user, NotificationKind kind) {
        return jdbc.queryForList("SELECT event_id FROM event_outbox WHERE user_id=? AND params->>'kind'=?"
                + " ORDER BY event_id", String.class, user, kind.name());
    }

    private CreateChallengeRequest durationRequest() throws Exception {
        return objectMapper.readValue("{\"missionCategory\":\"FOCUS\",\"missionType\":\"DURATION\","
                + "\"durationMinutes\":30}", CreateChallengeRequest.class);
    }

    private UUID challengeOf(Group group) {
        return jdbc.queryForObject("SELECT id FROM group_challenges WHERE group_id=?", UUID.class, group.getId());
    }

    // ── 챌린지 개설 ───────────────────────────────────────────────────────────────

    @Test
    @DisplayName("공통 멤버를 가진 두 그룹에서 챌린지가 동시에 개설돼도 둘 다 커밋되고 멤버마다 사건이 남는다")
    void challengeCreationInTwoGroupsSharingMembersCommitsBoth() throws Exception {
        record Fixture(User firstOwner, User secondOwner, List<User> shared, Group first, Group second) {
        }
        Fixture f = tx(() -> {
            User firstOwner = user();
            User secondOwner = user();
            List<User> shared = List.of(user(), user(), user(), user());
            return new Fixture(firstOwner, secondOwner, shared,
                    group("개설-가", firstOwner, shared), group("개설-나", secondOwner, List.of(shared.get(3), shared.get(2), shared.get(1), shared.get(0))));
        });
        CreateChallengeRequest request = durationRequest();

        concurrently(
                () -> challenges.createChallenge(f.first().getId(), f.firstOwner().getId(), request),
                () -> challenges.createChallenge(f.second().getId(), f.secondOwner().getId(), request));

        UUID firstChallenge = challengeOf(f.first());
        UUID secondChallenge = challengeOf(f.second());
        for (User member : f.shared()) {
            assertThat(eventIds(member.getId(), NotificationKind.CHALLENGE_CREATED)).containsExactlyInAnyOrder(
                    NotificationEventKey.of(NotificationKind.CHALLENGE_CREATED, member.getId(), firstChallenge, null),
                    NotificationEventKey.of(NotificationKind.CHALLENGE_CREATED, member.getId(), secondChallenge, null));
        }
        assertThat(eventIds(f.firstOwner().getId(), NotificationKind.CHALLENGE_CREATED)).isEmpty();
    }

    /**
     * 요청 경로가 교착 희생자가 되면 원자적으로 롤백되고 기존 409 {@code CONCURRENT_UPDATE} 로 나간다 — 500 이 아니다.
     *
     * <p>다른 트랜잭션이 뒤쪽 멤버를 쥔 채, 개설 트랜잭션이 앞쪽 멤버를 쥐고 기다리기 시작하면 앞쪽 멤버를 요청한다.
     * 먼저 기다린 개설 쪽이 {@code 40P01} 로 끊긴다.
     */
    @Test
    @DisplayName("교착 희생자가 된 챌린지 개설은 챌린지·사건이 함께 롤백되고 409 CONCURRENT_UPDATE 로 매핑된다")
    void aChallengeCreationThatLosesADeadlockRollsBackAndMapsToConflict() throws Exception {
        record Fixture(User owner, User low, User high, Group group) {
        }
        Fixture f = tx(() -> {
            User owner = user();
            List<User> members = new ArrayList<>(List.of(user(), user()));
            members.sort((left, right) -> left.getId().toString().compareTo(right.getId().toString()));
            return new Fixture(owner, members.get(0), members.get(1), group("교착", owner, members));
        });
        PostgresLockWaits.ensureUserRows(jdbc, List.of(f.low().getId(), f.high().getId()));
        CreateChallengeRequest request = durationRequest();
        ExecutorService pool = Executors.newFixedThreadPool(2);
        ExecutionException lost;
        try (RawUserLock reverse = RawUserLock.open()) {
            reverse.lock(f.high().getId());
            Future<?> creating = pool.submit(() -> challenges.createChallenge(f.group().getId(), f.owner().getId(),
                    request));
            PostgresLockWaits.awaitWaiting(jdbc, 1);
            Future<?> reverseOrder = pool.submit(() -> {
                reverse.lock(f.low().getId());
                reverse.commit();
            });
            reverseOrder.get(30, TimeUnit.SECONDS);
            lost = catchThrowableOfType(ExecutionException.class, () -> creating.get(30, TimeUnit.SECONDS));
        } finally {
            pool.shutdownNow();
        }

        assertThat(lost).isNotNull();
        assertThat(lost.getCause()).isInstanceOf(PessimisticLockingFailureException.class);
        assertThat(PostgresLockWaits.sqlStateOf(lost.getCause())).isEqualTo("40P01");
        var response = exceptionHandler.handlePessimisticLock((PessimisticLockingFailureException) lost.getCause());
        assertThat(response.getStatusCode().value()).isEqualTo(409);
        assertThat(response.getBody()).extracting("code").hasToString("CONCURRENT_UPDATE");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM group_challenges WHERE group_id=?", Long.class,
                f.group().getId())).isZero();
        assertThat(eventIds(f.low().getId(), NotificationKind.CHALLENGE_CREATED)).isEmpty();
    }

    // ── 회차 종료(요청 경로 · 한 트랜잭션 여러 사건) ────────────────────────────────

    /**
     * 챌린지 삭제는 OPEN 회차마다 종료 사건을 따로 낸다. 앞 회차에는 정본 순서로 뒤쪽 두 사람, 뒤 회차에는 앞쪽 한 사람이
     * 참가해, 회차마다 잠그면 트랜잭션 안에서 순서를 거스르게 배치했다(CI 감시가 곧장 실패시킨다).
     */
    @Test
    @DisplayName("여러 회차를 한 트랜잭션에서 무산시켜도 참가자 합집합을 한 번에 잠가 모든 환불 사건을 남긴다")
    void challengeDeleteVoidingSeveralSessionsLocksTheUnionOnce() {
        record Fixture(UUID challenge, List<UUID> sessions, User low, User middle, User high) {
        }
        Fixture f = tx(() -> {
            List<User> users = new ArrayList<>(List.of(user(), user(), user()));
            users.sort((left, right) -> left.getId().toString().compareTo(right.getId().toString()));
            Group group = group("삭제", null, users);
            GroupChallengeBet bet = durationBet(group);
            Instant future = Instant.now().plusSeconds(86_400);
            session(bet, LocalDate.of(2027, 4, 1), future, future, GroupBetStatus.OPEN, null, null);
            session(bet, LocalDate.of(2027, 4, 2), future, future, GroupBetStatus.OPEN, null, null);
            em.flush();
            List<UUID> ordered = jdbc.queryForList("SELECT id FROM group_challenge_bet_sessions WHERE bet_id=?"
                    + " ORDER BY id", UUID.class, bet.getId());
            return new Fixture(bet.getChallenge().getId(), ordered, users.get(0), users.get(1), users.get(2));
        });
        tx(() -> {
            participants(em.find(GroupChallengeBetSession.class, f.sessions().get(0)), List.of(f.middle(), f.high()));
            participants(em.find(GroupChallengeBetSession.class, f.sessions().get(1)), List.of(f.low()));
            return null;
        });

        settler.voidOpenSessionsForChallengeDelete(f.challenge());

        assertThat(eventIds(f.middle().getId(), NotificationKind.BET_VOID_REFUND)).containsExactly(
                NotificationEventKey.of(NotificationKind.BET_VOID_REFUND, f.middle().getId(), f.sessions().get(0), null));
        assertThat(eventIds(f.high().getId(), NotificationKind.BET_VOID_REFUND)).containsExactly(
                NotificationEventKey.of(NotificationKind.BET_VOID_REFUND, f.high().getId(), f.sessions().get(0), null));
        assertThat(eventIds(f.low().getId(), NotificationKind.BET_VOID_REFUND)).containsExactly(
                NotificationEventKey.of(NotificationKind.BET_VOID_REFUND, f.low().getId(), f.sessions().get(1), null));
    }

    // ── 내기 재훑기 + 결과·환불 완료 경계(⑥) ──────────────────────────────────────

    /**
     * 조건 ⑥의 계약 — 실제 재훑기가 같은 (그룹 × 원래 슬롯)의 결과와 환불을 함께 후보로 만들고, 슬롯 봉인이 두 사건 id 를
     * 모두 담은 완료 경계를 <b>그 사용자 축의 마지막 사건</b>으로 적는다. 알림 서버는 이 manifest 가 다 도착해야만 묶음을
     * 낸다(소비 측 회귀는 알림 서버 {@code ResultBundleCompletionTest}).
     */
    @Test
    @DisplayName("재훑기는 두 그룹에 걸친 결과·환불을 한 번씩 적고, 봉인은 같은 슬롯의 결과+환불을 한 완료 경계로 묶는다")
    void rescanAcrossGroupsWritesResultAndRefundUnderOneCompletionBoundary() throws Exception {
        Instant now = Instant.now();
        // 결과 슬롯 = settled_at 의 15분 내림(ResultBundleCompletionService#slotOf) — 한 시간 전이라 이미 닫혔다.
        Instant slot = Instant.ofEpochSecond(Math.floorDiv(now.minusSeconds(3600).getEpochSecond(), 900) * 900);
        record Fixture(User first, User both, User last, Group resultGroup, Group otherGroup,
                       UUID settled, UUID voided, UUID otherSettled) {
        }
        Fixture f = tx(() -> {
            User first = user();
            User both = user();
            User last = user();
            Group resultGroup = group("재훑기-가", null, List.of(first, both));
            Group otherGroup = group("재훑기-나", null, List.of(both, last));
            GroupChallengeBet bet = durationBet(resultGroup);
            GroupChallengeBet otherBet = durationBet(otherGroup);
            Instant closed = now.minusSeconds(7200);
            GroupChallengeBetSession settled = session(bet, LocalDate.of(2027, 5, 1), closed, closed,
                    GroupBetStatus.SETTLED, slot.plusSeconds(60), null);
            GroupChallengeBetSession voided = session(bet, LocalDate.of(2027, 5, 2), closed, closed,
                    GroupBetStatus.VOIDED, slot.plusSeconds(120), GroupBetVoidReason.CHALLENGE_DELETED);
            GroupChallengeBetSession otherSettled = session(otherBet, LocalDate.of(2027, 5, 1), closed, closed,
                    GroupBetStatus.SETTLED, slot.plusSeconds(180), null);
            participants(settled, List.of(both, first));
            participants(voided, List.of(first, both));
            participants(otherSettled, List.of(last, both));
            return new Fixture(first, both, last, resultGroup, otherGroup, settled.getId(), voided.getId(),
                    otherSettled.getId());
        });

        concurrently(() -> betEvents.rescanAndFlush(now), () -> betEvents.rescanAndFlush(now));
        resultBundles.flushClosedBundles();

        String firstResult = NotificationEventKey.of(NotificationKind.BET_RESULT, f.first().getId(), f.settled(), null);
        String firstRefund = NotificationEventKey.of(NotificationKind.BET_VOID_REFUND, f.first().getId(), f.voided(),
                null);
        String bothResult = NotificationEventKey.of(NotificationKind.BET_RESULT, f.both().getId(), f.settled(), null);
        String bothRefund = NotificationEventKey.of(NotificationKind.BET_VOID_REFUND, f.both().getId(), f.voided(),
                null);
        String bothOther = NotificationEventKey.of(NotificationKind.BET_RESULT, f.both().getId(), f.otherSettled(),
                null);
        String lastOther = NotificationEventKey.of(NotificationKind.BET_RESULT, f.last().getId(), f.otherSettled(),
                null);
        assertThat(eventIds(f.first().getId(), NotificationKind.BET_RESULT)).containsExactly(firstResult);
        assertThat(eventIds(f.first().getId(), NotificationKind.BET_VOID_REFUND)).containsExactly(firstRefund);
        assertThat(eventIds(f.both().getId(), NotificationKind.BET_RESULT))
                .containsExactlyInAnyOrder(bothResult, bothOther);
        assertThat(eventIds(f.both().getId(), NotificationKind.BET_VOID_REFUND)).containsExactly(bothRefund);
        assertThat(eventIds(f.last().getId(), NotificationKind.BET_RESULT)).containsExactly(lastOther);

        assertCompletionBoundary(f.first(), f.resultGroup(), slot, List.of(firstResult, firstRefund));
        assertCompletionBoundary(f.both(), f.resultGroup(), slot, List.of(bothResult, bothRefund));
        assertCompletionBoundary(f.both(), f.otherGroup(), slot, List.of(bothOther));
        assertCompletionBoundary(f.last(), f.otherGroup(), slot, List.of(lastOther));
    }

    @SuppressWarnings("unchecked")
    private void assertCompletionBoundary(User user, Group group, Instant slot, List<String> members) {
        String seal = "noti:resultBundle:" + user.getId() + ":" + group.getId() + ":" + slot.getEpochSecond();
        Map<String, Object> row = jdbc.queryForMap("SELECT version, params::text AS params FROM event_outbox"
                + " WHERE event_id=?", seal);
        assertThat(row.get("params").toString()).contains(members.stream().map(id -> "\"" + id + "\"").toList());
        Long lastMember = jdbc.queryForObject("SELECT max(version) FROM event_outbox WHERE event_id = ANY(?)",
                Long.class, (Object) members.toArray(String[]::new));
        assertThat((Long) row.get("version")).isGreaterThan(lastMember);
    }

    // ── 사일런트 flush ────────────────────────────────────────────────────────────

    @Test
    @DisplayName("사일런트 flush 는 두 그룹 회차에 겹친 참가자를 동시 실행에서도 회차마다 한 번씩 적는다")
    void silentFlushAcrossGroupsWritesEachParticipantOnce() throws Exception {
        Instant now = Instant.now();
        record Fixture(User first, User both, User last, UUID firstSession, UUID secondSession) {
        }
        Fixture f = tx(() -> {
            User first = user();
            User both = user();
            User last = user();
            Instant settleAfter = now.plusSeconds(600);
            GroupChallengeBetSession one = session(durationBet(group("사일런트-가", null, List.of(first, both))),
                    LocalDate.now(KST), now.minusSeconds(3600), settleAfter, GroupBetStatus.OPEN, null, null);
            GroupChallengeBetSession two = session(durationBet(group("사일런트-나", null, List.of(both, last))),
                    LocalDate.now(KST), now.minusSeconds(3600), settleAfter, GroupBetStatus.OPEN, null, null);
            participants(one, List.of(both, first));
            participants(two, List.of(last, both));
            return new Fixture(first, both, last, one.getId(), two.getId());
        });

        concurrently(() -> silentFlush.sendGraceFlushPushes(now), () -> silentFlush.sendGraceFlushPushes(now));

        assertThat(eventIds(f.first().getId(), NotificationKind.BET_SILENT_FLUSH)).containsExactly(
                NotificationEventKey.of(NotificationKind.BET_SILENT_FLUSH, f.first().getId(), f.firstSession(), null));
        assertThat(eventIds(f.both().getId(), NotificationKind.BET_SILENT_FLUSH)).containsExactlyInAnyOrder(
                NotificationEventKey.of(NotificationKind.BET_SILENT_FLUSH, f.both().getId(), f.firstSession(), null),
                NotificationEventKey.of(NotificationKind.BET_SILENT_FLUSH, f.both().getId(), f.secondSession(), null));
        assertThat(eventIds(f.last().getId(), NotificationKind.BET_SILENT_FLUSH)).containsExactly(
                NotificationEventKey.of(NotificationKind.BET_SILENT_FLUSH, f.last().getId(), f.secondSession(), null));
    }

    // ── 회차 모집 ─────────────────────────────────────────────────────────────────

    @Test
    @DisplayName("회차 모집은 두 그룹에 겹친 멤버에게 그룹별 묶음 선언을 달아 동시 실행에서도 한 번씩 적는다")
    void sessionOpenAcrossGroupsDeclaresRecipientScopedBundles() throws Exception {
        LocalDate day = LocalDate.of(2027, 1, 6);
        Instant now = day.atTime(LocalTime.of(8, 30)).atZone(KST).toInstant();
        Instant joinCloses = day.plusDays(1).atStartOfDay(KST).toInstant();
        record Fixture(User first, User both, User last, UUID firstSession, UUID secondSession) {
        }
        Fixture f = tx(() -> {
            User first = user();
            User both = user();
            User last = user();
            GroupChallengeBetSession one = session(durationBet(group("모집-가", null, List.of(first, both))), day,
                    joinCloses, joinCloses.plusSeconds(3600), GroupBetStatus.OPEN, null, null);
            GroupChallengeBetSession two = session(durationBet(group("모집-나", null, List.of(last, both))), day,
                    joinCloses, joinCloses.plusSeconds(3600), GroupBetStatus.OPEN, null, null);
            return new Fixture(first, both, last, one.getId(), two.getId());
        });

        concurrently(() -> sessionOpen.sendSessionOpenNotifications(now),
                () -> sessionOpen.sendSessionOpenNotifications(now));

        assertThat(eventIds(f.first().getId(), NotificationKind.CHALLENGE_SESSION_OPEN)).containsExactly(
                NotificationEventKey.of(NotificationKind.CHALLENGE_SESSION_OPEN, f.first().getId(), f.firstSession(),
                        null));
        assertThat(eventIds(f.last().getId(), NotificationKind.CHALLENGE_SESSION_OPEN)).containsExactly(
                NotificationEventKey.of(NotificationKind.CHALLENGE_SESSION_OPEN, f.last().getId(), f.secondSession(),
                        null));
        for (UUID session : List.of(f.firstSession(), f.secondSession())) {
            String params = jdbc.queryForObject("SELECT params::text FROM event_outbox WHERE event_id=?", String.class,
                    NotificationEventKey.of(NotificationKind.CHALLENGE_SESSION_OPEN, f.both().getId(), session, null));
            // 다른 그룹 회차는 다른 묶음이다 — 섞으면 그 묶음은 영영 도착 완료가 되지 않는다.
            assertThat(params).contains("\"bundleMembers\": [\"" + session + "\"]");
        }
    }

    // ── 창 종료(⑦) ───────────────────────────────────────────────────────────────

    /**
     * 조건 ⑦의 회귀 — 23:40 에 끝난 창을 23:45 틱과 00:00 틱이 둘 다 잡아도 사건은 하나이고, 다음 날의 진짜 회차는 따로
     * 적힌다. 두 그룹에 겹친 멤버로 생산 진입점을 동시에 돌린다.
     */
    @Test
    @DisplayName("자정을 넘겨 다시 감지된 창 종료는 같은 사건이고, 다음 날 회차는 별개 사건으로 남는다")
    void windowEndDetectedAcrossMidnightIsOneEventAndTheNextCycleIsSeparate() throws Exception {
        LocalDate day = LocalDate.of(2027, 2, 10);
        WindowFixture f = tx(() -> {
            User first = user();
            User both = user();
            User last = user();
            GroupChallenge one = windowChallenge(group("창-가", null, List.of(first, both)));
            GroupChallenge two = windowChallenge(group("창-나", null, List.of(both, last)));
            return new WindowFixture(first.getId(), both.getId(), last.getId(), one.getId(), two.getId());
        });
        Instant firstEnd = day.atTime(LocalTime.of(23, 40)).atZone(KST).toInstant();
        Instant nextEnd = day.plusDays(1).atTime(LocalTime.of(23, 40)).atZone(KST).toInstant();

        Instant beforeMidnight = day.atTime(LocalTime.of(23, 45)).atZone(KST).toInstant();
        concurrently(() -> windowEnd.sendWindowEndNotifications(beforeMidnight),
                () -> windowEnd.sendWindowEndNotifications(beforeMidnight));
        windowEnd.sendWindowEndNotifications(day.plusDays(1).atStartOfDay(KST).toInstant());

        assertWindowEvents(f, List.of(firstEnd));

        windowEnd.sendWindowEndNotifications(day.plusDays(1).atTime(LocalTime.of(23, 45)).atZone(KST).toInstant());

        assertWindowEvents(f, List.of(firstEnd, nextEnd));
        String params = jdbc.queryForObject("SELECT params::text FROM event_outbox WHERE event_id=?", String.class,
                NotificationEventKey.of(NotificationKind.CHALLENGE_WINDOW_END, f.both(), f.firstChallenge(),
                        firstEnd));
        assertThat(params).contains("\"slotAt\": \"" + day.atStartOfDay(KST).toInstant() + "\"")
                .contains("\"dedupAt\": \"" + firstEnd + "\"");
    }

    private GroupChallenge windowChallenge(Group group) {
        GroupChallenge challenge = GroupChallenge.builder().group(group).category(MissionCategory.FOCUS)
                .type(MissionType.TIME_WINDOW).build();
        em.persist(challenge);
        em.persist(GroupChallengeWindow.builder().challenge(challenge).windowStart(LocalTime.of(23, 0))
                .windowEnd(LocalTime.of(23, 40)).durationMinutes(30).build());
        return challenge;
    }

    /** 창 종료 픽스처 — 두 그룹에 겹친 멤버 {@code both}. */
    private record WindowFixture(UUID first, UUID both, UUID last, UUID firstChallenge, UUID secondChallenge) {
    }

    private void assertWindowEvents(WindowFixture f, List<Instant> ends) {
        assertThat(eventIds(f.first(), NotificationKind.CHALLENGE_WINDOW_END)).containsExactlyInAnyOrderElementsOf(
                ends.stream().map(end -> NotificationEventKey.of(NotificationKind.CHALLENGE_WINDOW_END, f.first(),
                        f.firstChallenge(), end)).toList());
        List<String> expectedBoth = new ArrayList<>();
        for (Instant end : ends) {
            expectedBoth.add(NotificationEventKey.of(NotificationKind.CHALLENGE_WINDOW_END, f.both(),
                    f.firstChallenge(), end));
            expectedBoth.add(NotificationEventKey.of(NotificationKind.CHALLENGE_WINDOW_END, f.both(),
                    f.secondChallenge(), end));
        }
        assertThat(eventIds(f.both(), NotificationKind.CHALLENGE_WINDOW_END))
                .containsExactlyInAnyOrderElementsOf(expectedBoth);
        assertThat(eventIds(f.last(), NotificationKind.CHALLENGE_WINDOW_END)).containsExactlyInAnyOrderElementsOf(
                ends.stream().map(end -> NotificationEventKey.of(NotificationKind.CHALLENGE_WINDOW_END, f.last(),
                        f.secondChallenge(), end)).toList());
    }
}
