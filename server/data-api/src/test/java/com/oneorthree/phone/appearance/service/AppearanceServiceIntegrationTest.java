package com.oneorthree.phone.appearance.service;

import com.oneorthree.phone.appearance.dto.AppearanceCommandView;
import com.oneorthree.phone.appearance.dto.IslandAppearanceView;
import com.oneorthree.phone.appearance.dto.PersonalAppearanceView;
import com.oneorthree.phone.appearance.dto.PersonalInventoryView;
import com.oneorthree.phone.appearance.dto.SharedInventoryView;
import com.oneorthree.phone.appearance.exception.AppearanceErrorCode;
import com.oneorthree.phone.appearance.exception.AppearanceException;
import com.oneorthree.phone.appearance.repository.PersonalAppearanceRepository;
import com.oneorthree.phone.construction.scheduler.IslandConstructionScheduler;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.group.repository.domain.GroupMemberRole;
import com.oneorthree.phone.outbox.exception.OutboxErrorCode;
import com.oneorthree.phone.outbox.exception.OutboxException;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.domain.User;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 보유품·외양 도메인의 통합 검증 (GROMO-1783, island-appearance LLD).
 *
 * <p>이 클래스가 <b>동시에 V64 실 마이그레이션 검증</b>이다 — 배선이
 * {@code OutboxTestPostgres.applyProductionMigrationWiring} 이라 컨텍스트 부팅 때 V1 부터
 * V64 까지 운영 Flyway 를 전부 돌리고 {@code ddl-auto=validate} 가 엔티티 ↔ 스키마 드리프트를
 * 맞댄다. 카탈로그·보유 행은 이 도메인의 writer 가 아직 없으므로(상점 1781) JDBC 로 심는다.
 */
