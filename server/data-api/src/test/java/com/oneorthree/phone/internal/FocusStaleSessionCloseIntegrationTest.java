package com.oneorthree.phone.internal;

import com.oneorthree.phone.auth.service.AuthService;
import com.oneorthree.phone.auth.support.JwtProvider;
import com.oneorthree.phone.common.port.FocusPresencePort;
import com.oneorthree.phone.focus.dto.session.FocusSessionStartCommandRequest;
import com.oneorthree.phone.focus.dto.session.FocusSessionView;
import com.oneorthree.phone.focus.dto.session.FocusVersionedCommandRequest;
import com.oneorthree.phone.focus.dto.session.SeaFocusSessionStartCommandRequest;
import com.oneorthree.phone.focus.exception.FocusErrorCode;
import com.oneorthree.phone.focus.exception.FocusException;
import com.oneorthree.phone.focus.repository.FocusSessionDetailRepository;
import com.oneorthree.phone.focus.repository.domain.FocusSessionLifecycle;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.group.repository.domain.GroupMemberRole;
import com.oneorthree.phone.internal.dto.CreateIslandCommandRequest;
import com.oneorthree.phone.internal.scheduler.FocusRewardScheduler;
import com.oneorthree.phone.internal.scheduler.FocusStaleSessionScheduler;
import com.oneorthree.phone.internal.service.FocusSessionLifecycleService;
import com.oneorthree.phone.internal.service.GoldenFishService;
import com.oneorthree.phone.internal.service.IslandMembershipService;
import com.oneorthree.phone.internal.service.TelescopePinService;
import com.oneorthree.phone.internal.service.TelescopeService;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import com.oneorthree.phone.user.repository.UserQueryService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.domain.Limit;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;

/**
 * 방치된 집중 세션의 서버 종결 (GROMO-2636) — <b>실제 Flyway PostgreSQL</b> 위에서 본다.
 *
 * <p>크론은 {@code ci} 프로파일에서 돌지 않는다({@code app.scheduling.enabled=false}) — 운영과 같은 진입점
 * ({@code FocusStaleSessionScheduler#closeStaleSessions}, {@code FocusRewardScheduler#accrueDueSessions})을 테스트가 직접 부른다.
 * 시계를 갈아 끼우지 않는다: 세션을 DB 에서 과거로 밀어({@link #shiftBack}) 「오래 방치된」 상태를 만든다 — 시작·전이 시각과
 * 모든 구간을 같은 폭으로 옮기므로 구간 순서와 길이가 그대로고 «지금으로부터의 거리»만 바뀐다.
 *
 * <p>리스 해제는 스파이({@code @MockitoSpyBean})로 본다 — 진짜 포트가 그대로 돌고 호출만 기록한다
 * ({@code SeaFocusSessionIntegrationTest} 와 같다).
 */
