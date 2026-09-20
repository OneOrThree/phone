package com.oneorthree.phone.internal.service;

import com.oneorthree.phone.construction.repository.IslandFacilityRepository;
import com.oneorthree.phone.construction.repository.domain.IslandFacility;
import com.oneorthree.phone.construction.repository.domain.ConstructionBuilding;
import com.oneorthree.phone.focus.repository.FocusSessionDetailRepository;
import com.oneorthree.phone.focus.repository.FocusSessionIntervalRepository;
import com.oneorthree.phone.focus.repository.FocusSessionRepository;
import com.oneorthree.phone.focus.repository.domain.FocusIntervalKind;
import com.oneorthree.phone.focus.repository.domain.FocusSession;
import com.oneorthree.phone.focus.repository.domain.FocusSessionDetail;
import com.oneorthree.phone.focus.repository.domain.FocusSessionInterval;
import com.oneorthree.phone.focus.repository.domain.FocusSessionLifecycle;
import com.oneorthree.phone.focus.repository.domain.FocusType;
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
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.when;

/**
 * 주간 섬 랭킹의 Data 통합 검증 (GROMO-1997) — 실 Flyway(V85 포함)·{@code ddl-auto=validate} 스키마 위에서
 * 운영 엔티티·저장소로 섬·주민·전망대·집중 구간을 심고, 서비스의 실제 경로로 조회한다.
 *
 * <p>시각은 서버 {@link Clock} 빈을 제어해 UTC 일요일 자정 경계를 재현한다
 * ({@code IslandRecordsIntegrationTest} 와 같은 방식).
 */
@SpringBootTest
class IslandRankingsIntegrationTest {

