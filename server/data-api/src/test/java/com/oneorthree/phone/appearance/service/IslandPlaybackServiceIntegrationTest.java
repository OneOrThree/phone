package com.oneorthree.phone.appearance.service;

import com.oneorthree.phone.appearance.dto.AppearanceCommandView;
import com.oneorthree.phone.appearance.dto.PlaybackView;
import com.oneorthree.phone.appearance.exception.AppearanceErrorCode;
import com.oneorthree.phone.common.exception.DomainException;
import com.oneorthree.phone.common.exception.ErrorCode;
import com.oneorthree.phone.construction.exception.ConstructionErrorCode;
import com.oneorthree.phone.construction.repository.IslandFacilityRepository;
import com.oneorthree.phone.construction.repository.domain.IslandFacility;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.group.repository.domain.GroupMemberRole;
import com.oneorthree.phone.outbox.exception.OutboxErrorCode;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.domain.User;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.assertj.core.api.ThrowableAssert.ThrowingCallable;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 공용 음악(방송기) 재생 상태의 통합 검증 (GROMO-1779, island-playback 정책 M01~M10 · LLD §3·§4).
 *
 * <p>이 클래스가 <b>동시에 V73 실 마이그레이션 검증</b>이다 — 배선이 운영 Flyway 체인 +
 * {@code ddl-auto=validate} 다. 시설 게이트를 <b>켠다</b>({@code construction.facility-gates.enforce=true}) —
 * 방송기(gram) 완공 여부가 판정에 들어간다. 사건 생산 게이트({@code island-playback.events-enabled})는
 * 기본값(OFF) 그대로 — 켠 동작은 {@link IslandPlaybackEventsIntegrationTest} 가 본다.
 *
 * <p>음원 카탈로그·길이·섬 보유 행은 writer(상점 1781)가 아직 없어 JDBC 로 심는다(외양 테스트 선례).
 */
