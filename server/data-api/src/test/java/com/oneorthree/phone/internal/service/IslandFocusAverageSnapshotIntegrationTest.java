package com.oneorthree.phone.internal.service;

import com.oneorthree.phone.common.port.IslandPurgePort;
import com.oneorthree.phone.common.util.ZonePolicy;
import com.oneorthree.phone.focus.repository.FocusSessionDetailRepository;
import com.oneorthree.phone.focus.repository.FocusSessionIntervalRepository;
import com.oneorthree.phone.focus.repository.FocusSessionRepository;
import com.oneorthree.phone.focus.repository.domain.FocusIntervalKind;
import com.oneorthree.phone.focus.repository.domain.FocusSession;
import com.oneorthree.phone.focus.repository.domain.FocusSessionDetail;
import com.oneorthree.phone.focus.repository.domain.FocusSessionInterval;
import com.oneorthree.phone.focus.repository.domain.FocusSessionLifecycle;
import com.oneorthree.phone.focus.repository.domain.FocusType;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.group.repository.domain.GroupMemberRole;
import com.oneorthree.phone.internal.scheduler.IslandFocusAverageScheduler;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import com.oneorthree.phone.outbox.support.PostgresLockWaits;
import com.oneorthree.phone.ranking.repository.IslandFocusAverageRepository;
import com.oneorthree.phone.ranking.repository.domain.IslandFocusAverage;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.domain.User;
import jakarta.persistence.EntityManager;
import javax.sql.DataSource;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.AdditionalAnswers;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.PessimisticLockingFailureException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.OptionalInt;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

/**
 * 섬별 7일 평균 스냅샷 (GROMO-2257) — 실 Flyway(V114 포함)·{@code ddl-auto=validate} 스키마 위에서 운영 엔티티·
 * 저장소로 섬·주민·집중 구간을 심고, 배치 서비스와 읽기 창구를 <b>실제 경로로</b> 부른다. seam 을 대역으로
 * 덮지 않는다 — 합계·주민 수 질의는 운영 질의 그대로 돈다.
 *
 * <p>닫히는 섬과의 경합은 실제 PostgreSQL 의 행 잠금으로 재현한다 — 한쪽이 섬 행을 쥔 채 멈추면 상대가 그 뒤에서
 * 기다리는 것을 {@code pg_blocking_pids} 로 확인한 다음에야 풀어 준다(타이밍 추측 없음).
 *
 * <p>배치가 «모든 섬»을 가로지르므로 테스트마다 <b>다른 실행일</b>을 쓴다 — 같은 날을 공유하면 앞선 테스트가
 * 적은 행이 뒤 테스트의 「새로 적은 수」·행 단정에 섞인다. 창이 7일이라 14일씩 건너뛴다.
 */
@SpringBootTest
class IslandFocusAverageSnapshotIntegrationTest {

    private static final LocalDate FIRST_DATE = LocalDate.of(2034, 3, 1);
    private static final AtomicInteger DATE_SEQ = new AtomicInteger();

