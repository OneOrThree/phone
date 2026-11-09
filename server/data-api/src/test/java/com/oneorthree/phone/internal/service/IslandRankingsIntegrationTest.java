package com.oneorthree.phone.internal.service;

import com.oneorthree.phone.construction.repository.IslandFacilityRepository;
import com.oneorthree.phone.construction.repository.domain.IslandFacility;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.group.repository.UserIslandContextRepository;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.group.repository.domain.GroupMemberRole;
import com.oneorthree.phone.group.repository.domain.UserIslandContext;
import com.oneorthree.phone.internal.dto.IslandRankingViews.IslandRanking;
import com.oneorthree.phone.internal.dto.IslandRankingViews.IslandRankingPage;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import org.springframework.jdbc.core.JdbcTemplate;
import com.oneorthree.phone.ranking.repository.IslandWeeklyMemberCountRepository;
import com.oneorthree.phone.ranking.service.IslandRankingFreezeService;
import com.oneorthree.phone.ranking.support.RankingWeek;
import com.oneorthree.phone.stats.exception.StatsErrorCode;
import com.oneorthree.phone.stats.exception.StatsException;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.domain.User;
import org.assertj.core.api.ThrowableAssert.ThrowingCallable;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.when;

/**
 * 섬 랭킹의 Data 통합 검증 (GROMO-1997, GROMO-2769) — 실 Flyway·{@code ddl-auto=validate} 스키마 위에서
 * 운영 엔티티·저장소로 섬·주민·전망대를 심고, 7일 평균 스냅샷({@code island_focus_averages}) 행을 적은 뒤 서비스의 실제
 * 경로로 조회한다. 평균 계산 자체는 {@code IslandFocusAverageSnapshotIntegrationTest} 가 겨눈다.
 *
 * <p>시각은 서버 {@link Clock} 빈을 제어해 UTC 일요일 자정 경계를 재현한다
 * ({@code IslandRecordsIntegrationTest} 와 같은 방식).
 */
@SpringBootTest
class IslandRankingsIntegrationTest {

    /**
     * 테스트마다 <b>다른 주</b>를 쓴다 — 이 랭킹은 «모든 섬»을 가로지르므로, 같은 주를 공유하면 앞선
     * 테스트가 심은 섬이 뒤 테스트의 순위에 그대로 섞인다(순위·목록이 전역 값이라 섬만 갈라서는 부족하다).
     * 2033-01-02 는 일요일이고 거기서 한 주씩 뒤로 간다. 랭킹은 «그 주 끝(다음 일요일) 이하의 가장 최근 스냅샷 날» 을
     * 읽으므로, 각 테스트가 자기 주의 다음 일요일에 행을 적으면 앞선 테스트의 행(더 이른 날)은 섞이지 않는다.
     */
    private static final LocalDate FIRST_WEEK = LocalDate.of(2033, 1, 2);
    private static final AtomicInteger WEEK_SEQ = new AtomicInteger();
    private static final AtomicReference<Instant> NOW = new AtomicReference<>();

