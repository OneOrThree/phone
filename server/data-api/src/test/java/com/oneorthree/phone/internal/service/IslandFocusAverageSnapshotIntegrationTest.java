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
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import com.oneorthree.phone.ranking.repository.IslandFocusAverageRepository;
import com.oneorthree.phone.ranking.repository.domain.IslandFocusAverage;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.domain.User;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.OptionalInt;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 섬별 7일 평균 스냅샷 (GROMO-2257) — 실 Flyway(V109 포함)·{@code ddl-auto=validate} 스키마 위에서 운영 엔티티·
 * 저장소로 섬·주민·집중 구간을 심고, 배치 서비스와 읽기 창구를 <b>실제 경로로</b> 부른다. seam 을 대역으로
 * 덮지 않는다 — 합계·주민 수 질의는 운영 질의 그대로 돈다.
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

    private int rowCount(UUID islandId) {
        return jdbc.queryForObject("SELECT count(*) FROM island_focus_averages WHERE island_id = ?",
                Integer.class, islandId);
    }
}
