package com.oneorthree.phone.internal.service;

import com.oneorthree.phone.auth.service.AuthService;
import com.oneorthree.phone.auth.support.JwtProvider;
import com.oneorthree.phone.construction.repository.IslandFacilityRepository;
import com.oneorthree.phone.construction.repository.domain.IslandFacility;
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
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.group.repository.domain.GroupMemberRole;
import com.oneorthree.phone.internal.dto.IslandRecordViews.DaySeconds;
import com.oneorthree.phone.internal.dto.IslandRecordViews.FocusMember;
import com.oneorthree.phone.internal.dto.IslandRecordViews.FocusRecord;
import com.oneorthree.phone.internal.dto.IslandRecordViews.FocusStatistics;
import com.oneorthree.phone.internal.dto.IslandRecordViews.ScreenDay;
import com.oneorthree.phone.internal.dto.IslandRecordViews.ScreenMember;
import com.oneorthree.phone.internal.dto.IslandRecordViews.ScreenTimeDay;
import com.oneorthree.phone.internal.dto.IslandRecordViews.ScreenTimeStatistics;
import com.oneorthree.phone.internal.dto.IslandRecordViews.ScreenTimeUpload;
import com.oneorthree.phone.outbox.exception.OutboxErrorCode;
import com.oneorthree.phone.outbox.exception.OutboxException;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import com.oneorthree.phone.screentime.repository.ScreenTimeObservationRepository;
import com.oneorthree.phone.screentime.repository.domain.ScreenTimeObservation;
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
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.when;

/**
 * 회관 기록 3종의 Data 통합 검증 (GROMO-1769) — 실 Flyway(V79 포함)·{@code ddl-auto=validate} 스키마 위에서
 * 운영 엔티티·저장소로 섬·주민·도서관·집중 구간을 심고, 서비스의 실제 경로로 조회·측정 저장을 한다.
 *
 * <p>시각은 서버 {@link Clock} 빈을 제어해 UTC 자정 경계를 재현한다(IslandQuestIntegrationTest 와 같은 방식).
 * 시설 게이트를 켜서 도서관 미완공 403 을 본다.
 */
@SpringBootTest
class IslandRecordsIntegrationTest {