@SpringBootTest
class IslandPlaybackServiceIntegrationTest {

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
        registry.add("construction.facility-gates.enforce", () -> true);
    }

    @Autowired
    IslandPlaybackService service;
    @Autowired
    GroupRepository groups;
    @Autowired
    GroupMemberRepository members;
    @Autowired
    UserRepository users;
    @Autowired
    IslandFacilityRepository facilities;
    @Autowired
    JdbcTemplate jdbc;

    // ---------------------------------------------------------------- GET

    @Test
    @DisplayName("초기 GET 은 곡 없음·정지·0초·changedBy null·version 0 이고 행도 사건도 만들지 않는다 (M08)")
    void initialGetIsTheEmptyState() {
        Fixture f = gramIsland();

        PlaybackView view = service.get(f.islandId, f.ownerId);

        assertThat(view.trackId()).isNull();
        assertThat(view.playing()).isFalse();
        assertThat(view.positionSeconds()).isZero();
        assertThat(view.changedBy()).isNull();
        assertThat(view.version()).isZero();
        assertThat(view.durationSeconds()).isNull();
        assertThat(view.serverNow()).isNotNull();
        // anchor 는 섬 생성 시각 — GET 마다 바뀌지 않는다.
        assertThat(view.effectiveAt()).isEqualTo(service.get(f.islandId, f.ownerId).effectiveAt());
        assertThat(count("SELECT COUNT(*) FROM island_playbacks WHERE island_id = ?", f.islandId)).isZero();
        assertThat(playbackEvents(f.islandId)).isZero();
    }

    @Test
    @DisplayName("비주민은 GET·PATCH 모두 MEMBER_ONLY, 없는 섬은 GROUP_NOT_FOUND")
    void nonResidentIsRejected() {
        Fixture f = gramIsland();
        UUID stranger = newUser();

        assertCode(() -> service.get(f.islandId, stranger), GroupErrorCode.MEMBER_ONLY);
        assertCode(() -> patch(f.islandId, stranger, UUID.randomUUID(), Map.of("playing", true), 0L),
                GroupErrorCode.MEMBER_ONLY);
        assertCode(() -> service.get(UUID.randomUUID(), f.ownerId), GroupErrorCode.GROUP_NOT_FOUND);
    }

    @Test
    @DisplayName("방송기 미완공 섬은 주민의 GET·PATCH 모두 FACILITY_LOCKED (enforce=ON)")
    void gramNotBuiltIsLocked() {
        Fixture f = island();
        seedTrack("waves", 120_500);
        grant("waves", f.islandId);

        assertCode(() -> service.get(f.islandId, f.ownerId), ConstructionErrorCode.FACILITY_LOCKED);
        assertCode(() -> patch(f.islandId, f.ownerId, UUID.randomUUID(), Map.of("trackId", "waves"), 0L),
                ConstructionErrorCode.FACILITY_LOCKED);
    }

    // ---------------------------------------------------------------- PATCH 권한·검증

    @Test
    @DisplayName("방장이 아닌 주민도 곡·재생을 바꾼다 (M02) — changedBy 는 그 사용자, 곡 길이가 붙는다")
    void anyResidentMayChange() {
        Fixture f = gramIsland();
        UUID resident = join(f.islandId);
        seedTrack("waves", 120_500);
        grant("waves", f.islandId);

        PlaybackView view = patch(f.islandId, resident, UUID.randomUUID(),
                Map.of("trackId", "waves", "playing", true), 0L).data();

        assertThat(view.trackId()).isEqualTo("waves");
        assertThat(view.playing()).isTrue();
        assertThat(view.positionSeconds()).isZero();
        assertThat(view.changedBy()).isEqualTo(resident.toString());
        assertThat(view.version()).isEqualTo(1);
        assertThat(view.durationSeconds()).isEqualTo(120.5);
        assertThat(view.effectiveAt()).isEqualTo(view.serverNow());
        // GET 은 같은 anchor 를 돌려준다 — 현재 위치로 다시 계산하지 않는다.
        PlaybackView read = service.get(f.islandId, f.ownerId);
        assertThat(read.effectiveAt()).isEqualTo(view.effectiveAt());
        assertThat(read.positionSeconds()).isZero();
        assertThat(read.version()).isEqualTo(1);
    }

    @Test
    @DisplayName("곡 검증 — 미소유 403, 미등록·음원 아님·길이 메타데이터 없음 422")
    void trackValidation() {
        Fixture f = gramIsland();
        seedTrack("waves", 120_500);   // 등록됐지만 미소유
        seedProduct("scarf", "clothes", "user");
        seedProduct("silent", "audio", "island");   // 길이 없는 음원
        grant("silent", f.islandId);

        assertCode(() -> patch(f.islandId, f.ownerId, UUID.randomUUID(), Map.of("trackId", "waves"), 0L),
                AppearanceErrorCode.FORBIDDEN);
        assertCode(() -> patch(f.islandId, f.ownerId, UUID.randomUUID(), Map.of("trackId", "ghost"), 0L),
                AppearanceErrorCode.OUT_OF_RANGE);
        assertCode(() -> patch(f.islandId, f.ownerId, UUID.randomUUID(), Map.of("trackId", "scarf"), 0L),
                AppearanceErrorCode.OUT_OF_RANGE);
        assertCode(() -> patch(f.islandId, f.ownerId, UUID.randomUUID(), Map.of("trackId", "silent"), 0L),
                AppearanceErrorCode.OUT_OF_RANGE);
        assertThat(service.get(f.islandId, f.ownerId).version()).isZero();
    }

    @Test
    @DisplayName("형식 — null·비불리언·알 수 없는 필드·빈 PATCH·expectedVersion 누락 400, 음수 버전 422")
    void carrierValidation() {
        Fixture f = gramIsland();
        Map<String, Object> nullTrack = new LinkedHashMap<>();
        nullTrack.put("trackId", null);

        assertCode(() -> patch(f.islandId, f.ownerId, UUID.randomUUID(), nullTrack, 0L),
                AppearanceErrorCode.INVALID_REQUEST);
        assertCode(() -> patch(f.islandId, f.ownerId, UUID.randomUUID(), Map.of("playing", "yes"), 0L),
                AppearanceErrorCode.INVALID_REQUEST);
        assertCode(() -> patch(f.islandId, f.ownerId, UUID.randomUUID(), Map.of("volume", 3), 0L),
                AppearanceErrorCode.INVALID_REQUEST);
        assertCode(() -> patch(f.islandId, f.ownerId, UUID.randomUUID(), Map.of(), 0L),
                AppearanceErrorCode.INVALID_REQUEST);
        assertCode(() -> patch(f.islandId, f.ownerId, UUID.randomUUID(), Map.of("playing", false), null),
                AppearanceErrorCode.INVALID_REQUEST);
        assertCode(() -> patch(f.islandId, f.ownerId, UUID.randomUUID(), Map.of("playing", false), -1L),
                AppearanceErrorCode.OUT_OF_RANGE);
    }

    @Test
    @DisplayName("낡은 expectedVersion 은 409 이고 무변경 명령이라도 상태를 건드리지 않는다")
    void staleVersionConflicts() {
        Fixture f = gramIsland();
        seedTrack("waves", 120_500);
        grant("waves", f.islandId);
        patch(f.islandId, f.ownerId, UUID.randomUUID(), Map.of("trackId", "waves"), 0L);

        assertCode(() -> patch(f.islandId, f.ownerId, UUID.randomUUID(), Map.of("playing", true), 0L),
                AppearanceErrorCode.VERSION_CONFLICT);
        assertCode(() -> patch(f.islandId, f.ownerId, UUID.randomUUID(), Map.of("trackId", "waves"), 5L),
                AppearanceErrorCode.VERSION_CONFLICT);
        PlaybackView read = service.get(f.islandId, f.ownerId);
        assertThat(read.version()).isEqualTo(1);
        assertThat(read.playing()).isFalse();
    }

    // ---------------------------------------------------------------- 멱등

    @Test
    @DisplayName("같은 키·같은 본문은 원 결과 재생(변경 1회), 다른 본문은 409, 권한을 잃으면 재생도 403")
    void idempotentReplay() {
        Fixture f = gramIsland();
        UUID resident = join(f.islandId);
        seedTrack("waves", 120_500);
        grant("waves", f.islandId);
        UUID key = UUID.randomUUID();

        PlaybackView first = patch(f.islandId, resident, key, Map.of("trackId", "waves"), 0L).data();
        PlaybackView replay = patch(f.islandId, resident, key, Map.of("trackId", "waves"), 0L).data();

        assertThat(replay).isEqualTo(first);   // serverNow 까지 원 결과 그대로
        assertThat(service.get(f.islandId, f.ownerId).version()).isEqualTo(1);
        assertCode(() -> patch(f.islandId, resident, key, Map.of("trackId", "waves", "playing", true), 0L),
                OutboxErrorCode.IDEMPOTENCY_KEY_CONFLICT);

        jdbc.update("UPDATE group_members SET is_left = true WHERE group_id = ? AND user_id = ?",
                f.islandId, resident);
        assertCode(() -> patch(f.islandId, resident, key, Map.of("trackId", "waves"), 0L),
                GroupErrorCode.MEMBER_ONLY);
    }

    // ---------------------------------------------------------------- 전이표 (LLD §3)

    @Test
    @DisplayName("곡 없이 재생은 409 STATE_CONFLICT, 곡 없이 정지·같은 곡 재전송·같은 playing 은 무변경")
    void noOpsAndStateConflict() {
        Fixture f = gramIsland();
        seedTrack("waves", 120_500);
        grant("waves", f.islandId);

        assertCode(() -> patch(f.islandId, f.ownerId, UUID.randomUUID(), Map.of("playing", true), 0L),
                AppearanceErrorCode.STATE_CONFLICT);
        PlaybackView paused = patch(f.islandId, f.ownerId, UUID.randomUUID(), Map.of("playing", false), 0L)
                .data();
        assertThat(paused.version()).isZero();
        assertThat(paused.changedBy()).as("무변경은 가짜 조작자를 만들지 않는다").isNull();

        PlaybackView chosen = patch(f.islandId, f.ownerId, UUID.randomUUID(), Map.of("trackId", "waves"), 0L)
                .data();
        // 곡 변경 + playing 생략 → 기존 playing(초기 false) 유지
        assertThat(chosen.playing()).isFalse();
        assertThat(chosen.version()).isEqualTo(1);

        PlaybackView same = patch(f.islandId, f.ownerId, UUID.randomUUID(),
                Map.of("trackId", "waves", "playing", false), 1L).data();
        assertThat(same.version()).isEqualTo(1);
        assertThat(same.effectiveAt()).isEqualTo(chosen.effectiveAt());
    }

    @Test
    @DisplayName("재생 중 pause 는 경과를 더해 곡 길이로 반복한 위치를 정수로 고정하고, resume 은 그 위치부터다")
    void pauseAndResumeUseAnchorMath() {
        Fixture f = gramIsland();
        seedTrack("waves", 120_500);
        grant("waves", f.islandId);
        patch(f.islandId, f.ownerId, UUID.randomUUID(), Map.of("trackId", "waves", "playing", true), 0L);
        // anchor 를 129.6초 전으로 — (0 + 129.6+δ) mod 120.5 = 9.1+δ → 내림 9
        jdbc.update("UPDATE island_playbacks SET effective_at = effective_at - interval '129.6 seconds' "
                + "WHERE island_id = ?", f.islandId);
        Instant before = Instant.now();

        PlaybackView paused = patch(f.islandId, f.ownerId, UUID.randomUUID(), Map.of("playing", false), 1L)
                .data();

        assertThat(paused.playing()).isFalse();
        assertThat(paused.positionSeconds()).isEqualTo(9);
        assertThat(paused.version()).isEqualTo(2);
        assertThat(Instant.parse(paused.effectiveAt())).isAfterOrEqualTo(before.minusSeconds(1));

        PlaybackView resumed = patch(f.islandId, f.ownerId, UUID.randomUUID(), Map.of("playing", true), 2L)
                .data();
        assertThat(resumed.playing()).isTrue();
        assertThat(resumed.positionSeconds()).isEqualTo(9);
        assertThat(resumed.version()).isEqualTo(3);

        // 다른 곡으로 바꾸면 위치 0, playing 명시값
        seedTrack("rain", 900);   // 1초 미만 곡 — floor 로 0 <= p < d 가 유지된다
        grant("rain", f.islandId);
        PlaybackView switched = patch(f.islandId, f.ownerId, UUID.randomUUID(),
                Map.of("trackId", "rain", "playing", true), 3L).data();
        assertThat(switched.positionSeconds()).isZero();
        assertThat(switched.durationSeconds()).isEqualTo(0.9);
        jdbc.update("UPDATE island_playbacks SET effective_at = effective_at - interval '5 seconds' "
                + "WHERE island_id = ?", f.islandId);
        assertThat(patch(f.islandId, f.ownerId, UUID.randomUUID(), Map.of("playing", false), 4L)
                .data().positionSeconds()).isZero();
    }

    @Test
    @DisplayName("서버 시계가 이전 anchor 보다 뒤면 t=max(now, anchor) — 역행한 위치·anchor 를 만들지 않는다")
    void clockRegressionKeepsAnchor() {
        Fixture f = gramIsland();
        seedTrack("waves", 120_500);
        grant("waves", f.islandId);
        patch(f.islandId, f.ownerId, UUID.randomUUID(), Map.of("trackId", "waves", "playing", true), 0L);
        jdbc.update("UPDATE island_playbacks SET effective_at = effective_at + interval '1 hour', "
                + "position_seconds = 7 WHERE island_id = ?", f.islandId);
        String futureAnchor = service.get(f.islandId, f.ownerId).effectiveAt();

        PlaybackView paused = patch(f.islandId, f.ownerId, UUID.randomUUID(), Map.of("playing", false), 1L)
                .data();

        assertThat(paused.effectiveAt()).isEqualTo(futureAnchor);
        assertThat(paused.positionSeconds()).isEqualTo(7);
    }

    @Test
    @DisplayName("사건 생산 게이트 OFF(기본) — 실제 변경에도 playback.updated outbox 행이 없고 events 는 빈 배열")
    void eventProducerIsGatedOff() {
        Fixture f = gramIsland();
        seedTrack("waves", 120_500);
        grant("waves", f.islandId);

        AppearanceCommandView<PlaybackView> changed = patch(f.islandId, f.ownerId, UUID.randomUUID(),
                Map.of("trackId", "waves", "playing", true), 0L);

        assertThat(changed.data().version()).isEqualTo(1);
        assertThat(changed.events()).isEmpty();
        assertThat(playbackEvents(f.islandId)).isZero();
    }

    // ---------------------------------------------------------------- 도구

    private AppearanceCommandView<PlaybackView> patch(UUID islandId, UUID userId, UUID key,
                                                      Map<String, Object> values, Long expectedVersion) {
        return service.patch(islandId, userId, key, List.copyOf(values.keySet()), values, expectedVersion);
    }

    private static void assertCode(ThrowingCallable call, ErrorCode code) {
        assertThatThrownBy(call).isInstanceOfSatisfying(DomainException.class,
                e -> assertThat(e.getErrorCode()).isEqualTo(code));
    }

    private UUID newUser() {
        return users.save(User.builder().nickname("u-" + UUID.randomUUID()).build()).getId();
    }

    private Fixture island() {
        User owner = users.save(User.builder().nickname("방장-" + UUID.randomUUID()).build());
        Group island = groups.save(Group.builder().name("섬").maxMembers(10).build());
        members.save(GroupMember.builder().user(owner).group(island).role(GroupMemberRole.OWNER).build());
        return new Fixture(island.getId(), owner.getId());
    }

    /** 방송기(gram)까지 완공된 섬 — 시설 행은 운영 엔티티의 착공→완공 전이로 만든다. */
    private Fixture gramIsland() {
        Fixture f = island();
        Instant now = Instant.now();
        IslandFacility gram = IslandFacility.started(f.islandId, "gram", 0, 1, f.ownerId, now, now);
        gram.complete(now);
        facilities.save(gram);
        return f;
    }

    private UUID join(UUID islandId) {
        UUID userId = newUser();
        members.save(GroupMember.builder().user(users.getReferenceById(userId))
                .group(groups.getReferenceById(islandId)).role(GroupMemberRole.MEMBER).build());
        return userId;
    }

    private void seedProduct(String productId, String kind, String ownerType) {
        jdbc.update("INSERT INTO catalog_assets (product_id, title, kind, owner_type, created_at) "
                + "VALUES (?, ?, ?, ?, now()) ON CONFLICT (product_id) DO NOTHING",
                productId, productId + "-title", kind, ownerType);
    }

    /** 음원 + 불변 길이 메타데이터. */
    private void seedTrack(String productId, int durationMillis) {
        seedProduct(productId, "audio", "island");
        jdbc.update("INSERT INTO audio_tracks (product_id, duration_millis) VALUES (?, ?) "
                + "ON CONFLICT (product_id) DO NOTHING", productId, durationMillis);
    }

    private void grant(String productId, UUID islandId) {
        jdbc.update("INSERT INTO owned_products (id, owner_type, group_id, product_id, granted_ref, granted_at) "
                + "VALUES (gen_random_uuid(), 'island', ?, ?, 'test-grant', now())", islandId, productId);
    }

    private long count(String sql, Object... args) {
        Long n = jdbc.queryForObject(sql, Long.class, args);
        return n == null ? 0 : n;
    }

    private long playbackEvents(UUID islandId) {
        return count("SELECT COUNT(*) FROM event_outbox WHERE type = 'playback.updated' AND aggregate_id = ?",
                islandId.toString());
    }

    private record Fixture(UUID islandId, UUID ownerId) {
    }
}