    /**
     * 테스트마다 <b>다른 주</b>를 쓴다 — 이 랭킹은 «모든 섬»을 가로지르므로, 같은 주를 공유하면 앞선
     * 테스트가 심은 섬이 뒤 테스트의 순위에 그대로 섞인다(순위·목록이 전역 값이라 섬만 갈라서는 부족하다).
     * 2033-01-02 는 일요일이고 거기서 한 주씩 뒤로 간다.
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
    GroupRepository groups;
    @Autowired
    GroupMemberRepository members;
    @Autowired
    UserIslandContextRepository contexts;
    @Autowired
    IslandFacilityRepository facilities;
    @Autowired
    FocusSessionRepository sessions;
    @Autowired
    FocusSessionDetailRepository details;
    @Autowired
    FocusSessionIntervalRepository intervals;
    @Autowired
    IslandWeeklyMemberCountRepository denominators;
    @Autowired
    IslandRankingFreezeService freezeService;
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
        groups.save(ended.group);
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
    @DisplayName("평균 = 그 섬 집중 합 ÷ 동결 주민 수. 휴식은 빼고, 다른 섬 집중과 진행 중 세션도 빼며, 주 경계에서 잘린다")
    void averageUsesIslandAttributedCompletedActiveSecondsOverFrozenMembers() {
        Island home = island("우리 섬", true);
        Island other = island("다른 섬", true);
        User resident = resident(home.group);

        Instant monday = at(1, 10);

        // ① 주 안의 완료 집중 600초 (휴식 300초는 빠진다)
        UUID session = session(resident, home.id, FocusSessionLifecycle.COMPLETED);
        interval(session, 1, FocusIntervalKind.ACTIVE, monday, monday.plusSeconds(300));
        interval(session, 2, FocusIntervalKind.REST, monday.plusSeconds(300), monday.plusSeconds(600));
        interval(session, 3, FocusIntervalKind.ACTIVE, monday.plusSeconds(600), monday.plusSeconds(900));

        // ② 주 경계를 걸친 세션 — 주 «안»의 몫(다음 일요일 00:00Z 까지 600초)만 센다
        Instant boundary = RankingWeek.endInstant(week);
        UUID straddling = session(resident, home.id, FocusSessionLifecycle.COMPLETED);
        interval(straddling, 1, FocusIntervalKind.ACTIVE, boundary.minusSeconds(600), boundary.plusSeconds(600));

        // ③ 같은 주민이 «다른 섬»에서 한 집중 — 우리 섬 분자가 아니다
        UUID elsewhere = session(resident, other.id, FocusSessionLifecycle.COMPLETED);
        interval(elsewhere, 1, FocusIntervalKind.ACTIVE, at(2, 10), at(2, 11));

        // ④ 아직 끝나지 않은 집중 — 끝난 집중만 반영한다
        UUID running = session(resident, home.id, FocusSessionLifecycle.ACTIVE);
        interval(running, 1, FocusIntervalKind.ACTIVE, at(3, 10), null);

        freeze(week);
        IslandRankingPage page = service.islands(home.owner.getId(), week, null);

        // 우리 섬: (600 + 600) ÷ 주민 2명 = 600
        assertThat(item(page, home.id).averageFocusSeconds()).isEqualTo(600);
        // 다른 섬: 3600 ÷ 주민 1명(방장) = 3600 — 그 주민은 다른 섬 소속이 아니지만 기여는 세션의 섬에 붙는다
        assertThat(item(page, other.id).averageFocusSeconds()).isEqualTo(3600);
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
        focus(home, 600);
        focus(tied, 600);
        focus(slower, 60);
        freeze(week);

        IslandRankingPage page = service.islands(home.owner.getId(), week, null);

        assertThat(item(page, home.id).rank()).isEqualTo(1);
        assertThat(item(page, tied.id).rank()).isEqualTo(1);
        assertThat(item(page, slower.id).rank()).isEqualTo(3);
    }

    @Test
    @DisplayName("목록이 잘려도 myRank 는 «전체 모집단» 기준이다 — 상위 N 안에 없어도 자기 순위를 받는다")
    void myRankIsOverTheWholePopulationNotThePage() {
        Island home = island("우리 섬", true);
        focus(home, 60);
        Island faster = island("빠른 섬", true);
        focus(faster, 6000);
        Island fastest = island("가장 빠른 섬", true);
        focus(fastest, 60000);
        freeze(week);

        IslandRankingPage page = service.islands(home.owner.getId(), week, 1);

        assertThat(page.items()).hasSize(1);
        assertThat(page.items().get(0).islandId()).isEqualTo(fastest.id);
        assertThat(page.myRank()).as("목록에 없어도 전체에서 3위").isEqualTo(3);
    }

    // ---------------------------------------------------------------- 분모 동결

    @Test
    @DisplayName("분모 동결 — 주가 끝난 뒤 주민을 내보내도 지난 주 순위가 오르지 않는다(강퇴 조작 차단)")
    void kickingAfterTheWeekEndsCannotRaiseLastWeeksAverage() {
        Island home = island("우리 섬", true);
        User leaving = resident(home.group);
        resident(home.group);
        focus(home, 1200);
        freeze(week);

        // 주민 3명 기준 평균 400
        long before = item(service.islands(home.owner.getId(), week, null), home.id).averageFocusSeconds();
        assertThat(before).isEqualTo(400);

        // 주가 끝난 «뒤» 한 명을 내보낸다 — 지금 인원으로 나눴다면 600 으로 올랐을 것이다.
        GroupMember member = members.findByGroup(home.group).stream()
                .filter(row -> row.getUser().getId().equals(leaving.getId())).findFirst().orElseThrow();
        member.kick();
        members.save(member);

        long after = item(service.islands(home.owner.getId(), week, null), home.id).averageFocusSeconds();
        assertThat(after).as("동결된 분모라 지난 주 순위는 움직이지 않는다").isEqualTo(before);
    }

    @Test
    @DisplayName("진행 중인 이번 주는 «지금» 인원으로 나눈다 — 아직 동결할 것이 없다")
    void currentWeekDividesByLiveMembers() {
        // 시계를 대상 주 «한가운데»로 옮긴다 — 그 주가 곧 「이번 주」다.
        NOW.set(week.plusDays(2).atStartOfDay(ZoneOffset.UTC).toInstant());
        Island home = island("우리 섬", true);
        resident(home.group);
        focusIn(home, week, 1200);

        // 동결 행이 없지만 지금 인원 2명으로 나눈다.
        IslandRankingPage page = service.islands(home.owner.getId(), week, null);

        assertThat(item(page, home.id).averageFocusSeconds()).isEqualTo(600);
        assertThat(denominators.findByWeekStart(week)).isEmpty();
    }

    @Test
    @DisplayName("끝난 주에 동결 행이 없으면 그 섬은 랭킹에서 빠진다 — 지금 인원으로 대체하지 않는다")
    void pastWeekWithoutAFrozenDenominatorIsExcluded() {
        Island home = island("우리 섬", true);
        Island frozen = island("동결된 섬", true);
        focus(home, 1200);
        focus(frozen, 60);
        // frozen 섬만 동결한다 — home 은 그 주의 분모가 없다.
        freezeOnly(week, frozen.id, 1);

        IslandRankingPage page = service.islands(home.owner.getId(), week, null);

        assertThat(page.items()).extracting(IslandRanking::islandId).containsExactly(frozen.id);
        assertThat(page.myRank()).as("분모가 없으면 참가가 아니다 — 0위를 만들지 않는다").isNull();
    }

    @Test
    @DisplayName("동결은 멱등 — 다시 돌려도 이미 적힌 값을 덮지 않는다")
    void freezingTwiceKeepsTheFirstValue() {
        Island home = island("우리 섬", true);
        assertThat(freezeService.freeze(week)).isPositive();
        int frozen = denominators.findByWeekStart(week).stream()
                .filter(row -> row.getIslandId().equals(home.id)).findFirst().orElseThrow().getMemberCount();

        resident(home.group);
        assertThat(freezeService.freeze(week)).as("두 번째 실행은 새 행을 적지 않는다").isZero();

        assertThat(denominators.findByWeekStart(week).stream()
                .filter(row -> row.getIslandId().equals(home.id)).findFirst().orElseThrow().getMemberCount())
                .isEqualTo(frozen);
    }

    @Test
    @DisplayName("집중이 0인 섬은 줄 세우지 않는다 — 0점 참가를 지어내지 않는다")
    void islandsWithoutFocusDoNotParticipate() {
        Island home = island("우리 섬", true);
        Island active = island("집중한 섬", true);
        focus(active, 600);
        freeze(week);

        IslandRankingPage page = service.islands(home.owner.getId(), week, null);

        assertThat(page.items()).extracting(IslandRanking::islandId).containsExactly(active.id);
        assertThat(page.myRank()).isNull();
    }

    // ---------------------------------------------------------------- 도구

    private static Instant t(String instant) {
        return Instant.parse(instant);
    }

    /** 대상 주의 {@code dayOffset} 째 날 {@code hour} 시(UTC). */
    private Instant at(int dayOffset, int hour) {
        return week.plusDays(dayOffset).atStartOfDay(ZoneOffset.UTC).toInstant().plusSeconds(hour * 3600L);
    }