    /** UTC 날짜 D. */
    private static final LocalDate D = LocalDate.of(2031, 3, 10);
    private static final AtomicReference<Instant> NOW = new AtomicReference<>();

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
        registry.add("construction.facility-gates.enforce", () -> true);
    }

    @MockitoBean
    Clock clock;

    @Autowired
    IslandRecordsService service;
    @Autowired
    AuthService auth;
    @Autowired
    JwtProvider jwt;
    @Autowired
    UserRepository users;
    @Autowired
    GroupRepository groups;
    @Autowired
    GroupMemberRepository members;
    @Autowired
    IslandFacilityRepository facilities;
    @Autowired
    FocusSessionRepository sessions;
    @Autowired
    FocusSessionDetailRepository details;
    @Autowired
    FocusSessionIntervalRepository intervals;
    @Autowired
    ScreenTimeObservationRepository observations;
    @Autowired
    JdbcTemplate jdbc;

    @BeforeEach
    void controlClock() {
        when(clock.instant()).thenAnswer(invocation -> NOW.get());
        when(clock.getZone()).thenReturn(ZoneOffset.UTC);
        at(D, "10:00:00");
    }

    // ---------------------------------------------------------------- 게이트

    @Test
    @DisplayName("도서관 미완공은 LIBRARY_LOCKED, 비주민은 MEMBER_ONLY(권한이 게이트보다 먼저), 종료 섬은 GROUP_NOT_FOUND")
    void libraryAndResidencyGates() {
        Island locked = island(false);
        assertGroupError(() -> service.focus(locked.owner.getId(), locked.id, D, D, "me", null, 0),
                GroupErrorCode.LIBRARY_LOCKED);
        assertGroupError(() -> service.screenTime(locked.owner.getId(), locked.id, D, D, "island"),
                GroupErrorCode.LIBRARY_LOCKED);

        User outsider = users.save(User.builder().nickname("밖-" + UUID.randomUUID()).build());
        assertGroupError(() -> service.focus(outsider.getId(), locked.id, D, D, "me", null, 0),
                GroupErrorCode.MEMBER_ONLY);

        Island open = island(true);
        jdbc.update("UPDATE groups SET status = 'ENDED' WHERE id = ?", open.id);
        assertGroupError(() -> service.screenTime(open.owner.getId(), open.id, D, D, "me"),
                GroupErrorCode.GROUP_NOT_FOUND);
    }

    // ---------------------------------------------------------------- 집중

    @Test
    @DisplayName("scope=me 는 개인 전체(섬 무관), scope=island 는 이 섬에 고정된 세션만 — UTC 자정에서 ACTIVE 만 나뉜다")
    void focusScopesAndUtcMidnight() {
        Island x = island(true);
        Island y = island(true);
        User a = resident(x.group);
        members.save(GroupMember.builder().user(a).group(y.group).role(GroupMemberRole.MEMBER).build());
        User b = resident(x.group);
        LocalDate before = D.minusDays(1);

        // A 의 X 세션: ACTIVE 23:50~23:55 / REST 23:55~00:05 / ACTIVE 00:05~00:10 → 전일 300 · 당일 300
        UUID crossing = session(a, x.id, FocusSessionLifecycle.COMPLETED, Instant.parse(D + "T00:10:00Z"));
        interval(crossing, 1, FocusIntervalKind.ACTIVE, t(before, "23:50:00"), t(before, "23:55:00"));
        interval(crossing, 2, FocusIntervalKind.REST, t(before, "23:55:00"), t(D, "00:05:00"));
        interval(crossing, 3, FocusIntervalKind.ACTIVE, t(D, "00:05:00"), t(D, "00:10:00"));
        // A 의 Y 세션 10분 — 개인 전체에는 들고 X 기여에는 없다
        UUID onY = session(a, y.id, FocusSessionLifecycle.COMPLETED, t(D, "08:10:00"));
        interval(onY, 1, FocusIntervalKind.ACTIVE, t(D, "08:00:00"), t(D, "08:10:00"));
        // A 의 진행 중 세션 — 지금(10:00)까지 60초가 합계에 들지만 완료 기록은 만들지 않는다
        UUID live = session(a, x.id, FocusSessionLifecycle.ACTIVE, t(D, "09:59:00"));
        interval(live, 1, FocusIntervalKind.ACTIVE, t(D, "09:59:00"), null);
        // A 의 포기 세션 — 정산 없이 끝난 세션은 넣지 않는다
        UUID abandoned = session(a, x.id, FocusSessionLifecycle.ABANDONED, t(D, "07:00:00"));
        interval(abandoned, 1, FocusIntervalKind.ACTIVE, t(D, "06:00:00"), t(D, "07:00:00"));
        // B 의 X 세션 5분
        UUID bOnX = session(b, x.id, FocusSessionLifecycle.COMPLETED, t(D, "05:05:00"));
        interval(bOnX, 1, FocusIntervalKind.ACTIVE, t(D, "05:00:00"), t(D, "05:05:00"));

        FocusStatistics me = service.focus(a.getId(), x.id, before, D, "me", null, 0);
        assertThat(me.totalSeconds()).isEqualTo(300 + 300 + 600 + 60);
        assertThat(me.series()).containsExactly(new DaySeconds(before, 300), new DaySeconds(D, 960));
        assertThat(me.records()).extracting(FocusRecord::id).containsExactly(onY, crossing);
        assertThat(me.records()).extracting(FocusRecord::activeSeconds).containsExactly(600L, 600L);
        assertThat(me.asOf()).isEqualTo(t(D, "10:00:00"));
        assertThat(me.nextSnapshotId()).isNull();

        // 하루만 고르면 자정을 넘은 세션의 몫은 그날 것만이다 — 세션 전체의 정본 배분에서 고른다
        FocusStatistics day = service.focus(a.getId(), x.id, D, D, "me", null, 0);
        assertThat(day.totalSeconds()).isEqualTo(300 + 600 + 60);
        assertThat(day.records()).extracting(FocusRecord::activeSeconds).containsExactly(600L, 300L);

        jdbc.update("update users set cat_color = 'calico' where id = ?", a.getId());
        FocusStatistics island = service.focus(b.getId(), x.id, before, D, "island", null, 0);
        assertThat(island.records()).isNull();
        assertThat(island.members()).extracting(FocusMember::userId)
                .containsExactlyElementsOf(sortedIds(x.owner, a, b));
        assertThat(member(island, a).totalSeconds()).as("Y 세션·포기 세션 제외, 진행 중 60초 포함").isEqualTo(660);
        assertThat(member(island, a).series())
                .containsExactly(new DaySeconds(before, 300), new DaySeconds(D, 360));
        assertThat(member(island, b).totalSeconds()).isEqualTo(300);
        // 고양이 색은 users.cat_color 그대로, 미선택은 null (GROMO-1945)
        assertThat(member(island, a).catColor()).isEqualTo("calico");
        assertThat(member(island, b).catColor()).isNull();
        assertThat(member(island, x.owner).totalSeconds()).isZero();
        assertThat(member(island, x.owner).series()).isEmpty();
    }

    @Test
    @DisplayName("scope=me 기록이 30건을 넘으면 스냅샷으로 이어 읽는다 — 합계는 페이지와 무관, 만료되면 409")
    void focusPagesFromSnapshot() {
        Island x = island(true);
        User a = resident(x.group);
        for (int i = 0; i < 31; i++) {
            Instant start = t(D, "01:00:00").plusSeconds(i * 120L);
            UUID id = session(a, x.id, FocusSessionLifecycle.COMPLETED, start.plusSeconds(60));
            interval(id, 1, FocusIntervalKind.ACTIVE, start, start.plusSeconds(60));
        }

        FocusStatistics first = service.focus(a.getId(), x.id, D, D, "me", null, 0);
        assertThat(first.records()).hasSize(30);
        assertThat(first.totalSeconds()).isEqualTo(31 * 60);
        assertThat(first.nextOffset()).isEqualTo(30);

        // 그 사이 새 완료가 생겨도 다음 페이지는 같은 표다
        UUID later = session(a, x.id, FocusSessionLifecycle.COMPLETED, t(D, "09:30:00"));
        interval(later, 1, FocusIntervalKind.ACTIVE, t(D, "09:00:00"), t(D, "09:30:00"));
        FocusStatistics second = service.focus(a.getId(), x.id, D, D, "me", first.nextSnapshotId(), 30);
        assertThat(second.records()).hasSize(1);
        assertThat(second.totalSeconds()).isEqualTo(31 * 60);
        assertThat(second.asOf()).isEqualTo(first.asOf());
        assertThat(second.nextSnapshotId()).isNull();
        List<UUID> all = new ArrayList<>(first.records().stream().map(FocusRecord::id).toList());
        all.addAll(second.records().stream().map(FocusRecord::id).toList());
        assertThat(all).doesNotHaveDuplicates().doesNotContain(later);

        // 남의 스냅샷 id 로는 읽지 못하고, 15분이 지나면 만료다
        User other = resident(x.group);
        assertStatsError(() -> service.focus(other.getId(), x.id, D, D, "me", first.nextSnapshotId(), 30),
                StatsErrorCode.STATISTICS_SNAPSHOT_EXPIRED);
        at(D, "10:15:00");
        assertStatsError(() -> service.focus(a.getId(), x.id, D, D, "me", first.nextSnapshotId(), 30),
                StatsErrorCode.STATISTICS_SNAPSHOT_EXPIRED);
    }

    // ---------------------------------------------------------------- 측정 PUT

    @Test
    @DisplayName("PUT — 같은 키 재생·같은 시각 같은 내용은 무변경, 같은 시각 다른 내용은 409, 새 시각은 대체(합산 아님), 옛 시각은 무시")
    void putIsIdempotentAndLatestWins() {
        Device device = device();
        at(D, "09:10:00");
        UUID key = UUID.randomUUID();

        assertThat(put(device, D, 90, "authorized", t(D, "09:10:00"), key))
                .isEqualTo(new ScreenTimeDay(D, 90, "authorized"));
        assertThat(put(device, D, 90, "authorized", t(D, "09:10:00"), key)).as("같은 키 재생")
                .isEqualTo(new ScreenTimeDay(D, 90, "authorized"));
        assertThat(put(device, D, 90, "authorized", t(D, "09:10:00"), UUID.randomUUID())).as("새 키·같은 내용")
                .isEqualTo(new ScreenTimeDay(D, 90, "authorized"));
        assertThat(rows(device)).isEqualTo(1);

        assertStatsError(() -> put(device, D, 95, "authorized", t(D, "09:10:00"), UUID.randomUUID()),
                StatsErrorCode.SCREEN_TIME_MEASUREMENT_CONFLICT);
        assertThatThrownBy(() -> put(device, D, 95, "authorized", t(D, "09:10:00"), key))
                .isInstanceOfSatisfying(OutboxException.class,
                        e -> assertThat(e.getErrorCode()).isEqualTo(OutboxErrorCode.IDEMPOTENCY_KEY_CONFLICT));

        at(D, "11:00:00");
        assertThat(put(device, D, 120, "authorized", t(D, "11:00:00"), UUID.randomUUID()))
                .isEqualTo(new ScreenTimeDay(D, 120, "authorized"));
        assertThat(put(device, D, 60, "authorized", t(D, "08:00:00"), UUID.randomUUID())).as("옛 관측은 최신을 못 덮는다")
                .isEqualTo(new ScreenTimeDay(D, 120, "authorized"));
        assertThat(rows(device)).isEqualTo(3);

        ScreenTimeStatistics me = service.screenTime(device.userId, device.island.id, D, D, "me");
        assertThat(me.totalMinutes()).as("90+120 이 아니라 최신 120").isEqualTo(120);
        assertThat(me.measurementStatus()).isEqualTo("authorized");
        assertThat(me.updatedAt()).isEqualTo(t(D, "11:00:00"));
    }

    @Test
    @DisplayName("PUT — 기기는 이 로그인 세션이어야 하고, 측정 시각은 그 UTC 날짜 안·미래 1분 이내·다음 날 12:00Z 마감 전이어야 한다")
    void putRejectsForeignDeviceAndOutOfWindow() {
        Device device = device();
        at(D, "10:00:00");
        ScreenTimeUpload foreign = new ScreenTimeUpload(30, "authorized", "UTC", t(D, "09:00:00"), UUID.randomUUID());
        assertStatsError(() -> service.putScreenTime(device.userId, device.sessionId, 0L, D, foreign,
                UUID.randomUUID()), StatsErrorCode.SCREEN_TIME_DEVICE_FORBIDDEN);

        // 허용되지 않은 상태·상태와 맞지 않는 분은 DB CHECK 전에 422 다
        assertStatsError(() -> put(device, D, null, "blocked", t(D, "09:00:00"), UUID.randomUUID()),
                StatsErrorCode.SCREEN_TIME_INVALID_MEASUREMENT);
        assertStatsError(() -> put(device, D, 30, "denied", t(D, "09:00:00"), UUID.randomUUID()),
                StatsErrorCode.SCREEN_TIME_INVALID_MEASUREMENT);
        assertStatsError(() -> put(device, D, 1441, "authorized", t(D, "09:00:00"), UUID.randomUUID()),
                StatsErrorCode.SCREEN_TIME_INVALID_MEASUREMENT);
        assertStatsError(() -> service.screenTime(device.userId, device.island.id, D, D, "all"),
                StatsErrorCode.STATISTICS_SCOPE_OUT_OF_RANGE);

        // 날짜 D+1 의 관측이 D 23:59Z 에 찍혔다 — 그 날짜가 시작되기 전이다(자정 경계)
        at(D.plusDays(1), "00:30:00");
        assertStatsError(() -> put(device, D.plusDays(1), 10, "authorized", t(D, "23:59:59"), UUID.randomUUID()),
                StatsErrorCode.SCREEN_TIME_OUT_OF_WINDOW);
        // 날짜 D 의 마지막 관측이 자정 직후 찍힌 것은 받는다
        assertThat(put(device, D, 200, "authorized", t(D.plusDays(1), "00:00:00"), UUID.randomUUID()).minutes())
                .isEqualTo(200);
        // 미래 관측
        assertStatsError(() -> put(device, D.plusDays(1), 10, "authorized", t(D.plusDays(1), "00:32:00"),
                UUID.randomUUID()), StatsErrorCode.SCREEN_TIME_OUT_OF_WINDOW);
        // 마감(다음 날 12:00Z) 뒤 보고
        at(D.plusDays(1), "12:00:01");
        assertStatsError(() -> put(device, D, 210, "authorized", t(D.plusDays(1), "00:10:00"), UUID.randomUUID()),
                StatsErrorCode.SCREEN_TIME_OUT_OF_WINDOW);
    }

    // ---------------------------------------------------------------- 스크린타임 조회

    @Test
    @DisplayName("스크린타임 — 측정 없음·권한 없음은 숫자 없이 구분되고, 결측 날짜·복수 기기·거절 뒤 과거 숫자는 합계로 만들지 않는다")
    void screenTimeDistinguishesUnmeasured() {
        Island x = island(true);
        User measured = resident(x.group);
        User pending = resident(x.group);
        User multi = resident(x.group);
        User revoked = resident(x.group);
        LocalDate before = D.minusDays(1);

        observe(measured, UUID.randomUUID(), D, "09:00:00", 0, "authorized");
        observe(pending, UUID.randomUUID(), D, "09:00:00", null, "pending");
        UUID phone = UUID.randomUUID();
        observe(multi, phone, before, "20:00:00", 50, "authorized");
        observe(multi, phone, D, "09:00:00", 40, "authorized");
        observe(multi, UUID.randomUUID(), D, "09:30:00", 30, "authorized");
        observe(revoked, UUID.randomUUID(), before, "20:00:00", 70, "authorized");
        observe(revoked, UUID.randomUUID(), D, "09:00:00", null, "denied");

        jdbc.update("update users set cat_color = 'gray' where id = ?", measured.getId());
        ScreenTimeStatistics week = service.screenTime(measured.getId(), x.id, before, D.plusDays(5), "island");
        assertThat(week.members()).extracting(ScreenMember::userId)
                .containsExactlyElementsOf(sortedIds(x.owner, measured, pending, multi, revoked));

        assertThat(screenMember(week, measured).catColor()).isEqualTo("gray");
        ScreenMember none = screenMember(week, x.owner);
        assertThat(none.catColor()).isNull();
        assertThat(none.measurementStatus()).isEqualTo("unavailable");
        assertThat(none.minutes()).isNull();
        assertThat(none.series()).isEmpty();
        assertThat(none.updatedAt()).isNull();

        ScreenMember zero = screenMember(week, measured);
        assertThat(zero.series()).containsExactly(new ScreenDay(D, 0, "authorized", t(D, "09:00:00")));
        assertThat(zero.minutes()).as("전날이 결측이라 기간 합계는 없다(0 으로 채우지 않는다)").isNull();

        ScreenMember waiting = screenMember(week, pending);
        assertThat(waiting.measurementStatus()).isEqualTo("pending");
        assertThat(waiting.series()).containsExactly(new ScreenDay(D, null, "pending", t(D, "09:00:00")));

        ScreenMember devices = screenMember(week, multi);
        assertThat(devices.series()).containsExactly(new ScreenDay(before, 50, "authorized", t(before, "20:00:00")),
                new ScreenDay(D, null, "unavailable", t(D, "09:30:00")));
        assertThat(devices.minutes()).as("두 기기를 더하지도 하나를 고르지도 않는다").isNull();

        ScreenMember denied = screenMember(week, revoked);
        assertThat(denied.measurementStatus()).isEqualTo("denied");
        assertThat(denied.series()).as("거절 뒤 과거 측정 숫자를 내리지 않는다")
                .containsExactly(new ScreenDay(D, null, "denied", t(D, "09:00:00")));
        assertThat(denied.minutes()).isNull();

        // 지난 날짜가 전부 측정되면 합계가 있다 — 오지 않은 날은 결측이 아니다
        ScreenTimeStatistics today = service.screenTime(measured.getId(), x.id, D, D.plusDays(5), "me");
        assertThat(today.totalMinutes()).as("측정된 0 은 0").isZero();
        assertThat(today.measurementStatus()).isEqualTo("authorized");
    }

    // ---------------------------------------------------------------- 도구

    private ScreenTimeDay put(Device device, LocalDate date, Integer minutes, String status, Instant measuredAt,
                              UUID key) {
        return service.putScreenTime(device.userId, device.sessionId, 0L, date,
                new ScreenTimeUpload(minutes, status, "UTC", measuredAt, device.sessionId), key);
    }

    private long rows(Device device) {
        return jdbc.queryForObject("SELECT count(*) FROM screen_time_observations WHERE user_id = ?", Long.class,
                device.userId);
    }

    /** 게스트 로그인으로 실제 세션을 열고 도서관 섬 주민으로 넣는다. */
    private Device device() {
        var login = auth.guestLogin();
        UUID userId = jwt.extractUserId(login.accessToken());
        Island island = island(true);
        User user = users.findById(userId).orElseThrow();
        members.save(GroupMember.builder().user(user).group(island.group).role(GroupMemberRole.MEMBER).build());
        return new Device(userId, login.sessionId(), island);
    }

    private void observe(User user, UUID deviceId, LocalDate date, String time, Integer minutes, String status) {
        observations.save(ScreenTimeObservation.builder().userId(user.getId()).deviceId(deviceId).measuredDate(date)
                .measuredAt(t(date, time)).minutes(minutes).measurementStatus(status).build());
    }

    private static Instant t(LocalDate date, String time) {
        return Instant.parse(date + "T" + time + "Z");
    }

    private static void at(LocalDate date, String time) {
        NOW.set(t(date, time));
    }

    private Island island(boolean withLibrary) {
        User owner = users.save(User.builder().nickname("방장-" + UUID.randomUUID()).build());
        Group group = groups.save(Group.builder().name("섬").maxMembers(15).build());
        members.save(GroupMember.builder().user(owner).group(group).role(GroupMemberRole.OWNER).build());
        if (withLibrary) {
            IslandFacility library = IslandFacility.started(group.getId(), "library", 240, 1, owner.getId(),
                    Instant.parse("2031-01-01T00:00:00Z"), Instant.parse("2031-01-01T00:15:00Z"));
            library.complete(Instant.parse("2031-01-01T00:15:00Z"));
            facilities.save(library);
        }
        return new Island(group.getId(), group, owner);
    }

    private User resident(Group group) {
        User user = users.save(User.builder().nickname("주민-" + UUID.randomUUID()).build());
        members.save(GroupMember.builder().user(user).group(group).role(GroupMemberRole.MEMBER).build());
        return user;
    }

    private UUID session(User user, UUID islandId, FocusSessionLifecycle lifecycle, Instant lastTransitionAt) {
        UUID id = sessions.save(FocusSession.builder().user(user).focusType(FocusType.INFINITE)
                .startedAt(lastTransitionAt).build()).getId();
        details.save(FocusSessionDetail.builder().sessionId(id).userId(user.getId()).islandId(islandId)
                .membershipEpochAtStart(1L).subject("공부").targetMinutes(30).lifecycle(lifecycle)
                .lastTransitionAt(lastTransitionAt).build());
        return id;
    }

    private void interval(UUID sessionId, int ordinal, FocusIntervalKind kind, Instant startedAt, Instant endedAt) {
        intervals.save(FocusSessionInterval.builder().sessionId(sessionId).ordinal(ordinal).kind(kind)
                .startedAt(startedAt).endedAt(endedAt).build());
    }

    private static List<UUID> sortedIds(User... users) {
        return java.util.Arrays.stream(users).map(User::getId).sorted((a, b) -> a.toString().compareTo(b.toString()))
                .toList();
    }

    private static FocusMember member(FocusStatistics statistics, User user) {
        return statistics.members().stream().filter(m -> m.userId().equals(user.getId())).findFirst().orElseThrow();
    }

    private static ScreenMember screenMember(ScreenTimeStatistics statistics, User user) {
        return statistics.members().stream().filter(m -> m.userId().equals(user.getId())).findFirst().orElseThrow();
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

    private record Device(UUID userId, UUID sessionId, Island island) {
    }
}