    /** 이 테스트의 대상 주(일요일). */
    private LocalDate week;

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
        registry.add("construction.facility-gates.enforce", () -> true);
    }

    @MockitoBean
    Clock clock;

    @Autowired
    IslandRankingsService service;
    @Autowired
    UserRepository users;
    @Autowired
    GroupRepository islands;
    @Autowired
    GroupMemberRepository members;
    @Autowired
    UserIslandContextRepository contexts;
    @Autowired
    IslandFacilityRepository facilities;
    @Autowired
    IslandWeeklyMemberCountRepository denominators;
    @Autowired
    IslandRankingFreezeService freezeService;
    @Autowired
    IslandFocusAverageReader telescopeAverages;
    @Autowired
    JdbcTemplate jdbc;

    @BeforeEach
    void controlClock() {
        when(clock.instant()).thenAnswer(invocation -> NOW.get());
        when(clock.getZone()).thenReturn(ZoneOffset.UTC);
        // 두 주씩 건너뛴다 — 주 경계를 걸친 세션이 «다음 주»로 흘러넘치므로, 한 주씩 주면 그 몫이
        // 바로 다음 테스트의 모집단에 섞인다.
        week = FIRST_WEEK.plusWeeks(WEEK_SEQ.getAndAdd(2));
        // 대상 주가 «끝난 뒤»가 기본이다 — 지난 주 랭킹이 이 기능의 본 모습이다.
        NOW.set(week.plusWeeks(1).plusDays(1).atStartOfDay(ZoneOffset.UTC).toInstant().plusSeconds(9 * 3600));
    }

    // ---------------------------------------------------------------- 게이트

    @Test
    @DisplayName("전망대 미완공은 OBSERVATORY_LOCKED, 현재 섬이 없으면 MEMBER_ONLY, 종료 섬은 GROUP_NOT_FOUND")
    void observatoryAndResidencyGates() {
        Island locked = island("전망대 없는 섬", false);
        assertGroupError(() -> service.islands(locked.owner.getId(), week, null),
                GroupErrorCode.OBSERVATORY_LOCKED);

        User drifting = users.save(User.builder().nickname("현재섬없음-" + UUID.randomUUID()).build());
        assertGroupError(() -> service.islands(drifting.getId(), week, null), GroupErrorCode.MEMBER_ONLY);

        Island ended = island("종료될 섬", true);
        ended.group.close();
        islands.save(ended.group);
        assertGroupError(() -> service.islands(ended.owner.getId(), week, null), GroupErrorCode.GROUP_NOT_FOUND);
    }

    @Test
    @DisplayName("주 식별자는 UTC 일요일뿐 — 월요일 날짜와 아직 오지 않은 주는 422 다")
    void weekMustBeAPastOrCurrentSunday() {
        Island home = island("우리 섬", true);

        assertStatsError(() -> service.islands(home.owner.getId(), week.plusDays(1), null),
                StatsErrorCode.RANKING_WEEK_OUT_OF_RANGE);
        assertStatsError(() -> service.islands(home.owner.getId(), week.plusWeeks(2), null),
                StatsErrorCode.RANKING_WEEK_OUT_OF_RANGE);

        // 진행 중인 이번 주는 볼 수 있다.
        LocalDate current = week.plusWeeks(1);
        assertThat(service.islands(home.owner.getId(), current, null).week()).isEqualTo(current.toString());
    }

    // ---------------------------------------------------------------- 평균·순위

    @Test
    @DisplayName("평균 = 망원경과 같은 7일 평균 스냅샷(분 × 60) — 가장 최근 날의 행을 읽고 그 값으로 줄 세운다")
    void averageIsTheTelescopeSnapshot() {
        Island home = island("우리 섬", true);
        Island other = island("다른 섬", true);
        snapshot(home, snapDate().minusDays(1), 500);
        snapshot(home, snapDate(), 30);
        snapshot(other, snapDate(), 90);

        IslandRankingPage page = service.islands(home.owner.getId(), week, null);

        assertThat(item(page, home.id).averageFocusSeconds()).as("전날 행(500분)이 아니라 최근 날 행").isEqualTo(30 * 60);
        assertThat(item(page, other.id).averageFocusSeconds()).isEqualTo(90 * 60);
        assertThat(item(page, home.id).averageFocusSeconds())
                .as("망원경이 읽는 값과 같다")
                .isEqualTo(telescopeAverages.latest(List.of(home.id)).get(home.id).getAsInt() * 60L);
        assertThat(item(page, other.id).rank()).isEqualTo(1);
        assertThat(item(page, home.id).rank()).isEqualTo(2);
        assertThat(page.myRank()).isEqualTo(2);
        assertThat(page.asOf()).isEqualTo(NOW.get());
    }

    @Test
    @DisplayName("동점은 공동 순위 — 1,1,3 이고 그다음은 건너뛴다")
    void tiesShareRankAndSkipTheNext() {
        Island home = island("우리 섬", true);
        Island tied = island("동점 섬", true);
        Island slower = island("느린 섬", true);
        snapshot(home, snapDate(), 10);
        snapshot(tied, snapDate(), 10);
        snapshot(slower, snapDate(), 1);

        IslandRankingPage page = service.islands(home.owner.getId(), week, null);

        assertThat(item(page, home.id).rank()).isEqualTo(1);
        assertThat(item(page, tied.id).rank()).isEqualTo(1);
        assertThat(item(page, slower.id).rank()).isEqualTo(3);
    }

    @Test
    @DisplayName("목록이 잘려도 myRank 는 «전체 모집단» 기준이다 — 상위 N 안에 없어도 자기 순위를 받는다")
    void myRankIsOverTheWholePopulationNotThePage() {
        Island home = island("우리 섬", true);
        Island faster = island("빠른 섬", true);
        Island fastest = island("가장 빠른 섬", true);
        snapshot(home, snapDate(), 1);
        snapshot(faster, snapDate(), 100);
        snapshot(fastest, snapDate(), 1000);

        IslandRankingPage page = service.islands(home.owner.getId(), week, 1);

        assertThat(page.items()).hasSize(1);
        assertThat(page.items().get(0).islandId()).isEqualTo(fastest.id);
        assertThat(page.myRank()).as("목록에 없어도 전체에서 3위").isEqualTo(3);
    }

    @Test
    @DisplayName("비공개 섬도 순위와 myRank 모집단에 든다 — 랭킹은 섬 공개 여부를 보지 않는다(GROMO-2305)")
    void privateIslandsAreRanked() {
        Island home = island("우리 비공개 섬", true);
        Island hidden = island("비공개 일등섬", true);
        snapshot(home, snapDate(), 1);
        snapshot(hidden, snapDate(), 1000);
        jdbc.update("update islands set is_private = true where id in (?, ?)", home.id, hidden.id);

        IslandRankingPage page = service.islands(home.owner.getId(), week, null);

        assertThat(page.items()).extracting(IslandRanking::islandId).containsExactly(hidden.id, home.id);
        assertThat(page.myRank()).isEqualTo(2);
    }

    @Test
    @DisplayName("평균 0분·주민 0명(null)·그날 행 없음·닫힌 섬은 줄 세우지 않는다 — 0점 참가를 지어내지 않는다")
    void islandsWithoutAPositiveAverageDoNotParticipate() {
        Island home = island("우리 섬", true);
        Island empty = island("빈 섬", true);
        Island stale = island("옛 행만 있는 섬", true);
        Island closed = island("닫힌 섬", true);
        Island active = island("집중한 섬", true);
        snapshot(home, snapDate(), 0);
        snapshot(empty, snapDate(), null);
        snapshot(stale, snapDate().minusDays(1), 50);
        snapshot(closed, snapDate(), 70);
        snapshot(active, snapDate(), 10);
        jdbc.update("update islands set deleted_at = now() where id = ?", closed.id);

        IslandRankingPage page = service.islands(home.owner.getId(), week, null);

        assertThat(page.items()).extracting(IslandRanking::islandId).containsExactly(active.id);
        assertThat(page.myRank()).as("items 에서 빠졌으면 myRank 도 null 이어야 한다").isNull();
    }

    @Test
    @DisplayName("지난 주는 그 주가 끝나는 일요일까지의 스냅샷, 이번 주는 가장 최근 스냅샷을 읽는다")
    void weekPicksTheSnapshotAtItsEnd() {
        Island home = island("우리 섬", true);
        snapshot(home, snapDate(), 10);
        snapshot(home, snapDate().plusDays(1), 20);

        assertThat(item(service.islands(home.owner.getId(), week, null), home.id).averageFocusSeconds())
                .as("주가 끝난 뒤 적힌 행은 지난 주에 섞이지 않는다").isEqualTo(10 * 60);
        LocalDate current = RankingWeek.weekStart(NOW.get());
        assertThat(item(service.islands(home.owner.getId(), current, null), home.id).averageFocusSeconds())
                .isEqualTo(20 * 60);
    }

    @Test
    @DisplayName("잡지 편집부 칸(top)도 같은 스냅샷·같은 순위다")
    void magazineTopUsesTheSameSnapshot() {
        Island first = island("일등섬", false);
        Island second = island("이등섬", false);
        snapshot(first, snapDate(), 300);
        snapshot(second, snapDate(), 200);

        // top 은 «asOf 가 속한 주» 를 본다 — 대상 주 한가운데로 시계를 둔다.
        List<IslandRanking> top = service.top(at(3, 0), 2);

        assertThat(top).extracting(IslandRanking::islandId).containsExactly(first.id, second.id);
        assertThat(top).extracting(IslandRanking::averageFocusSeconds).containsExactly(300 * 60L, 200 * 60L);
    }

    // ---------------------------------------------------------------- 분모 동결 (GROMO-2769 뒤로 랭킹은 읽지 않는다)

    @Test
    @DisplayName("동결은 멱등 — 다시 돌려도 이미 적힌 값을 덮지 않는다")
    void freezingTwiceKeepsTheFirstValue() {
        Island home = island("우리 섬", true);
        assertThat(freezeAt(week, RankingWeek.endInstant(week))).isPositive();
        int frozen = frozenCount(home);

        resident(home.group);
        assertThat(freezeAt(week, RankingWeek.endInstant(week)))
                .as("두 번째 실행은 새 행을 적지 않는다").isZero();

        assertThat(frozenCount(home)).isEqualTo(frozen);
    }

    @Test
    @DisplayName("경계 직후 가입은 지난 주 분모에 들어가지 않는다 — 기준은 크론 실행 시각이 아니라 주 종료 경계다")
    void joinsAfterTheBoundaryDoNotEnterLastWeeksDenominator() {
        Island home = island("우리 섬", true);

        // 경계가 지난 «뒤» 새 주민이 들어온다. 가입 시각은 @CreationTimestamp 라 실제 벽시계로 찍히므로
        // (모의 Clock 을 타지 않는다) 이 픽스처에서만 직접 경계 이후로 옮긴다 — 운영에서는 둘 다 벽시계다.
        Instant boundary = RankingWeek.endInstant(week);
        User late = resident(home.group);
        jdbc.update("UPDATE group_members SET created_at = ? WHERE user_id = ?",
                java.sql.Timestamp.from(boundary.plusSeconds(60)), late.getId());

        // 크론이 경계보다 늦게(유예 안에서) 돌아도 분모는 경계 시점 인원(방장 1명)이다.
        freezeAt(week, boundary.plusSeconds(120));

        assertThat(frozenCount(home)).as("경계 이후 가입자가 섞였다면 2명이 됐을 것이다").isEqualTo(1);
    }

    @Test
    @DisplayName("경계 직후 강퇴해도 지난 주 분모가 줄지 않는다 — 배치가 하루 늦게 돌아도 경계 시점 인원이다")
    void kicksAfterTheBoundaryDoNotShrinkLastWeeksDenominator() {
        Island home = island("우리 섬", true);
        User leaving = resident(home.group);
        Instant boundary = RankingWeek.endInstant(week);

        // GROMO-1997 이 닫지 못했던 창 — 주 경계가 지난 «뒤», 동결 배치가 돌기 «전»에 내보낸다.
        GroupMember member = membership(home.group, leaving);
        member.kick(boundary.plus(Duration.ofHours(6)));
        members.save(member);

        // 유예 가드가 사라져 하루 늦게 돈 실행도 거부되지 않는다(GROMO-2050).
        assertThat(freezeAt(week, boundary.plus(Duration.ofDays(1)))).isPositive();

        assertThat(frozenCount(home)).as("경계 시점 주민은 2명이다 — 강퇴가 분모를 줄였다면 1명이 됐을 것이다")
                .isEqualTo(2);
    }

    @Test
    @DisplayName("경계 «전» 이탈은 지난 주 분모에서 빠진다 — 이탈 시각이 양방향으로 판정한다")
    void leavesBeforeTheBoundaryStayOutOfLastWeeksDenominator() {
        Island home = island("우리 섬", true);
        User leaving = resident(home.group);

        // 주 한가운데에 나간다 — 경계 시점 주민은 방장 1명뿐이다.
        GroupMember member = membership(home.group, leaving);
        member.leave(at(3, 0));
        members.save(member);
        freeze(week);

        assertThat(frozenCount(home)).as("이탈 시각을 무시하고 셌다면 2명이 됐을 것이다").isEqualTo(1);
    }

    @Test
    @DisplayName("경계 전에 나갔다가 경계 뒤에 돌아온 주민은 지난 주 분모에 없다 — 재가입이 시작 시각을 갱신한다")
    void rejoinsAfterTheBoundaryDoNotEnterLastWeeksDenominator() {
        Island home = island("우리 섬", true);
        User returning = resident(home.group);
        Instant boundary = RankingWeek.endInstant(week);

        // 나갔다 돌아온 행은 «지금» 활성이지만, 되살린 시각이 경계보다 뒤다.
        // created_at(최초 가입)으로 판정하면 지난 주 주민으로 잘못 잡힌다.
        GroupMember member = membership(home.group, returning);
        member.leave(at(3, 0));
        member.rejoin(boundary.plusSeconds(60));
        members.save(member);

        freezeAt(week, boundary.plusSeconds(120));

        assertThat(frozenCount(home)).as("재가입 시각을 무시하고 created_at 으로 셌다면 2명이 됐을 것이다").isEqualTo(1);
    }

    // ---------------------------------------------------------------- 도구

    private static Instant t(String instant) {
        return Instant.parse(instant);
    }

    /** 대상 주의 {@code dayOffset} 째 날 {@code hour} 시(UTC). */
    private Instant at(int dayOffset, int hour) {
        return week.plusDays(dayOffset).atStartOfDay(ZoneOffset.UTC).toInstant().plusSeconds(hour * 3600L);
    }

    /**
     * 동결은 서비스를 통한다 — 리포지토리는 트랜잭션 경계를 소유하지 않는다(규약 §4·§5).
     *
     * <p>크론이 «주 종료 경계에» 도는 것을 모사한다 — 실제 운영에서도 이 배치는 경계 직후에 돈다.
     * 값 자체는 실행 시각과 무관하다(경계로 판정한다, GROMO-2050) — {@link #freezeAt} 이 그것을 겨눈다.
     */
    private void freeze(LocalDate target) {
        Instant restore = NOW.get();
        NOW.set(RankingWeek.endInstant(target));
        try {
            freezeService.freeze(target);
        } finally {
            NOW.set(restore);
        }
    }

    /** 지정한 시각에 크론이 돈 것으로 보고 동결한다 — 「실행 시각이 값을 바꾸지 않는다」를 겨냥할 때 쓴다. */
    private int freezeAt(LocalDate target, Instant ranAt) {
        Instant restore = NOW.get();
        NOW.set(ranAt);
        try {
            return freezeService.freeze(target);
        } finally {
            NOW.set(restore);
        }
    }

    /** 그 섬의 동결 분모(지난 주 주민 수). */
    private int frozenCount(Island island) {
        return denominators.findByWeekStart(week).stream()
                .filter(row -> row.getIslandId().equals(island.id)).findFirst().orElseThrow().getMemberCount();
    }

    /** 대상 주가 끝나는 다음 일요일 — 07:00 KST 배치가 그 주를 마지막으로 적는 날이다. */
    private LocalDate snapDate() {
        return week.plusDays(7);
    }

    /** 7일 평균 스냅샷 한 행 — 운영 배치({@code IslandFocusAverageRepository#insertIfAbsent})와 같은 표·열이다. */
    private void snapshot(Island island, LocalDate date, Integer minutes) {
        jdbc.update("insert into island_focus_averages (snapshot_date, island_id, member_count, "
                + "avg_minutes_per_member_day) values (?, ?, ?, ?)", date, island.id, minutes == null ? 0 : 1, minutes);
    }

    private Island island(String name, boolean withObservatory) {
        User owner = users.save(User.builder().nickname("방장-" + UUID.randomUUID()).build());
        Group group = islands.save(Group.builder().name(name).maxMembers(15).build());
        members.save(GroupMember.builder().user(owner).group(group).role(GroupMemberRole.OWNER).build());
        contexts.save(UserIslandContext.builder().userId(owner.getId()).currentIslandId(group.getId()).build());
        if (withObservatory) {
            IslandFacility tower = IslandFacility.started(group.getId(), "tower", 5440, 1,
                    owner.getId(), t("2030-01-01T00:00:00Z"), t("2030-01-01T02:30:00Z"));
            tower.complete(t("2030-01-01T02:30:00Z"));
            facilities.save(tower);
        }
        return new Island(group.getId(), group, owner);
    }

    /** 그 섬에서 이 사람의 멤버십 행 — 이탈·재가입 시각을 직접 찍을 때 쓴다(GROMO-2050). */
    private GroupMember membership(Group group, User user) {
        return members.findByGroup(group).stream()
                .filter(row -> row.getUser().getId().equals(user.getId())).findFirst().orElseThrow();
    }

    private User resident(Group group) {
        User user = users.save(User.builder().nickname("주민-" + UUID.randomUUID()).build());
        members.save(GroupMember.builder().user(user).group(group).role(GroupMemberRole.MEMBER).build());
        return user;
    }

    private static IslandRanking item(IslandRankingPage page, UUID islandId) {
        return page.items().stream().filter(row -> row.islandId().equals(islandId)).findFirst().orElseThrow();
    }

    private static void assertGroupError(ThrowingCallable call, GroupErrorCode code) {
        assertThatThrownBy(call).isInstanceOfSatisfying(GroupException.class,
                e -> assertThat(e.getErrorCode()).isEqualTo(code));
    }

    private static void assertStatsError(ThrowingCallable call, StatsErrorCode code) {
        assertThatThrownBy(call).isInstanceOfSatisfying(StatsException.class,
                e -> assertThat(e.getErrorCode()).isEqualTo(code));
    }

    private record Island(UUID id, Group group, User owner) {
    }
}