    /** 동결은 서비스를 통한다 — 리포지토리는 트랜잭션 경계를 소유하지 않는다(규약 §4·§5). */
    private void freeze(LocalDate target) {
        freezeService.freeze(target);
    }

    /** 운영에서도 이 표를 쓰는 것은 네이티브 SQL 한 문장이다 — 테스트도 같은 자리에서 한 행만 심는다. */
    private void freezeOnly(LocalDate week, UUID islandId, int count) {
        jdbc.update("INSERT INTO island_weekly_member_counts (week_start, island_id, member_count) VALUES (?, ?, ?)",
                java.sql.Date.valueOf(week), islandId, count);
    }

    /** 그 섬의 방장이 대상 주에 완료 집중 {@code seconds} 초를 한다. */
    private void focus(Island island, int seconds) {
        focusIn(island, week, seconds);
    }

    private void focusIn(Island island, LocalDate target, int seconds) {
        Instant start = target.plusDays(1).atStartOfDay(ZoneOffset.UTC).toInstant();
        UUID session = session(island.owner, island.id, FocusSessionLifecycle.COMPLETED);
        interval(session, 1, FocusIntervalKind.ACTIVE, start, start.plusSeconds(seconds));
    }

    private Island island(String name, boolean withObservatory) {
        User owner = users.save(User.builder().nickname("방장-" + UUID.randomUUID()).build());
        Group group = groups.save(Group.builder().name(name).maxMembers(15).build());
        members.save(GroupMember.builder().user(owner).group(group).role(GroupMemberRole.OWNER).build());
        contexts.save(UserIslandContext.builder().userId(owner.getId()).currentIslandId(group.getId()).build());
        if (withObservatory) {
            IslandFacility tower = IslandFacility.started(group.getId(), ConstructionBuilding.TOWER.id(), 5440, 1,
                    owner.getId(), t("2030-01-01T00:00:00Z"), t("2030-01-01T02:30:00Z"));
            tower.complete(t("2030-01-01T02:30:00Z"));
            facilities.save(tower);
        }
        return new Island(group.getId(), group, owner);
    }

    private User resident(Group group) {
        User user = users.save(User.builder().nickname("주민-" + UUID.randomUUID()).build());
        members.save(GroupMember.builder().user(user).group(group).role(GroupMemberRole.MEMBER).build());
        return user;
    }

    private UUID session(User user, UUID islandId, FocusSessionLifecycle lifecycle) {
        Instant started = at(1, 10);
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