@SpringBootTest
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class FocusStaleSessionCloseIntegrationTest {

    private static final long HOUR = 3600L;

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
    }

    @MockitoSpyBean
    FocusPresencePort presence;
    @Autowired
    FocusSessionLifecycleService focus;
    @Autowired
    FocusStaleSessionScheduler staleTicks;
    @Autowired
    FocusRewardScheduler rewardTicks;
    @Autowired
    GoldenFishService goldenFish;
    @Autowired
    FocusSessionDetailRepository details;
    @Autowired
    IslandMembershipService islands;
    @Autowired
    TelescopePinService pins;
    @Autowired
    TelescopeService telescope;
    @Autowired
    GroupRepository groups;
    @Autowired
    GroupMemberRepository members;
    @Autowired
    UserQueryService users;
    @Autowired
    AuthService auth;
    @Autowired
    JwtProvider jwt;
    @Autowired
    JdbcTemplate jdbc;
    @Autowired
    DataSource dataSource;

    /** 앞선 테스트가 남긴 진행 세션을 치운다 — 이 테스트의 틱이 남의 방치 세션을 닫아 단정을 흔들지 않게. */
    @BeforeEach
    void clearProgressingSessions() {
        jdbc.update("update focus_session_details set lifecycle='ABANDONED', rest_seat=null "
                + "where lifecycle in ('ACTIVE','PAUSED')");
        jdbc.update("update focus_sessions set status='AUTO_CLOSED', ended_at=now() where ended_at is null");
    }

    // ---------------------------------------------------------------- 상한 경계

    @Test
    @DisplayName("섬은 12시간, 바다는 3시간 — 모자라면 그대로 두고 넘기면 닫는다. 유예는 종류마다 따로다")
    void thresholdsAreTwelveHoursForIslandsAndThreeForTheSea() {
        UUID owner = newUser();
        UUID island = newIsland(owner, "경계섬");
        FocusSessionView islandSession = start(owner, island);
        FocusSessionView seaSession = startSea(newUser(), island);

        // 스캔 쿼리(후보)와 잠근 뒤 재판정(종결)이 각자 종류별 유예를 본다 — 둘 다 단정한다. 쿼리의 종류 구분이 틀려도
        // 재판정이 가려 내므로 종결 결과만으로는 쿼리 결함이 드러나지 않고, 그러면 한 틱 50건을 엉뚱한 세션이 채운다.
        shiftBack(islandSession.id(), 3 * HOUR - 60);
        shiftBack(seaSession.id(), 3 * HOUR - 60);
        assertThat(staleCandidates()).as("2시간 59분 — 후보가 아니다").isEmpty();
        tick();
        assertThat(lifecycleOf(seaSession.id())).as("바다 2시간 59분 — 아직 방치가 아니다").isEqualTo("ACTIVE");
        assertThat(lifecycleOf(islandSession.id())).isEqualTo("ACTIVE");

        shiftBack(islandSession.id(), 120);
        shiftBack(seaSession.id(), 120);
        assertThat(staleCandidates()).as("3시간 1분 — 후보는 바다뿐이다").containsExactly(seaSession.id());
        tick();
        assertThat(lifecycleOf(seaSession.id())).as("바다 3시간 1분 — 닫는다").isEqualTo("ABANDONED");
        assertThat(lifecycleOf(islandSession.id())).as("같은 3시간 1분이어도 섬은 12시간이다").isEqualTo("ACTIVE");

        shiftBack(islandSession.id(), 9 * HOUR - 120);
        assertThat(staleCandidates()).as("섬 11시간 59분 — 후보가 아니다").isEmpty();
        tick();
        assertThat(lifecycleOf(islandSession.id())).as("섬 11시간 59분 — 아직 방치가 아니다").isEqualTo("ACTIVE");

        shiftBack(islandSession.id(), 120);
        assertThat(staleCandidates()).as("섬 12시간 1분 — 후보다").containsExactly(islandSession.id());
        tick();
        assertThat(lifecycleOf(islandSession.id())).as("섬 12시간 1분 — 닫는다").isEqualTo("ABANDONED");
    }

    @Test
    @DisplayName("한 건이 실패해도 나머지는 닫힌다 — 실패한 행은 그대로 남아 다음 틱이 다시 집는다")
    void oneFailingSessionDoesNotStopTheRest() {
        // 한 후보를 «닫을 수 없는» 행으로 만든다 — 주인이 탈퇴 처리됐는데 상세가 ACTIVE 로 남은 반쪽 상태.
        UUID userA = newUser();
        FocusSessionView healthyA = start(userA, newIsland(userA, "멀쩡섬A"));
        UUID userB = newUser();
        FocusSessionView healthyB = start(userB, newIsland(userB, "멀쩡섬B"));
        UUID userC = newUser();
        FocusSessionView healthyC = start(userC, newIsland(userC, "멀쩡섬C"));
        UUID brokenUser = newUser();
        FocusSessionView broken = start(brokenUser, newIsland(brokenUser, "깨진섬"));
        shiftBack(healthyA.id(), 12 * HOUR + 1800);
        shiftBack(healthyC.id(), 13 * HOUR);
        shiftBack(healthyB.id(), 13 * HOUR + 1800);
        shiftBack(broken.id(), 14 * HOUR);
        jdbc.update("update users set is_deleted=true where id=?", brokenUser);

        // 소문자 16진 문자열 순서가 PostgreSQL uuid 순서와 같다. UUID.compareTo 는 부호 있는 비교라 다르다.
        List<UUID> byId = Stream.of(healthyA.id(), healthyB.id(), healthyC.id(), broken.id())
                .sorted(Comparator.comparing(UUID::toString)).toList();
        assertThat(staleCandidates()).as("세션 id 순이다").containsExactlyElementsOf(byId);
        Instant now = Instant.now();
        assertThat(details.findStaleActiveSessionIds(now.minus(FocusSessionLifecycleService.ISLAND_STALE_AFTER),
                now.minus(FocusSessionLifecycleService.SEA_STALE_AFTER), byId.get(0), Limit.of(2)))
                .as("시작점 뒤부터 한 틱이 집는 건수까지만 집는다").containsExactly(byId.get(1), byId.get(2));

        assertThatCode(this::tick).as("한 건의 실패가 틱 밖으로 새지 않는다").doesNotThrowAnyException();

        assertThat(lifecycleOf(healthyA.id())).isEqualTo("ABANDONED");
        assertThat(lifecycleOf(healthyB.id())).isEqualTo("ABANDONED");
        assertThat(lifecycleOf(healthyC.id())).isEqualTo("ABANDONED");
        assertThat(lifecycleOf(broken.id())).as("실패한 세션은 그대로다 — 다음 틱이 다시 집는다").isEqualTo("ACTIVE");
    }

    // ---------------------------------------------------------------- 잠근 뒤 재판정

    @Test
    @DisplayName("스캔이 고른 뒤 사용자가 먼저 움직이면 종결은 아무것도 하지 않는다 — resume 은 방치 시계를 다시 시작한다")
    void aTransitionThatWinsTheRaceLeavesTheSessionAlone() {
        UUID resumeUser = newUser();
        UUID resumeIsland = newIsland(resumeUser, "재개섬");
        FocusSessionView startedLongAgo = start(resumeUser, resumeIsland);
        shiftBack(startedLongAgo.id(), 13 * HOUR);
        // 스캔은 이 세션을 방치로 골랐다 — 그 사이 사용자가 쉬었다 돌아온다. 마지막 전이가 지금으로 옮겨진다.
        FocusSessionView paused = focus.pause(resumeUser, startedLongAgo.id(),
                new FocusVersionedCommandRequest(startedLongAgo.version()), UUID.randomUUID());
        FocusSessionView resumed = focus.resume(resumeUser, paused.id(),
                new FocusVersionedCommandRequest(paused.version()), UUID.randomUUID());

        assertThat(focus.autoCloseStale(resumed.id())).as("잠근 뒤 다시 보니 방금 재개했다").isFalse();
        tick();

        Map<String, Object> afterResume = detailRow(resumed.id());
        assertThat(afterResume.get("lifecycle")).isEqualTo("ACTIVE");
        assertThat(((Number) afterResume.get("version")).longValue()).as("전이가 일어나지 않았다")
                .isEqualTo(resumed.version());

        UUID finishUser = newUser();
        FocusSessionView finishing = start(finishUser, newIsland(finishUser, "종료섬"));
        shiftBack(finishing.id(), 13 * HOUR);
        focus.finish(finishUser, finishing.id(), new FocusVersionedCommandRequest(finishing.version()),
                UUID.randomUUID());
        assertThat(focus.autoCloseStale(finishing.id())).as("finish 가 먼저 끝났다").isFalse();
        assertThat(lifecycleOf(finishing.id())).isEqualTo("COMPLETED");
        assertThat(count("select count(*) from focus_settlements where session_id=?", finishing.id()))
                .as("정산은 finish 가 만든 한 행뿐이다").isEqualTo(1);
        assertThat(count("select count(*) from focus_sessions where id=? and status='COMPLETED'", finishing.id()))
                .as("기본 마커도 finish 가 닫은 그대로다").isEqualTo(1);
    }

    @Test
    @DisplayName("휴식(PAUSED)은 대상이 아니다 — 13시간 쉰 세션도 이 크론은 건드리지 않는다(휴식 1시간 자동 종료의 몫)")
    void aRestingSessionIsNotATarget() {
        UUID user = newUser();
        FocusSessionView started = start(user, newIsland(user, "휴식섬"));
        FocusSessionView paused = focus.pause(user, started.id(),
                new FocusVersionedCommandRequest(started.version()), UUID.randomUUID());
        shiftBack(paused.id(), 13 * HOUR);

        tick();

        assertThat(focus.autoCloseStale(paused.id())).isFalse();
        Map<String, Object> detail = detailRow(paused.id());
        assertThat(detail.get("lifecycle")).isEqualTo("PAUSED");
        assertThat(detail.get("rest_seat")).as("휴식 자리를 그대로 쥐고 있다").isNotNull();
    }

    @Test
    @DisplayName("잠금 순서가 전이와 같다 — pause 가 먼저 쥐고 있으면 종결은 교착 없이 줄을 서고, 잠근 뒤 다시 읽어 물러난다")
    void theCloserWaitsBehindATransitionAndRejudgesAfterTheLock() throws Exception {
        UUID user = newUser();
        FocusSessionView started = start(user, newIsland(user, "교착섬"));
        shiftBack(started.id(), 13 * HOUR);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try (Connection holder = dataSource.getConnection()) {
            // 상세 행을 쥐고 있는 «앞선 전이» 를 흉내 낸다 — 아래 pause 는 이 행 앞에서 기다린다.
            holder.setAutoCommit(false);
            try (PreparedStatement lock = holder.prepareStatement(
                    "select 1 from focus_session_details where session_id=? for update")) {
                lock.setObject(1, started.id());
                lock.execute();
            }
            // 사용자의 pause 가 먼저 와서 섬 행·멤버십을 쥐고 상세 잠금 앞에서 기다린다.
            Future<FocusSessionView> pausing = pool.submit(() -> focus.pause(user, started.id(),
                    new FocusVersionedCommandRequest(started.version()), UUID.randomUUID()));
            awaitLockWaiters(1);
            // 스캔이 이 세션을 방치로 골랐다 — 종결은 뒤따라 와서 섬 행에서 줄을 선다. 상세를 먼저 잡았다면 pause 와 교착한다.
            Future<Boolean> closing = pool.submit(() -> focus.autoCloseStale(started.id()));
            awaitLockWaiters(2);
            holder.rollback();

            assertThat(pausing.get(30, TimeUnit.SECONDS).status()).isEqualTo(FocusSessionView.STATUS_PAUSED);
            assertThat(closing.get(30, TimeUnit.SECONDS)).as("잠근 뒤 다시 읽으니 이미 휴식 중이다").isFalse();
        } finally {
            pool.shutdownNow();
        }
        assertThat(lifecycleOf(started.id())).isEqualTo("PAUSED");
        assertThat(count("select count(*) from event_outbox where type='focus.member.updated' "
                + "and params->>'sessionId'=? and params->>'status'='completed'", started.id().toString()))
                .as("종결 사건이 나가지 않았다").isZero();
    }

    @Test
    @DisplayName("종결이 먼저 이기면 뒤늦은 pause·resume·finish 는 409 이고, 두 번 돌려도 종결과 사건은 한 번이다")
    void aLateTransitionAfterTheCloseIsAConflictAndTheCloseHappensOnce() {
        UUID user = newUser();
        UUID island = newIsland(user, "선종결섬");
        FocusSessionView started = start(user, island);
        shiftBack(started.id(), 13 * HOUR);

        tick();
        tick();
        assertThat(focus.autoCloseStale(started.id())).as("이미 닫힌 세션").isFalse();

        for (Runnable late : List.<Runnable>of(
                () -> focus.pause(user, started.id(), new FocusVersionedCommandRequest(started.version()),
                        UUID.randomUUID()),
                () -> focus.resume(user, started.id(), new FocusVersionedCommandRequest(started.version()),
                        UUID.randomUUID()),
                () -> focus.finish(user, started.id(), new FocusVersionedCommandRequest(started.version()),
                        UUID.randomUUID()))) {
            assertThatThrownBy(late::run).isInstanceOf(FocusException.class)
                    .hasFieldOrPropertyWithValue("errorCode", FocusErrorCode.SESSION_STATE_CONFLICT);
        }
        assertThat(count("select count(*) from event_outbox where type='focus.member.updated' "
                + "and params->>'sessionId'=? and params->>'status'='completed'", started.id().toString()))
                .as("종결 사건은 한 번이다").isEqualTo(1);
        verify(presence).focusEnded(eq(user), eq(presenceOrder(started.id())));
    }

    // ---------------------------------------------------------------- 섬 세션의 종결 상태

    @Test
    @DisplayName("섬 세션: 상세 ABANDONED · 열린 구간 닫힘 · 마커 AUTO_CLOSED · 사건과 리스 정리 — 정산·집중 기록·주간 랭킹은 없다")
    void anIslandSessionIsAbandonedWithoutSettlementOrRecord() {
        UUID user = newUser();
        UUID island = newIsland(user, "방치섬");
        FocusSessionView started = start(user, island);
        // 한 번 쉬었다 돌아온 세션 — 구간이 셋(ACTIVE · REST · ACTIVE)이고 마지막만 열려 있다.
        FocusSessionView paused = focus.pause(user, started.id(),
                new FocusVersionedCommandRequest(started.version()), UUID.randomUUID());
        FocusSessionView resumed = focus.resume(user, paused.id(),
                new FocusVersionedCommandRequest(paused.version()), UUID.randomUUID());
        shiftBack(resumed.id(), 12 * HOUR + 120);
        Instant before = lastTransitionAt(resumed.id());

        tick();

        Map<String, Object> detail = detailRow(resumed.id());
        assertThat(detail.get("lifecycle")).isEqualTo("ABANDONED");
        assertThat(detail.get("rest_seat")).isNull();
        assertThat(((Number) detail.get("version")).longValue()).as("전이이므로 version 이 하나 오른다")
                .isEqualTo(resumed.version() + 1);
        assertThat(lastTransitionAt(resumed.id())).as("종결 시각은 지금이다 — 방치 시작 시각이 아니다")
                .isAfter(before.plus(Duration.ofHours(12)));
        assertThat(count("select count(*) from focus_session_intervals where session_id=? and ended_at is null",
                resumed.id())).as("열린 구간이 남지 않는다").isZero();
        assertThat(count("select count(*) from focus_session_intervals where session_id=? and kind='ACTIVE' "
                + "and ended_at = (select last_transition_at from focus_session_details where session_id=?)",
                resumed.id(), resumed.id())).as("마지막 ACTIVE 구간이 종결 시각에 닫힌다").isEqualTo(1);
        assertThat(count("select count(*) from focus_sessions s join focus_session_details d on d.session_id = s.id "
                + "where s.id=? and s.status='AUTO_CLOSED' and s.ended_at = d.last_transition_at", resumed.id()))
                .as("기본 마커는 통계 제외로 같은 시각에 닫힌다 — 정상 완료가 아니다").isEqualTo(1);

        assertThat(count("select count(*) from focus_settlements where session_id=?", resumed.id()))
                .as("정산 행이 없다").isZero();
        assertThat(count("select count(*) from daily_focus_stats where user_id=?", user))
                .as("집중 기록(일 집계)에 더해지지 않는다").isZero();
        assertThat(count("select count(*) from island_weekly_focus where island_id=?", island))
                .as("주간 랭킹 분자에 더해지지 않는다").isZero();
        assertThat(count("select count(*) from event_outbox where type='focus.member.updated' "
                + "and params->>'sessionId'=? and params->>'status'='completed' and subject_id=?",
                resumed.id().toString(), island.toString())).as("섬 집중 목록에서 지우는 사건").isEqualTo(1);
        assertThat(count("select count(*) from event_outbox where type='rest.member.updated' "
                + "and params->>'sessionId'=? and params->>'status'='completed' "
                + "and params->'restSeat'='null'::jsonb and subject_id=?",
                resumed.id().toString(), island.toString())).as("휴식 목록에서도 자리 없이 지운다").isEqualTo(1);
        verify(presence).focusEnded(eq(user), eq(presenceOrder(resumed.id())));

        // 앱이 돌아와 묻는 면: 진행 세션도 미확인 결과도 없고, 옛 세션의 전이는 409 이며, 새 집중을 막지 않는다.
        assertThat(focus.current(user)).isNull();
        assertThat(focus.pendingResult(user)).isNull();
        assertThatThrownBy(() -> focus.finish(user, resumed.id(),
                new FocusVersionedCommandRequest(resumed.version()), UUID.randomUUID()))
                .hasFieldOrPropertyWithValue("errorCode", FocusErrorCode.SESSION_STATE_CONFLICT);
        assertThat(start(user, island).status()).as("SESSION_IN_PROGRESS 로 막히지 않는다")
                .isEqualTo(FocusSessionView.STATUS_ACTIVE);

        // 대조: 정상 종료한 세션은 같은 표에 쌓인다 — 위 «없음» 이 관측 실패가 아님을 보인다.
        UUID otherUser = newUser();
        UUID otherIsland = newIsland(otherUser, "대조섬");
        FocusSessionView normal = start(otherUser, otherIsland);
        shiftBack(normal.id(), HOUR);
        focus.finish(otherUser, normal.id(), new FocusVersionedCommandRequest(normal.version()), UUID.randomUUID());
        assertThat(count("select count(*) from island_weekly_focus where island_id=?", otherIsland)).isPositive();
        assertThat(count("select count(*) from daily_focus_stats where user_id=?", otherUser)).isPositive();
        Instant now = Instant.now();
        List<FocusSessionDetailRepository.IslandFocusSeconds> weekly =
                details.sumIslandActiveSeconds(now.minus(Duration.ofDays(3)), now.plus(Duration.ofDays(1)));
        assertThat(weekly).extracting(FocusSessionDetailRepository.IslandFocusSeconds::getIslandId)
                .as("주간 재계산 쿼리도 ABANDONED 를 세지 않는다").contains(otherIsland).doesNotContain(island);
    }

    // ---------------------------------------------------------------- 종결 뒤 적립·황금

    @Test
    @DisplayName("종결 뒤 적립 틱은 0이다 — 이미 들어간 물고기는 회수하지 않고 원장과 rewarded_seconds 도 그대로다")
    void accrualStopsAndNothingIsClawedBack() {
        UUID user = newUser();
        UUID island = newIsland(user, "적립섬");
        FocusSessionView paid = start(user, island);
        shiftBack(paid.id(), 11 * HOUR);
        rewardTicks.accrueDueSessions();
        long balance = islandBalance(island);
        long ledger = ledgerRows(island);
        long rewarded = rewardedSeconds(paid.id());
        long accrued = accruedFish(paid.id());
        assertThat(balance).as("방치되기 전에 이미 적립된 몫이 있다").isPositive();

        shiftBack(paid.id(), 2 * HOUR);
        tick();
        rewardTicks.accrueDueSessions();
        rewardTicks.accrueDueSessions();

        assertThat(lifecycleOf(paid.id())).isEqualTo("ABANDONED");
        assertThat(islandBalance(island)).as("회수도 추가 지급도 없다").isEqualTo(balance);
        assertThat(ledgerRows(island)).as("원장 줄이 늘지 않는다").isEqualTo(ledger);
        assertThat(rewardedSeconds(paid.id())).as("종결 뒤 틱이 워터마크를 밀지 않는다").isEqualTo(rewarded);
        assertThat(accruedFish(paid.id())).isEqualTo(accrued);

        // 대조: 방치가 아닌 세션은 같은 틱이 계속 적립한다 — 위 «그대로» 가 틱이 죽어 있어서가 아님을 보인다.
        UUID otherUser = newUser();
        UUID otherIsland = newIsland(otherUser, "대조섬");
        FocusSessionView active = start(otherUser, otherIsland);
        shiftBack(active.id(), 30 * 60);
        rewardTicks.accrueDueSessions();
        assertThat(islandBalance(otherIsland)).isEqualTo(30);
    }

    @Test
    @DisplayName("방치 세션은 종결과 함께 황금 물고기 추첨 인원에서 빠진다 — 확률이 100% 여도 혼자면 나타나지 않는다")
    void aClosedSessionNoLongerCountsForTheGoldenFishDraw() {
        alwaysWin();
        UUID stale = newUser();
        UUID island = newIsland(stale, "황금섬");
        UUID fresh = newUser();
        joinAndMoveTo(fresh, island);
        FocusSessionView staleSession = start(stale, island);
        FocusSessionView freshSession = start(fresh, island);
        shiftBack(staleSession.id(), 12 * HOUR + 120);
        Instant minute = Instant.now().truncatedTo(ChronoUnit.MINUTES);

        assertThat(goldenFish.drawAndCredit(island, minute)).as("방치 세션도 ACTIVE 인 동안은 인원에 든다").isTrue();
        long balance = islandBalance(island);
        long golden = goldenOf(staleSession.id());
        assertThat(golden).isPositive();

        tick();

        assertThat(details.findIslandIdsWithAtLeast(FocusSessionLifecycle.ACTIVE, GoldenFishService.MIN_MEMBERS))
                .as("추첨 후보 섬 목록에서 빠진다").doesNotContain(island);
        assertThat(goldenFish.drawAndCredit(island, minute.plusSeconds(60))).as("남은 ACTIVE 는 하나뿐이다").isFalse();
        assertThat(islandBalance(island)).isEqualTo(balance);
        assertThat(goldenOf(staleSession.id())).as("이미 받은 황금 몫은 그대로다").isEqualTo(golden);
        assertThat(lifecycleOf(freshSession.id())).isEqualTo("ACTIVE");
    }

    // ---------------------------------------------------------------- 바다

    @Test
    @DisplayName("바다 세션: 도착하지 못한 종결 — 보상·무인도 생성 없이 sea.member.updated(ended) 한 건과 리스 해제")
    void aSeaVoyageIsAbandonedWithoutArrivalRewardOrNewIsland() {
        UUID user = newUser();
        // 소속 0 계정의 망원경에는 무인도 후보가 늘 있다 — 정산했다면 도착 → 새 섬 + 꾸미기 보상이 나갈 항해다.
        UUID candidate = telescope.list(user).items().stream()
                .filter(item -> "uninhabited".equals(item.slot())).findFirst().orElseThrow().islandId();
        FocusSessionView voyage = focus.startSea(user, new SeaFocusSessionStartCommandRequest(candidate),
                UUID.randomUUID());
        long islandsBefore = count("select count(*) from islands");
        shiftBack(voyage.id(), 3 * HOUR + 120);

        tick();

        Map<String, Object> detail = detailRow(voyage.id());
        assertThat(detail.get("lifecycle")).isEqualTo("ABANDONED");
        assertThat(detail.get("arrived")).as("도착하지 못한 종결로 못 박는다").isEqualTo(false);
        assertThat(detail.get("new_island_destination")).as("가상 목적지를 실제 섬으로 바꾸지 않았다").isEqualTo(true);
        assertThat(count("select count(*) from focus_session_intervals where session_id=? and ended_at is null",
                voyage.id())).isZero();
        assertThat(jdbc.queryForObject("select status from focus_sessions where id=?", String.class, voyage.id()))
                .isEqualTo("AUTO_CLOSED");
        assertThat(count("select count(*) from focus_settlements where session_id=?", voyage.id())).isZero();
        assertThat(count("select count(*) from islands")).as("무인도가 생기지 않는다").isEqualTo(islandsBefore);
        assertThat(count("select count(*) from group_members where user_id=?", user)).isZero();
        assertThat(count("select count(*) from owned_products where user_id=?", user))
                .as("꾸미기 보상이 나가지 않는다").isZero();
        assertThat(count("select count(*) from daily_focus_stats where user_id=?", user)).isZero();

        assertThat(jdbc.queryForList("select params->>'status' from event_outbox where type='sea.member.updated' "
                + "and user_id=? and params->>'sessionId'=? order by version", String.class, user,
                voyage.id().toString())).as("출항 한 건과 종료 한 건").containsExactly("sailing", "ended");
        assertThat(count("select count(*) from event_outbox where type='sea.member.updated' and user_id=? "
                + "and params->>'sessionId'=? and params->>'status'='ended' and params->>'arrived'='false'",
                user, voyage.id().toString())).as("ended 는 arrived=false 로 한 건").isEqualTo(1);
        assertThat(count("select count(*) from event_outbox where type in ('focus.member.updated',"
                + "'rest.member.updated') and params->>'sessionId'=?", voyage.id().toString()))
                .as("바다 세션은 섬 사건을 내지 않는다").isZero();
        verify(presence).focusEnded(eq(user), eq(presenceOrder(voyage.id())));
        assertThat(focus.current(user)).isNull();
        assertThat(focus.pendingResult(user)).isNull();
    }

    // ---------------------------------------------------------------- 도구

    /** 운영 크론과 «같은» 진입점으로 방치 종결 틱을 한 번 돌린다 — 스캔·잠금·재판정을 전부 통과시킨다. */
    private void tick() {
        staleTicks.closeStaleSessions();
    }

    /** 이 DB 에서 다른 연결의 잠금을 기다리는 백엔드가 {@code expected} 개 이상이 될 때까지 기다린다. */
    private void awaitLockWaiters(int expected) throws InterruptedException {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(20);
        while (System.nanoTime() < deadline) {
            Long waiting = jdbc.queryForObject("select count(*) from pg_stat_activity "
                    + "where datname = current_database() and wait_event_type = 'Lock'", Long.class);
            if (waiting != null && waiting >= expected) {
                return;
            }
            Thread.sleep(50);
        }
        throw new AssertionError("잠금 대기자가 " + expected + " 명이 되지 않았다");
    }

    /** 스캔이 지금 고르는 후보 — 운영 크론이 쓰는 경계(지금 − 12시간 / 지금 − 3시간)와 한 틱 50건 그대로다. */
    private List<UUID> staleCandidates() {
        Instant now = Instant.now();
        return details.findStaleActiveSessionIds(now.minus(FocusSessionLifecycleService.ISLAND_STALE_AFTER),
                now.minus(FocusSessionLifecycleService.SEA_STALE_AFTER), new UUID(0L, 0L), Limit.of(50));
    }

    /**
     * 진행 중 세션 <b>전체</b>를 {@code seconds} 만큼 과거로 민다 — 시작·전이 시각·모든 구간을 같은 폭으로 옮긴다
     * ({@code FocusSessionActivationIntegrationTest#shiftSessionBack} 과 같다).
     */
    private void shiftBack(UUID sessionId, long seconds) {
        double secs = seconds;
        jdbc.update("update focus_sessions set started_at = started_at - make_interval(secs => ?) where id=?",
                secs, sessionId);
        jdbc.update("update focus_session_details "
                + "set last_transition_at = last_transition_at - make_interval(secs => ?) where session_id=?",
                secs, sessionId);
        jdbc.update("update focus_session_intervals "
                + "set started_at = started_at - make_interval(secs => ?), "
                + "    ended_at = ended_at - make_interval(secs => ?) where session_id=?",
                secs, secs, sessionId);
    }

    private FocusSessionView start(UUID user, UUID island) {
        return focus.start(user, new FocusSessionStartCommandRequest(island, "알고리즘", 25), UUID.randomUUID());
    }

    /** 목적지를 핀으로 망원경에 넣고 그 항목의 항해 분으로 바다 세션을 시작한다. */
    private FocusSessionView startSea(UUID user, UUID island) {
        pins.pin(user, island, "magazine", null);
        return focus.startSea(user, new SeaFocusSessionStartCommandRequest(island), UUID.randomUUID());
    }

    private UUID newUser() {
        return jwt.extractUserId(auth.guestSession(UUID.randomUUID().toString()).accessToken());
    }

    private UUID newIsland(UUID owner, String name) {
        return islands.create(owner, new CreateIslandCommandRequest(name, null, false, null), UUID.randomUUID()).id();
    }

    /** 이미 있는 섬에 주민으로 넣고 도착해 현재 섬을 옮긴다 — 가입 승인 흐름은 이 테스트의 관심이 아니다. */
    private void joinAndMoveTo(UUID userId, UUID islandId) {
        members.save(GroupMember.builder().user(users.getCaller(userId))
                .group(groups.findById(islandId).orElseThrow()).role(GroupMemberRole.MEMBER).build());
        islands.arrive(userId, islandId, UUID.randomUUID());
    }

    /** 확률표를 100%로 올린 새 revision — 현재 정책은 가장 큰 revision 이다. */
    private void alwaysWin() {
        jdbc.update("INSERT INTO focus_reward_policies (revision, seconds_per_fish, daily_cap_fish, "
                + "personal_share_percent, golden_fish_reward, golden_max_members, golden_chance_ppm) "
                + "SELECT COALESCE(MAX(revision), 0) + 1, 60, 480, 0, 50, 5, '1000000,1000000,1000000,1000000' "
                + "FROM focus_reward_policies");
    }

    private Map<String, Object> detailRow(UUID sessionId) {
        return jdbc.queryForMap("select * from focus_session_details where session_id=?", sessionId);
    }

    private String lifecycleOf(UUID sessionId) {
        return jdbc.queryForObject("select lifecycle from focus_session_details where session_id=?", String.class,
                sessionId);
    }

    private Instant lastTransitionAt(UUID sessionId) {
        return jdbc.queryForObject("select last_transition_at from focus_session_details where session_id=?",
                Timestamp.class, sessionId).toInstant();
    }

    /** 프레즌스 리스의 순번 — 세션의 기본 마커가 쥔다. 리스 해제는 이 값으로 «그 세션의 것» 만 지운다. */
    private Long presenceOrder(UUID sessionId) {
        return jdbc.queryForObject("select presence_order from focus_sessions where id=?", Long.class, sessionId);
    }

    private long rewardedSeconds(UUID sessionId) {
        return count("select rewarded_seconds from focus_session_details where session_id=?", sessionId);
    }

    private long accruedFish(UUID sessionId) {
        return count("select coalesce(sum(earned_fish),0) from focus_reward_accruals where session_id=?", sessionId);
    }

    private long goldenOf(UUID sessionId) {
        return count("select coalesce(sum(golden_fish),0) from focus_reward_accruals where session_id=?", sessionId);
    }

    private long islandBalance(UUID islandId) {
        return count("select coalesce(sum(balance),0) from island_wallets where island_id=?", islandId);
    }

    private long ledgerRows(UUID islandId) {
        return count("select count(*) from island_wallet_transactions where island_id=?", islandId);
    }

    private long count(String sql, Object... args) {
        Long value = jdbc.queryForObject(sql, Long.class, args);
        return value == null ? 0L : value;
    }
}