    /** 이 테스트의 실행일(KST) — 창은 {@code [date-7 07:00, date 07:00)} KST. */
    private LocalDate date;

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
    }

    @Autowired
    IslandFocusAverageSnapshotService service;
    @Autowired
    IslandFocusAverageReader reader;
    @Autowired
    IslandFocusAverageRepository snapshots;
    @Autowired
    UserRepository users;
    @Autowired
    GroupRepository groups;
    @Autowired
    GroupMemberRepository members;
    @Autowired
    FocusSessionRepository sessions;
    @Autowired
    FocusSessionDetailRepository details;
    @Autowired
    FocusSessionIntervalRepository intervals;
    @Autowired
    IslandPurgePort purge;
    @Autowired
    PlatformTransactionManager transactionManager;
    @Autowired
    EntityManager entityManager;
    @Autowired
    DataSource dataSource;
    @Autowired
    JdbcTemplate jdbc;

    @BeforeEach
    void nextDate() {
        date = FIRST_DATE.plusDays(14L * DATE_SEQ.getAndIncrement());
    }

    // ---------------------------------------------------------------- 값

    @Test
    @DisplayName("주민 2명·창 안 완료 집중 840분이면 평균 60분 — 휴식·다른 섬 집중·진행 중 세션은 빠진다")
    void averageIsFocusMinutesOverMembersAndSevenDays() {
        Island home = island(false);
        User resident = resident(home.group);
        Island elsewhere = island(false);

        // 방장: 3시간 집중 + 1시간 휴식 + 4시간 집중 = 순수 집중 420분.
        Instant start = kst(date.minusDays(1), 10, 0);
        UUID ownerSession = session(home.owner, home.id, FocusSessionLifecycle.COMPLETED);
        interval(ownerSession, 1, FocusIntervalKind.ACTIVE, start, start.plus(Duration.ofHours(3)));
        interval(ownerSession, 2, FocusIntervalKind.REST,
                start.plus(Duration.ofHours(3)), start.plus(Duration.ofHours(4)));
        interval(ownerSession, 3, FocusIntervalKind.ACTIVE,
                start.plus(Duration.ofHours(4)), start.plus(Duration.ofHours(8)));
        // 주민: 3일 전 7시간 = 420분.
        completedFocus(resident, home.id, kst(date.minusDays(3), 9, 0), kst(date.minusDays(3), 16, 0));
        // 같은 주민이 «다른 섬»에서 한 집중 — 이 섬 분자가 아니다.
        completedFocus(resident, elsewhere.id, kst(date.minusDays(2), 9, 0), kst(date.minusDays(2), 20, 0));
        // 아직 끝나지 않은 집중 — 끝난 집중만 센다.
        UUID running = session(home.owner, home.id, FocusSessionLifecycle.ACTIVE);
        interval(running, 1, FocusIntervalKind.ACTIVE, kst(date.minusDays(1), 20, 0), null);

        service.snapshot(date);

        IslandFocusAverage row = row(home.id);
        assertThat(row.getMemberCount()).isEqualTo(2);
        assertThat(row.getAvgMinutesPerMemberDay()).isEqualTo(60);
        assertThat(reader.latest(List.of(home.id)).get(home.id)).isEqualTo(OptionalInt.of(60));
    }

    @Test
    @DisplayName("창은 [D-7 07:00, D 07:00) KST — 경계 직전·직후를 가르고 8일 전 세션은 빠진다")
    void windowBoundariesAreSevenKst() {
        Island home = island(false);
        User owner = home.owner;

        // 창 안: 70분.
        completedFocus(owner, home.id, kst(date.minusDays(1), 10, 0), kst(date.minusDays(1), 11, 10));
        // 창 끝(D 07:00)을 걸친다 — 06:30~07:00 의 30분만 센다.
        completedFocus(owner, home.id, kst(date, 6, 30), kst(date, 7, 30));
        // 창 시작(D-7 07:00)을 걸친다 — 07:00~07:30 의 30분만 센다.
        completedFocus(owner, home.id, kst(date.minusDays(7), 6, 30), kst(date.minusDays(7), 7, 30));
        // 정확히 창 끝에서 시작 — 창 밖이다.
        completedFocus(owner, home.id, kst(date, 7, 0), kst(date, 8, 0));
        // 정확히 창 시작에서 끝난다 — 창 밖이다.
        completedFocus(owner, home.id, kst(date.minusDays(7), 6, 0), kst(date.minusDays(7), 7, 0));
        // 8일 전 — 창 밖이다.
        completedFocus(owner, home.id, kst(date.minusDays(8), 12, 0), kst(date.minusDays(8), 13, 0));

        service.snapshot(date);

        // (70 + 30 + 30) 분 ÷ 주민 1 ÷ 7 = 18.57 → 19. 창 밖 세 건이 섞였다면 27 이다.
        assertThat(row(home.id).getAvgMinutesPerMemberDay()).isEqualTo(19);
    }

    @Test
    @DisplayName("가장 가까운 분으로 반올림한다 — 18.43 은 18, 18.57 은 19, 정확히 0.5 는 1, 0.497 은 0")
    void roundsToTheNearestMinute() {
        Island down = island(false);
        Island up = island(false);
        Island half = island(false);
        Island justBelowHalf = island(false);
        Instant at = kst(date.minusDays(1), 10, 0);
        completedFocus(down.owner, down.id, at, at.plusSeconds(129 * 60));
        completedFocus(up.owner, up.id, at, at.plusSeconds(130 * 60));
        completedFocus(half.owner, half.id, at, at.plusSeconds(210));
        completedFocus(justBelowHalf.owner, justBelowHalf.id, at, at.plusSeconds(209));

        service.snapshot(date);

        assertThat(row(down.id).getAvgMinutesPerMemberDay()).isEqualTo(18);
        assertThat(row(up.id).getAvgMinutesPerMemberDay()).isEqualTo(19);
        assertThat(row(half.id).getAvgMinutesPerMemberDay()).isEqualTo(1);
        assertThat(row(justBelowHalf.id).getAvgMinutesPerMemberDay()).isZero();
    }

    @Test
    @DisplayName("주민은 있는데 집중이 없는 섬은 0 이다 — null 이 아니다. 비공개 섬도 계산한다")
    void membersWithoutFocusAverageZero() {
        Island quiet = island(false);
        Island hidden = island(true);

        service.snapshot(date);

        IslandFocusAverage row = row(quiet.id);
        assertThat(row.getMemberCount()).isEqualTo(1);
        assertThat(row.getAvgMinutesPerMemberDay()).isZero();
        assertThat(reader.latest(List.of(quiet.id)).get(quiet.id)).isEqualTo(OptionalInt.of(0));
        assertThat(row(hidden.id).getAvgMinutesPerMemberDay()).as("비공개 섬도 해 될 것이 없다").isZero();
    }

    @Test
    @DisplayName("주민이 0명인 섬은 행이 생기고 평균이 null 이다 — 멤버 없음·전원 이탈·계정 탈퇴, 집중이 있어도 마찬가지")
    void zeroMemberIslandsGetANullAverageRow() {
        // 멤버십이 한 번도 없던 섬 — 세션·멤버십에서 출발하면 이 섬은 행이 빠진다.
        Group empty = groups.save(Group.builder().name("빈섬").maxMembers(15).build());
        // 집중한 뒤 유일한 주민이 나간 섬 — 분자는 있고 분모만 0 이다.
        Island abandoned = island(false);
        completedFocus(abandoned.owner, abandoned.id, kst(date.minusDays(1), 10, 0), kst(date.minusDays(1), 12, 0));
        GroupMember ownerMembership = membership(abandoned.group, abandoned.owner);
        ownerMembership.leave(kst(date, 3, 0));
        members.save(ownerMembership);
        // 유일한 주민이 계정을 탈퇴한 섬 — 모수는 «활성·미탈퇴» 다.
        Island withdrawn = island(false);
        jdbc.update("UPDATE users SET is_deleted = true WHERE id = ?", withdrawn.owner.getId());

        service.snapshot(date);

        for (UUID id : List.of(empty.getId(), abandoned.id, withdrawn.id)) {
            IslandFocusAverage row = row(id);
            assertThat(row.getMemberCount()).as("주민 수 %s", id).isZero();
            assertThat(row.getAvgMinutesPerMemberDay()).as("평균 %s", id).isNull();
        }
        // 읽기 쪽은 null 을 «값 없음» 으로 준다.
        assertThat(reader.latest(List.of(empty.getId(), abandoned.id, withdrawn.id)).values())
                .containsOnly(OptionalInt.empty());
    }

    @Test
    @DisplayName("죽은 섬(종료·소프트 삭제)은 행이 없고 살아 있는 섬은 있다")
    void deadIslandsGetNoRow() {
        Island ended = island(false);
        ended.group.close();
        groups.save(ended.group);
        Island deleted = island(false);
        deleted.group.markDeleted(kst(date.minusDays(1), 9, 0));
        groups.save(deleted.group);
        Island alive = island(false);

        service.snapshot(date);

        assertThat(rowCount(ended.id)).isZero();
        assertThat(rowCount(deleted.id)).isZero();
        assertThat(rowCount(alive.id)).isEqualTo(1);
    }

    @Test
    @DisplayName("섬이 삭제(공동 데이터 정리)되면 그 섬의 스냅샷 행도 함께 지워진다 — 다른 섬의 행은 남는다")
    void purgingAnIslandDeletesItsSnapshots() {
        Island closing = island(false);
        Island staying = island(false);
        service.snapshot(date);
        service.snapshot(date.plusDays(1));
        assertThat(rowCount(closing.id)).isEqualTo(2);

        // 운영의 삭제 경로(GroupMemberService)와 같은 포트 — 호출자 트랜잭션에 편승한다(MANDATORY).
        new TransactionTemplate(transactionManager).executeWithoutResult(status -> purge.purgeIsland(closing.id));

        assertThat(rowCount(closing.id)).isZero();
        assertThat(rowCount(staying.id)).isEqualTo(2);
    }

    // ---------------------------------------------------------------- 닫히는 섬과의 경합

    @Test
    @DisplayName("적는 문장은 넘겨받은 목록이 낡았어도 그사이 죽은 섬(종료·삭제)의 행을 적지 않는다 — 살아 있는 섬만 적는다")
    void insertSkipsIslandsThatDiedAfterTheListWasRead() {
        Island alive = island(false);
        Island ended = island(false);
        ended.group.close();
        groups.save(ended.group);
        Island deleted = island(false);
        deleted.group.markDeleted(kst(date.minusDays(1), 9, 0));
        groups.save(deleted.group);

        // snapshot() 이 «살아 있는 섬 목록» 을 읽은 뒤 두 섬이 죽은 상황 — 낡은 목록 그대로 세 섬을 다 넘긴다.
        UUID[] ids = {alive.id, ended.id, deleted.id};
        Integer[] memberCounts = {1, 1, 1};
        Integer[] averages = {5, 5, 5};
        Integer inserted = new TransactionTemplate(transactionManager)
                .execute(status -> snapshots.insertIfAbsent(date, ids, memberCounts, averages));

        assertThat(inserted).as("죽은 섬은 새로 적힌 행 수에 세지 않는다").isEqualTo(1);
        assertThat(rowCount(alive.id)).isEqualTo(1);
        assertThat(rowCount(ended.id)).isZero();
        assertThat(rowCount(deleted.id)).isZero();
    }

    @Test
    @DisplayName("삭제가 섬 행을 먼저 쥐고 스냅샷이 그 뒤에서 기다리면, 풀려난 스냅샷은 닫힌 섬의 행을 되살리지 않는다")
    void aSnapshotWaitingOnAClosingIslandDoesNotResurrectItsRow() throws Exception {
        Island closing = island(false);
        Island staying = island(false);
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try {
            // 운영의 삭제 경로(GroupMemberService)와 같은 순서 — 섬 행 FOR UPDATE → 종료 → 공동 데이터 정리 → 커밋.
            Future<Integer> snapshot = new TransactionTemplate(transactionManager).execute(status -> {
                Group locked = groups.findByIdForUpdate(closing.id).orElseThrow();
                int holder = backendPid();
                // 이 시점의 closing 은 아직 살아 있다 — 스냅샷은 그 섬을 목록에 넣고 INSERT 에서 잠금을 기다린다.
                Future<Integer> inFlight = pool.submit(() -> service.snapshot(date));
                awaitBlockedBy(holder);
                locked.close();
                purge.purgeIsland(closing.id);
                return inFlight;
            });

            int inserted = snapshot.get(60, TimeUnit.SECONDS);

            assertThat(rowCount(closing.id))
                    .as("삭제가 지운 뒤에 행이 적히면 묘비 섬이라 FK CASCADE 도, 다음 배치도 치우지 않는다").isZero();
            assertThat(rowCount(staying.id)).isEqualTo(1);
            assertThat(inserted).as("나머지 살아 있는 섬은 전부 적혔다").isEqualTo(aliveIslandCount());
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    @DisplayName("스냅샷이 섬 행을 먼저 쥐면 삭제는 스냅샷 커밋까지 기다렸다가 적힌 행을 함께 지운다")
    void aPurgeWaitingOnASnapshotDeletesTheRowItWrote() throws Exception {
        Island closing = island(false);
        Island staying = island(false);
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try {
            TransactionTemplate tx = new TransactionTemplate(transactionManager);
            Future<?> purging = tx.execute(status -> {
                UUID[] ids = {closing.id, staying.id};
                snapshots.insertIfAbsent(date, ids, new Integer[] {1, 1}, new Integer[] {7, 7});
                int holder = backendPid();
                // 스냅샷은 아직 커밋 전 — 섬 행 잠금과 적은 행을 쥐고 있다. 삭제가 그 뒤에서 기다린다.
                Future<?> inFlight = pool.submit(() -> tx.executeWithoutResult(inner -> {
                    Group locked = groups.findByIdForUpdate(closing.id).orElseThrow();
                    locked.close();
                    purge.purgeIsland(closing.id);
                }));
                awaitBlockedBy(holder);
                return inFlight;
            });

            purging.get(60, TimeUnit.SECONDS);

            assertThat(rowCount(closing.id)).as("커밋된 행을 삭제가 이어서 지웠다").isZero();
            assertThat(rowCount(staying.id)).isEqualTo(1);
        } finally {
            pool.shutdownNow();
        }
    }

    // ---------------------------------------------------------------- 교착 희생자 재시도

    @Test
    @DisplayName("적는 문장이 교착 희생자 오류(40P01)로 끊기면 Spring 이 PessimisticLockingFailureException 으로 번역하고 스케줄러의 재시도가 이어 받는다")
    void aDeadlockVictimInsertIsTranslatedAndRetriedByTheScheduler() {
        Island island = island(false);
        List<Throwable> failures = new ArrayList<>();
        // 진짜 서비스(트랜잭션 프록시)에 위임하되 실패를 기록하고, 첫 실패 직후 트리거를 치워 재시도는 정상 경로를 타게 한다.
        IslandFocusAverageSnapshotService probed = mock(IslandFocusAverageSnapshotService.class, invocation -> {
            try {
                return AdditionalAnswers.delegatesTo(service).answer(invocation);
            } catch (Throwable failure) {
                failures.add(failure);
                dropDeadlockProbe();
                throw failure;
            }
        });
        try {
            // 실제 교착은 deadlock_timeout 타이밍에 기대 불안정하다 — 같은 SQLSTATE(40P01)를 INSERT 문장 시작에서 낸다.
            // 오류는 드라이버부터 Hibernate·Spring 번역·@Transactional 롤백까지 운영과 같은 경로로 올라온다.
            // 생성은 try 안이다 — 어디서 터져도 finally 가 치운다. 남으면 같은 컨테이너의 뒤 테스트가 전부 40P01 로 실패한다.
            jdbc.execute("CREATE OR REPLACE FUNCTION island_focus_averages_deadlock_probe() RETURNS trigger "
                    + "LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'deadlock detected (test)' "
                    + "USING ERRCODE = '40P01'; END $$");
            jdbc.execute("CREATE TRIGGER island_focus_averages_deadlock_probe BEFORE INSERT ON island_focus_averages "
                    + "FOR EACH STATEMENT EXECUTE FUNCTION island_focus_averages_deadlock_probe()");
            new IslandFocusAverageScheduler(probed, Clock.fixed(kst(date, 7, 0), ZoneOffset.UTC)).snapshotToday();
        } finally {
            dropDeadlockProbe();
        }

        assertThat(failures).as("첫 시도만 끊긴다").singleElement()
                .isInstanceOf(PessimisticLockingFailureException.class)
                .satisfies(failure -> assertThat(PostgresLockWaits.sqlStateOf(failure)).isEqualTo("40P01"));
        verify(probed, times(2)).snapshot(date);
        assertThat(rowCount(island.id)).as("재시도가 적었다").isEqualTo(1);
    }

    // ---------------------------------------------------------------- 멱등·읽기

    @Test
    @DisplayName("같은 날 두 번째 실행은 0행이고 첫 값을 덮지 않는다 — 다음 날 실행은 그 사이 바뀐 값을 새 행으로 적는다")
    void sameDayRerunKeepsTheFirstValue() {
        Island home = island(false);
        completedFocus(home.owner, home.id, kst(date.minusDays(1), 10, 0), kst(date.minusDays(1), 11, 10));

        int alive = jdbc.queryForObject("SELECT count(*) FROM groups WHERE deleted_at IS NULL AND status <> 'ENDED'",
                Integer.class);
        assertThat(service.snapshot(date)).as("살아 있는 섬마다 한 행").isEqualTo(alive);
        assertThat(row(home.id).getAvgMinutesPerMemberDay()).isEqualTo(10);

        // 그 사이 주민이 늘고 집중이 쌓여 «지금» 계산하면 다른 값이 나온다.
        resident(home.group);
        completedFocus(home.owner, home.id, kst(date.minusDays(2), 10, 0), kst(date.minusDays(2), 20, 0));
        assertThat(service.snapshot(date)).as("두 번째 실행은 새 행을 적지 않는다").isZero();

        IslandFocusAverage kept = row(home.id);
        assertThat(kept.getMemberCount()).isEqualTo(1);
        assertThat(kept.getAvgMinutesPerMemberDay()).isEqualTo(10);
        assertThat(reader.latest(List.of(home.id)).get(home.id))
                .as("같은 날 몇 번을 읽어도 같은 값").isEqualTo(OptionalInt.of(10));

        // 다음 날은 새 행 — (70 + 600)분 ÷ 주민 2 ÷ 7 = 47.86 → 48.
        assertThat(service.snapshot(date.plusDays(1))).isPositive();
        assertThat(snapshots.findById(new IslandFocusAverage.Key(date.plusDays(1), home.id)).orElseThrow()
                .getAvgMinutesPerMemberDay()).isEqualTo(48);
    }

    @Test
    @DisplayName("reader 는 섬마다 가장 최근 날짜의 행을 준다 — 최근 행이 null 이면 옛 값으로 되돌아가지 않고, 행이 없으면 empty")
    void readerReturnsTheLatestRowPerIsland() {
        Island steady = island(false);
        Island emptied = island(false);
        Island dying = island(false);
        completedFocus(steady.owner, steady.id, kst(date.minusDays(1), 10, 0), kst(date.minusDays(1), 17, 0));
        completedFocus(emptied.owner, emptied.id, kst(date.minusDays(1), 10, 0), kst(date.minusDays(1), 17, 0));
        completedFocus(dying.owner, dying.id, kst(date.minusDays(1), 10, 0), kst(date.minusDays(1), 17, 0));

        service.snapshot(date);
        assertThat(reader.latest(List.of(steady.id, emptied.id, dying.id)).values())
                .as("첫날은 셋 다 420분 ÷ 7 = 60").containsOnly(OptionalInt.of(60));

        // 이튿날: steady 는 집중이 더 쌓이고, emptied 는 주민이 전부 나가고, dying 은 종료된다.
        completedFocus(steady.owner, steady.id, kst(date, 1, 0), kst(date, 4, 30));
        ownerLeaves(emptied);
        dying.group.close();
        groups.save(dying.group);
        service.snapshot(date.plusDays(1));

        Map<UUID, OptionalInt> latest = reader.latest(List.of(steady.id, emptied.id, dying.id));
        // (420 + 210)분 ÷ 1 ÷ 7 = 90.
        assertThat(latest.get(steady.id)).isEqualTo(OptionalInt.of(90));
        assertThat(latest.get(emptied.id)).as("최근 행이 null 이면 옛 60 으로 돌아가지 않는다").isEqualTo(OptionalInt.empty());
        assertThat(latest.get(dying.id)).as("새 행이 없는 섬은 마지막으로 적힌 행이다").isEqualTo(OptionalInt.of(60));

        // 한 번도 집계되지 않은 섬은 키는 있고 값이 empty 다 — 호출자가 널 검사 없이 쓴다. 빈 입력은 빈 맵이다.
        UUID unknown = UUID.randomUUID();
        assertThat(reader.latest(List.of(steady.id, unknown)))
                .containsEntry(unknown, OptionalInt.empty()).containsEntry(steady.id, OptionalInt.of(90));
        assertThat(reader.latest(List.of())).isEmpty();
    }

    // ---------------------------------------------------------------- 도구

    private record Island(UUID id, Group group, User owner) {
    }

    /** 방장 한 명짜리 섬. */
    private Island island(boolean isPrivate) {
        User owner = users.save(User.builder().nickname("방장-" + UUID.randomUUID()).build());
        Group group = groups.save(Group.builder().name("평균섬").maxMembers(15).isPrivate(isPrivate).build());
        members.save(GroupMember.builder().user(owner).group(group).role(GroupMemberRole.OWNER).build());
        return new Island(group.getId(), group, owner);
    }

    private User resident(Group group) {
        User user = users.save(User.builder().nickname("주민-" + UUID.randomUUID()).build());
        members.save(GroupMember.builder().user(user).group(group).role(GroupMemberRole.MEMBER).build());
        return user;
    }

    private GroupMember membership(Group group, User user) {
        return members.findByGroup(group).stream()
                .filter(row -> row.getUser().getId().equals(user.getId())).findFirst().orElseThrow();
    }

    private void ownerLeaves(Island island) {
        GroupMember membership = membership(island.group, island.owner);
        membership.leave(kst(date, 3, 0));
        members.save(membership);
    }

    /** {@code day} 의 {@code hour}:{@code minute} KST. */
    private static Instant kst(LocalDate day, int hour, int minute) {
        return day.atTime(hour, minute).atZone(ZonePolicy.KST).toInstant();
    }

    /** 완료된 세션 하나에 순수 집중(ACTIVE) 구간 하나. */
    private void completedFocus(User user, UUID islandId, Instant from, Instant to) {
        UUID session = session(user, islandId, FocusSessionLifecycle.COMPLETED);
        interval(session, 1, FocusIntervalKind.ACTIVE, from, to);
    }

    private UUID session(User user, UUID islandId, FocusSessionLifecycle lifecycle) {
        Instant started = kst(date.minusDays(1), 10, 0);
        UUID id = sessions.save(FocusSession.builder().user(user).focusType(FocusType.INFINITE)
                .startedAt(started).build()).getId();
        details.save(FocusSessionDetail.builder().sessionId(id).userId(user.getId()).islandId(islandId)
                .membershipEpochAtStart(1L).subject("공부").targetMinutes(30).lifecycle(lifecycle)
                .lastTransitionAt(started).build());
        return id;
    }

    private void interval(UUID sessionId, int ordinal, FocusIntervalKind kind, Instant startedAt, Instant endedAt) {
        intervals.save(FocusSessionInterval.builder().sessionId(sessionId).ordinal(ordinal).kind(kind)
                .startedAt(startedAt).endedAt(endedAt).build());
    }

    /** 이 테스트 실행일의 그 섬 스냅샷 행. */
    private IslandFocusAverage row(UUID islandId) {
        return snapshots.findById(new IslandFocusAverage.Key(date, islandId)).orElseThrow();
    }

    /** 살아 있는(미삭제·미종료) 섬 수 — 이 DB 의 전부다. */
    private int aliveIslandCount() {
        return jdbc.queryForObject("SELECT count(*) FROM groups WHERE deleted_at IS NULL AND status <> 'ENDED'",
                Integer.class);
    }

    /** 지금 트랜잭션이 쥔 커넥션의 PostgreSQL 백엔드 pid. */
    private int backendPid() {
        return ((Number) entityManager.createNativeQuery("SELECT pg_backend_pid()").getSingleResult()).intValue();
    }

    /**
     * {@code holderPid} 백엔드가 쥔 잠금에 막힌 백엔드가 생길 때까지 기다린다 — 스레드 타이밍을 추측하지 않고 서버
     * 상태로 순서를 맞춘다(관찰은 당사자가 아닌 별도 연결로 한다). 트랜잭션 콜백 안에서 부르므로 검사 예외를 던지지 않는다.
     */
    private void awaitBlockedBy(int holderPid) {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(60);
        try (Connection observer = dataSource.getConnection();
                PreparedStatement query = observer.prepareStatement(
                        "SELECT count(*) FROM pg_stat_activity WHERE ? = ANY(pg_blocking_pids(pid))")) {
            while (System.nanoTime() < deadline) {
                query.setInt(1, holderPid);
                try (ResultSet row = query.executeQuery()) {
                    row.next();
                    if (row.getInt(1) > 0) {
                        return;
                    }
                }
                TimeUnit.MILLISECONDS.sleep(20);
            }
        } catch (SQLException failure) {
            throw new IllegalStateException(failure);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(interrupted);
        }
        throw new AssertionError("pid " + holderPid + " 가 쥔 잠금에 막힌 백엔드가 없다 — 경합 창에 들어가지 못했다");
    }

    private void dropDeadlockProbe() {
        jdbc.execute("DROP TRIGGER IF EXISTS island_focus_averages_deadlock_probe ON island_focus_averages");
        jdbc.execute("DROP FUNCTION IF EXISTS island_focus_averages_deadlock_probe()");
    }

    private int rowCount(UUID islandId) {
        return jdbc.queryForObject("SELECT count(*) FROM island_focus_averages WHERE island_id = ?",
                Integer.class, islandId);
    }
}