@SpringBootTest
class AppearanceServiceIntegrationTest {

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
    }

    @Autowired
    AppearanceService service;
    @Autowired
    IslandConstructionScheduler constructionScheduler;
    @Autowired
    PersonalAppearanceRepository personalAppearances;
    @Autowired
    GroupRepository groups;
    @Autowired
    GroupMemberRepository members;
    @Autowired
    UserRepository users;
    @Autowired
    JdbcTemplate jdbc;
    @Autowired
    PlatformTransactionManager transactionManager;

    // ---------------------------------------------------------------- GET /me/inventory

    @Test
    @DisplayName("빈 개인 인벤토리는 기본 외양·hulls=[raft]·version 0 을 돌려주고 raft 소유 행은 없다")
    void emptyInventoryReturnsDefaults() {
        UUID userId = newUser();

        PersonalInventoryView view = service.myInventory(userId);

        assertThat(view.clothes()).isEmpty();
        assertThat(view.decor()).isEmpty();
        assertThat(view.hulls()).containsExactly("raft");
        assertThat(view.inventoryVersion()).isZero();
        assertThat(view.equipped().hull()).isEqualTo("raft");
        assertThat(view.equipped().position()).isEqualTo("front");
        assertThat(view.equipped().version()).isZero();
        // raft 는 소유·지급·주문이 아니다 — 보유 행이 생기면 안 된다.
        Long owned = jdbc.queryForObject(
                "SELECT COUNT(*) FROM owned_products WHERE user_id = ? AND product_id = 'raft'",
                Long.class, userId);
        assertThat(owned).isZero();
    }

    // ---------------------------------------------------------------- PATCH /me/appearance

    @Test
    @DisplayName("개인 외양 적용은 소유·종류를 검증하고 병합 상태를 버전과 함께 돌려준다")
    void patchMineAppliesAndBumpsVersion() {
        UUID userId = newUser();
        seedProduct("scarf", "clothes", "user", null);
        grant("scarf", userId, null);

        AppearanceCommandView<PersonalAppearanceView> applied = service.patchMine(userId,
                UUID.randomUUID(), List.of("clothes"), Map.of("clothes", "scarf"));

        assertThat(applied.data().clothes()).isEqualTo("scarf");
        assertThat(applied.data().version()).isEqualTo(1);
        // 변경이 있었으므로 member.appearance.updated 가 표시 대상 섬 수만큼 적혔다.
        // 이 유저는 섬이 없으므로 events 는 비어 있다 — 팬아웃은 별도 테스트가 잠근다.
        assertThat(applied.events()).isEmpty();

        // 미제출 필드 유지 + 명시 null 해제 — decor 는 적은 적이 없어 no-op 아닌 유지다.
        AppearanceCommandView<PersonalAppearanceView> kept = service.patchMine(userId,
                UUID.randomUUID(), List.of("position"), Map.of("position", "back"));
        assertThat(kept.data().clothes()).isEqualTo("scarf");
        assertThat(kept.data().position()).isEqualTo("back");
        assertThat(kept.data().version()).isEqualTo(2);
    }

    @Test
    @DisplayName("회수가 보유 행을 먼저 잡으면 장착은 회수 커밋을 기다렸다 403 — stale-equip 창이 없다")
    void equipWaitsForConcurrentRevoke() {
        UUID userId = newUser();
        seedProduct("scarf", "clothes", "user", null);
        grant("scarf", userId, null);

        CompletableFuture<?>[] patch = new CompletableFuture<?>[1];
        new TransactionTemplate(transactionManager).executeWithoutResult(status -> {
            // 미래 회수 writer 의 첫 단계 — 보유 행 배타 잠금(삭제). 커밋 전이다.
            jdbc.update("DELETE FROM owned_products WHERE user_id = ? AND product_id = 'scarf'", userId);
            patch[0] = CompletableFuture.runAsync(() -> service.patchMine(userId, UUID.randomUUID(),
                    List.of("clothes"), Map.of("clothes", "scarf")));
            // 보유 행 공유 잠금에서 줄을 서야 한다 — 잠금 없는 확인이면 여기서 이미 끝나 장착된다.
            assertThatThrownBy(() -> patch[0].get(500, TimeUnit.MILLISECONDS))
                    .isInstanceOf(java.util.concurrent.TimeoutException.class);
        });

        assertThatThrownBy(patch[0]::join)
                .isInstanceOf(CompletionException.class)
                .cause().isInstanceOfSatisfying(AppearanceException.class,
                        e -> assertThat(e.getErrorCode()).isEqualTo(AppearanceErrorCode.FORBIDDEN));
        assertThat(personalAppearances.findById(userId).map(a -> a.getClothes())).isEmpty();
    }

    @Test
    @DisplayName("개인 슬롯 검증 — 미보유 403, 타인 소유 403, 잘못된 종류 422, 미등록 404, 섬 상품 422")
    void personalSlotValidation() {
        UUID userId = newUser();
        UUID other = newUser();
        seedProduct("scarf", "clothes", "user", null);
        seedProduct("hat", "decor", "user", null);
        seedProduct("pine", "island_theme", "island", null);
        grant("hat", other, null);   // 다른 유저 소유

        // 미보유 → 403 FORBIDDEN
        assertThatThrownBy(() -> service.patchMine(userId, UUID.randomUUID(),
                List.of("clothes"), Map.of("clothes", "scarf")))
                .isInstanceOfSatisfying(AppearanceException.class,
                        e -> assertThat(e.getErrorCode()).isEqualTo(AppearanceErrorCode.FORBIDDEN));
        // 타인 소유 → 403
        assertThatThrownBy(() -> service.patchMine(userId, UUID.randomUUID(),
                List.of("decor"), Map.of("decor", "hat")))
                .isInstanceOfSatisfying(AppearanceException.class,
                        e -> assertThat(e.getErrorCode()).isEqualTo(AppearanceErrorCode.FORBIDDEN));
        // 미등록 상품 → 404
        assertThatThrownBy(() -> service.patchMine(userId, UUID.randomUUID(),
                List.of("clothes"), Map.of("clothes", "ghost")))
                .isInstanceOfSatisfying(AppearanceException.class,
                        e -> assertThat(e.getErrorCode())
                                .isEqualTo(AppearanceErrorCode.PRODUCT_NOT_FOUND));
        // 보유했지만 종류가 다른 슬롯(decor 상품을 clothes 에) → 422
        seedProduct("badge", "decor", "user", null);
        grant("badge", userId, null);
        assertThatThrownBy(() -> service.patchMine(userId, UUID.randomUUID(),
                List.of("clothes"), Map.of("clothes", "badge")))
                .isInstanceOfSatisfying(AppearanceException.class,
                        e -> assertThat(e.getErrorCode()).isEqualTo(AppearanceErrorCode.OUT_OF_RANGE));
        // 공동 상품을 개인 슬롯에 → 422
        grant("pine", null, newIsland());
        assertThatThrownBy(() -> service.patchMine(userId, UUID.randomUUID(),
                List.of("clothes"), Map.of("clothes", "pine")))
                .isInstanceOfSatisfying(AppearanceException.class,
                        e -> assertThat(e.getErrorCode()).isEqualTo(AppearanceErrorCode.OUT_OF_RANGE));
    }

    @Test
    @DisplayName("tri-state — 명시 null 은 해제, hull·position 의 null 은 422, 잘못된 값은 422·400")
    void triStateSemantics() {
        UUID userId = newUser();
        seedProduct("scarf", "clothes", "user", null);
        grant("scarf", userId, null);
        service.patchMine(userId, UUID.randomUUID(), List.of("clothes"), Map.of("clothes", "scarf"));

        // 명시 null → 해제. version 은 올라간다(실제 변경).
        AppearanceCommandView<PersonalAppearanceView> cleared = service.patchMine(userId,
                UUID.randomUUID(), List.of("clothes"), valuesWithNull("clothes"));
        assertThat(cleared.data().clothes()).isNull();
        assertThat(cleared.data().version()).isEqualTo(2);

        // null 불가 슬롯의 명시 null → 422
        assertThatThrownBy(() -> service.patchMine(userId, UUID.randomUUID(),
                List.of("hull"), valuesWithNull("hull")))
                .isInstanceOfSatisfying(AppearanceException.class,
                        e -> assertThat(e.getErrorCode()).isEqualTo(AppearanceErrorCode.OUT_OF_RANGE));
        assertThatThrownBy(() -> service.patchMine(userId, UUID.randomUUID(),
                List.of("position"), valuesWithNull("position")))
                .isInstanceOfSatisfying(AppearanceException.class,
                        e -> assertThat(e.getErrorCode()).isEqualTo(AppearanceErrorCode.OUT_OF_RANGE));

        // raft 외 hull — 카탈로그에 없으면 404, 있으면 422
        assertThatThrownBy(() -> service.patchMine(userId, UUID.randomUUID(),
                List.of("hull"), Map.of("hull", "yacht")))
                .isInstanceOfSatisfying(AppearanceException.class,
                        e -> assertThat(e.getErrorCode())
                                .isEqualTo(AppearanceErrorCode.PRODUCT_NOT_FOUND));
        // 잘못된 position → 422
        assertThatThrownBy(() -> service.patchMine(userId, UUID.randomUUID(),
                List.of("position"), Map.of("position", "side")))
                .isInstanceOfSatisfying(AppearanceException.class,
                        e -> assertThat(e.getErrorCode()).isEqualTo(AppearanceErrorCode.OUT_OF_RANGE));
        // 비문자열 값 → 400
        assertThatThrownBy(() -> service.patchMine(userId, UUID.randomUUID(),
                List.of("clothes"), Map.of("clothes", 42)))
                .isInstanceOfSatisfying(AppearanceException.class,
                        e -> assertThat(e.getErrorCode())
                                .isEqualTo(AppearanceErrorCode.INVALID_REQUEST));
        // 빈 PATCH → 400
        assertThatThrownBy(() -> service.patchMine(userId, UUID.randomUUID(),
                List.of(), Map.of()))
                .isInstanceOfSatisfying(AppearanceException.class,
                        e -> assertThat(e.getErrorCode())
                                .isEqualTo(AppearanceErrorCode.INVALID_REQUEST));
    }

    @Test
    @DisplayName("무변경 PATCH 는 버전·사건을 올리지 않는다")
    void noOpPatchBumpsNothing() {
        UUID userId = newUser();
        service.patchMine(userId, UUID.randomUUID(), List.of("position"), Map.of("position", "back"));
        long outboxBefore = eventOutboxCount();

        AppearanceCommandView<PersonalAppearanceView> replay = service.patchMine(userId,
                UUID.randomUUID(), List.of("position"), Map.of("position", "back"));

        assertThat(replay.data().version()).isEqualTo(1);   // 첫 변경의 버전 그대로
        assertThat(replay.events()).isEmpty();
        assertThat(eventOutboxCount()).isEqualTo(outboxBefore);
    }

    @Test
    @DisplayName("같은 멱등 키는 원 receipt 를 재생하고 다른 의미 요청은 409 로 거절된다")
    void idempotencyReplayAndMismatch() {
        UUID userId = newUser();
        seedProduct("scarf", "clothes", "user", null);
        grant("scarf", userId, null);
        UUID key = UUID.randomUUID();

        AppearanceCommandView<PersonalAppearanceView> first = service.patchMine(userId, key,
                List.of("clothes"), Map.of("clothes", "scarf"));
        AppearanceCommandView<PersonalAppearanceView> replay = service.patchMine(userId, key,
                List.of("clothes"), Map.of("clothes", "scarf"));

        assertThat(replay.data().version()).isEqualTo(first.data().version());
        assertThat(replay.data().clothes()).isEqualTo("scarf");
        // 재생은 사건을 다시 만들지 않는다 — 버전도 그대로다.
        assertThat(personalAppearances.findById(userId).orElseThrow().getVersion()).isEqualTo(1);

        // 같은 키 + 다른 의미 요청 → 409 IDEMPOTENCY_KEY_CONFLICT
        assertThatThrownBy(() -> service.patchMine(userId, key,
                List.of("position"), Map.of("position", "back")))
                .isInstanceOfSatisfying(OutboxException.class,
                        e -> assertThat(e.getErrorCode())
                                .isEqualTo(OutboxErrorCode.IDEMPOTENCY_KEY_CONFLICT));
    }

    @Test
    @DisplayName("member.appearance.updated 는 표시 대상 섬마다 다른 eventId·같은 버전으로 적힌다")
    void memberEventFansOutPerIsland() {
        Fixture f = islandWithOwner();
        Fixture other = islandWithOwner();
        UUID memberId = newUser();
        // 유저를 두 섬의 주민으로 만든다 — 소속 섬 둘이 표시 대상이다.
        joinMember(f.islandId, memberId);
        joinMember(other.islandId, memberId);
        seedProduct("scarf", "clothes", "user", null);
        grant("scarf", memberId, null);

        AppearanceCommandView<PersonalAppearanceView> applied = service.patchMine(memberId,
                UUID.randomUUID(), List.of("clothes"), Map.of("clothes", "scarf"));

        assertThat(applied.events()).hasSize(2);
        List<String> eventIds = applied.events().stream()
                .map(e -> (String) e.get("eventId")).toList();
        assertThat(eventIds).doesNotHaveDuplicates();
        List<String> islandIds = applied.events().stream()
                .map(e -> (String) e.get("subjectId")).sorted().toList();
        assertThat(islandIds).isEqualTo(
                List.of(f.islandId.toString(), other.islandId.toString()).stream()
                        .sorted().toList());
        for (Map<String, Object> envelope : applied.events()) {
            assertThat(envelope.get("type")).isEqualTo("member.appearance.updated");
            assertThat(envelope.get("userId")).isEqualTo(memberId.toString());
            assertThat(envelope.get("version")).isEqualTo(1);
            assertThat(((Map<?, ?>) envelope.get("params")).get("version")).isEqualTo(1);
        }
        // outbox·delivery 행이 실제로 적혔는지도 확인한다 — 응답 조립과 저장은 같은 TX 다.
        Long rows = jdbc.queryForObject(
                "SELECT COUNT(*) FROM event_outbox WHERE type = 'member.appearance.updated'",
                Long.class);
        assertThat(rows).isEqualTo(2);
    }

    // ---------------------------------------------------------------- GET /islands/{id}/inventory

    @Test
    @DisplayName("공동 인벤토리는 활성 주민만 보고 비주민은 403 이다")
    void islandInventoryIsMemberOnly() {
        Fixture f = islandWithOwner();
        seedProduct("pine", "island_theme", "island", null);
        seedProduct("hall_theme", "building_theme", "island", "hall");
        seedProduct("bird", "audio", "island", null);
        grant("pine", null, f.islandId);
        grant("hall_theme", null, f.islandId);
        grant("bird", null, f.islandId);

        SharedInventoryView view = service.islandInventory(f.islandId, f.ownerId);

        assertThat(view.audio()).containsExactly("bird");
        assertThat(view.islandThemes()).containsExactly("pine");
        assertThat(view.buildingThemes()).containsExactly(
                new SharedInventoryView.BuildingThemeItem("hall", "hall_theme"));
        assertThat(view.appearance().islandThemeId()).isEqualTo("default");
        assertThat(view.appearance().buildingThemes()).isEmpty();

        UUID outsider = newUser();
        assertThatThrownBy(() -> service.islandInventory(f.islandId, outsider))
                .isInstanceOfSatisfying(GroupException.class,
                        e -> assertThat(e.getErrorCode()).isEqualTo(GroupErrorCode.MEMBER_ONLY));
        // 일반 주민(비방장)도 조회는 된다.
        UUID memberId = newUser();
        joinMember(f.islandId, memberId);
        assertThat(service.islandInventory(f.islandId, memberId).islandThemes())
                .containsExactly("pine");
    }

    // ---------------------------------------------------------------- PATCH /islands/{id}/appearance

    @Test
    @DisplayName("공동 외양은 방장만 바꾸고 expectedVersion 이 맞아야 한다 — 비방장·비주민은 403")
    void islandPatchIsHostOnlyWithVersion() {
        Fixture f = islandWithOwner();
        seedProduct("pine", "island_theme", "island", null);
        grant("pine", null, f.islandId);
        UUID memberId = newUser();
        joinMember(f.islandId, memberId);

        // 비방장 주민 → 403 NOT_OWNER
        assertThatThrownBy(() -> service.patchIsland(f.islandId, memberId, UUID.randomUUID(),
                List.of("islandThemeId"), Map.of("islandThemeId", "pine"), 0L))
                .isInstanceOfSatisfying(GroupException.class,
                        e -> assertThat(e.getErrorCode()).isEqualTo(GroupErrorCode.NOT_OWNER));
        // 비주민 → 403 MEMBER_ONLY
        UUID outsider = newUser();
        assertThatThrownBy(() -> service.patchIsland(f.islandId, outsider, UUID.randomUUID(),
                List.of("islandThemeId"), Map.of("islandThemeId", "pine"), 0L))
                .isInstanceOfSatisfying(GroupException.class,
                        e -> assertThat(e.getErrorCode()).isEqualTo(GroupErrorCode.MEMBER_ONLY));
        // expectedVersion 불일치 → 409
        assertThatThrownBy(() -> service.patchIsland(f.islandId, f.ownerId, UUID.randomUUID(),
                List.of("islandThemeId"), Map.of("islandThemeId", "pine"), 7L))
                .isInstanceOfSatisfying(AppearanceException.class,
                        e -> assertThat(e.getErrorCode())
                                .isEqualTo(AppearanceErrorCode.VERSION_CONFLICT));
        // expectedVersion 누락 → 400
        assertThatThrownBy(() -> service.patchIsland(f.islandId, f.ownerId, UUID.randomUUID(),
                List.of("islandThemeId"), Map.of("islandThemeId", "pine"), null))
                .isInstanceOfSatisfying(AppearanceException.class,
                        e -> assertThat(e.getErrorCode())
                                .isEqualTo(AppearanceErrorCode.INVALID_REQUEST));

        AppearanceCommandView<IslandAppearanceView> applied = service.patchIsland(f.islandId,
                f.ownerId, UUID.randomUUID(), List.of("islandThemeId"),
                Map.of("islandThemeId", "pine"), 0L);
        assertThat(applied.data().islandThemeId()).isEqualTo("pine");
        assertThat(applied.data().version()).isEqualTo(1);
        assertThat(applied.events()).hasSize(1);
        Map<String, Object> envelope = applied.events().get(0);
        assertThat(envelope.get("type")).isEqualTo("island.appearance.updated");
        assertThat(envelope.get("subjectId")).isEqualTo(f.islandId.toString());
        assertThat(envelope.get("version")).isEqualTo(1);
    }

    @Test
    @DisplayName("건물 테마는 완공 건물·대상 건물이 맞아야 한다 — 미시드 키·null·다른 건물 테마는 422")
    void buildingThemeValidation() {
        Fixture f = islandWithOwner();
        seedProduct("hall_theme", "building_theme", "island", "hall");
        seedProduct("library_theme", "building_theme", "island", "library");
        grant("hall_theme", null, f.islandId);
        grant("library_theme", null, f.islandId);

        // 미시드 건물 키(아직 완공 안 된 건물) → 422
        assertThatThrownBy(() -> service.patchIsland(f.islandId, f.ownerId, UUID.randomUUID(),
                List.of("buildingThemes"), Map.of("buildingThemes", Map.of("hall", "hall_theme")), 0L))
                .isInstanceOfSatisfying(AppearanceException.class,
                        e -> assertThat(e.getErrorCode()).isEqualTo(AppearanceErrorCode.OUT_OF_RANGE));

        // 완공 writer 가 키를 시드한다 — 실제 완공 경로로 검증한다.
        completeBuilding(f.islandId, "hall", f.ownerId);
        IslandAppearanceView after = service.islandInventory(f.islandId, f.ownerId).appearance();
        assertThat(after.buildingThemes()).containsEntry("hall", "default");
        assertThat(after.version()).isEqualTo(1);

        // 다른 건물 전용 테마를 hall 에 → 422
        assertThatThrownBy(() -> service.patchIsland(f.islandId, f.ownerId, UUID.randomUUID(),
                List.of("buildingThemes"), Map.of("buildingThemes", Map.of("hall", "library_theme")),
                1L))
                .isInstanceOfSatisfying(AppearanceException.class,
                        e -> assertThat(e.getErrorCode()).isEqualTo(AppearanceErrorCode.OUT_OF_RANGE));

        // 대상 건물이 맞으면 적용 — 부분 병합이라 다른 키는 유지된다.
        AppearanceCommandView<IslandAppearanceView> applied = service.patchIsland(f.islandId,
                f.ownerId, UUID.randomUUID(), List.of("buildingThemes"),
                Map.of("buildingThemes", Map.of("hall", "hall_theme")), 1L);
        assertThat(applied.data().buildingThemes()).containsEntry("hall", "hall_theme");
        assertThat(applied.data().version()).isEqualTo(2);

        // "default" 로 해제 — 명시 null 값은 422 다.
        assertThatThrownBy(() -> service.patchIsland(f.islandId, f.ownerId, UUID.randomUUID(),
                List.of("buildingThemes"),
                buildingThemesWithNull("hall"), 2L))
                .isInstanceOfSatisfying(AppearanceException.class,
                        e -> assertThat(e.getErrorCode()).isEqualTo(AppearanceErrorCode.OUT_OF_RANGE));
        AppearanceCommandView<IslandAppearanceView> reverted = service.patchIsland(f.islandId,
                f.ownerId, UUID.randomUUID(), List.of("buildingThemes"),
                Map.of("buildingThemes", Map.of("hall", "default")), 2L);
        assertThat(reverted.data().buildingThemes()).containsEntry("hall", "default");
        assertThat(reverted.data().version()).isEqualTo(3);
    }

    @Test
    @DisplayName("공동 PATCH 멱등 — 같은 키는 receipt 재생, 다른 의미 요청은 409")
    void islandPatchIdempotency() {
        Fixture f = islandWithOwner();
        seedProduct("pine", "island_theme", "island", null);
        grant("pine", null, f.islandId);
        UUID key = UUID.randomUUID();

        service.patchIsland(f.islandId, f.ownerId, key,
                List.of("islandThemeId"), Map.of("islandThemeId", "pine"), 0L);
        AppearanceCommandView<IslandAppearanceView> replay = service.patchIsland(f.islandId,
                f.ownerId, key, List.of("islandThemeId"), Map.of("islandThemeId", "pine"), 0L);
        assertThat(replay.data().version()).isEqualTo(1);

        // 같은 키 + 다른 버전 의미 객체 → 409
        assertThatThrownBy(() -> service.patchIsland(f.islandId, f.ownerId, key,
                List.of("islandThemeId"), Map.of("islandThemeId", "pine"), 1L))
                .isInstanceOfSatisfying(OutboxException.class,
                        e -> assertThat(e.getErrorCode())
                                .isEqualTo(OutboxErrorCode.IDEMPOTENCY_KEY_CONFLICT));
    }

    @Test
    @DisplayName("공동 PATCH 재생은 재생 시점 권한을 다시 본다 — 방장에서 내려오면 같은 키도 403")
    void islandReplayRechecksPermission() {
        Fixture f = islandWithOwner();
        seedProduct("pine", "island_theme", "island", null);
        grant("pine", null, f.islandId);
        UUID key = UUID.randomUUID();
        service.patchIsland(f.islandId, f.ownerId, key,
                List.of("islandThemeId"), Map.of("islandThemeId", "pine"), 0L);

        jdbc.update("UPDATE group_members SET role = 'MEMBER' WHERE group_id = ? AND user_id = ?",
                f.islandId, f.ownerId);

        assertThatThrownBy(() -> service.patchIsland(f.islandId, f.ownerId, key,
                List.of("islandThemeId"), Map.of("islandThemeId", "pine"), 0L))
                .isInstanceOfSatisfying(GroupException.class,
                        e -> assertThat(e.getErrorCode()).isEqualTo(GroupErrorCode.NOT_OWNER));
    }

    @Test
    @DisplayName("낡은 expectedVersion 은 상품·값 검증보다 먼저 409 다")
    void staleVersionWinsOverProductErrors() {
        Fixture f = islandWithOwner();
        seedProduct("pine", "island_theme", "island", null);   // 미보유

        assertThatThrownBy(() -> service.patchIsland(f.islandId, f.ownerId, UUID.randomUUID(),
                List.of("islandThemeId"), Map.of("islandThemeId", "pine"), 3L))
                .isInstanceOfSatisfying(AppearanceException.class,
                        e -> assertThat(e.getErrorCode())
                                .isEqualTo(AppearanceErrorCode.VERSION_CONFLICT));
        assertThatThrownBy(() -> service.patchIsland(f.islandId, f.ownerId, UUID.randomUUID(),
                List.of("islandThemeId"), Map.of("islandThemeId", "nope"), 3L))
                .isInstanceOfSatisfying(AppearanceException.class,
                        e -> assertThat(e.getErrorCode())
                                .isEqualTo(AppearanceErrorCode.VERSION_CONFLICT));
    }

    @Test
    @DisplayName("시설 완공은 같은 TX 에 공동 외양 키를 시드하고 island.appearance.updated 를 낸다")
    void completionSeedsAppearance() {
        Fixture f = islandWithOwner();
        long eventsBefore = islandAppearanceEventCount(f.islandId);

        completeBuilding(f.islandId, "hall", f.ownerId);

        IslandAppearanceView view = service.islandInventory(f.islandId, f.ownerId).appearance();
        assertThat(view.buildingThemes()).containsExactly(Map.entry("hall", "default"));
        assertThat(view.version()).isEqualTo(1);
        assertThat(islandAppearanceEventCount(f.islandId)).isEqualTo(eventsBefore + 1);
    }

    // ---------------------------------------------------------------- 시설

    private UUID newUser() {
        return users.save(User.builder().nickname("u-" + UUID.randomUUID()).build()).getId();
    }

    private Fixture islandWithOwner() {
        User owner = users.save(User.builder().nickname("방장-" + UUID.randomUUID()).build());
        Group island = groups.save(Group.builder().name("섬").maxMembers(10).build());
        members.save(GroupMember.builder().user(owner).group(island)
                .role(GroupMemberRole.OWNER).build());
        return new Fixture(island.getId(), owner.getId());
    }

    /** 주민 없는 빈 섬 — 공동 소유 행의 FK 용도다. */
    private UUID newIsland() {
        return groups.save(Group.builder().name("섬-" + UUID.randomUUID()).maxMembers(10).build())
                .getId();
    }

    private void joinMember(UUID islandId, UUID userId) {
        members.save(GroupMember.builder()
                .user(users.getReferenceById(userId))
                .group(groups.getReferenceById(islandId))
                .role(GroupMemberRole.MEMBER).build());
    }

    private void seedProduct(String productId, String kind, String ownerType, String targetBuilding) {
        jdbc.update("INSERT INTO catalog_assets (product_id, title, kind, owner_type, target_building, "
                        + "created_at) VALUES (?, ?, ?, ?, ?, now()) ON CONFLICT (product_id) DO NOTHING",
                productId, productId + "-title", kind, ownerType, targetBuilding);
    }

    /** ownerType 에 따라 user 또는 island 소유 행을 심는다 — 둘 중 하나만 null 이 아니다. */
    private void grant(String productId, UUID userId, UUID islandId) {
        jdbc.update("INSERT INTO owned_products (id, owner_type, user_id, group_id, product_id, "
                        + "granted_ref, granted_at) VALUES (gen_random_uuid(), ?, ?, ?, ?, ?, now())",
                userId != null ? "user" : "island", userId, islandId, productId, "test-grant");
    }

    /** 완공 시설 행을 심고 스케줄러 완공 경로를 돌린다 — 시드는 완공 TX 의 writer 다. */
    private void completeBuilding(UUID islandId, String buildingId, UUID starterId) {
        jdbc.update("INSERT INTO island_facilities (island_id, building_id, status, cost, "
                        + "cost_revision, started_by, started_at, completes_at) "
                        + "VALUES (?, ?, 'BUILDING', 0, 1, ?, now(), ?)",
                islandId, buildingId, starterId,
                Timestamp.from(Instant.now().minus(1, ChronoUnit.MINUTES)));
        constructionScheduler.completeDueFacilities();
    }

    private long eventOutboxCount() {
        Long n = jdbc.queryForObject("SELECT COUNT(*) FROM event_outbox", Long.class);
        return n == null ? 0 : n;
    }

    private long islandAppearanceEventCount(UUID islandId) {
        Long n = jdbc.queryForObject(
                "SELECT COUNT(*) FROM event_outbox WHERE type = 'island.appearance.updated' "
                        + "AND aggregate_id = ?", Long.class, islandId.toString());
        return n == null ? 0 : n;
    }

    /** 명시 null 한 필드 — Map.of 는 null 을 못 담아 LinkedHashMap 을 쓴다. */
    private static Map<String, Object> valuesWithNull(String field) {
        Map<String, Object> values = new java.util.LinkedHashMap<>();
        values.put(field, null);
        return values;
    }

    private static Map<String, Object> buildingThemesWithNull(String buildingId) {
        Map<String, Object> themes = new java.util.LinkedHashMap<>();
        themes.put(buildingId, null);
        return Map.of("buildingThemes", themes);
    }

    private record Fixture(UUID islandId, UUID ownerId) {
    }
}
