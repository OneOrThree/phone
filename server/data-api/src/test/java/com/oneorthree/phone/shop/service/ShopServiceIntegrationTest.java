package com.oneorthree.phone.shop.service;

import com.oneorthree.phone.appearance.dto.PlaybackView;
import com.oneorthree.phone.appearance.repository.AudioTrackRepository;
import com.oneorthree.phone.appearance.repository.CatalogAssetRepository;
import com.oneorthree.phone.appearance.repository.domain.AudioTrack;
import com.oneorthree.phone.appearance.repository.domain.CatalogAsset;
import com.oneorthree.phone.appearance.service.IslandPlaybackService;
import com.oneorthree.phone.common.exception.DomainException;
import com.oneorthree.phone.common.exception.ErrorCode;
import com.oneorthree.phone.construction.repository.IslandFacilityRepository;
import com.oneorthree.phone.construction.repository.domain.IslandFacility;
import com.oneorthree.phone.construction.service.IslandWalletService;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.group.repository.domain.GroupMemberRole;
import com.oneorthree.phone.group.repository.domain.GroupPermissionScope;
import com.oneorthree.phone.outbox.exception.OutboxErrorCode;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import com.oneorthree.phone.shop.dto.ShopViews;
import com.oneorthree.phone.shop.exception.ShopErrorCode;
import com.oneorthree.phone.shop.repository.ShopCatalogActivePublicationRepository;
import com.oneorthree.phone.shop.repository.ShopCatalogPublicationEntryRepository;
import com.oneorthree.phone.shop.repository.ShopCatalogPublicationRepository;
import com.oneorthree.phone.shop.repository.ShopProductRevisionRepository;
import com.oneorthree.phone.shop.repository.domain.ShopCatalogActivePublication;
import com.oneorthree.phone.shop.repository.domain.ShopCatalogPublication;
import com.oneorthree.phone.shop.repository.domain.ShopCatalogPublicationEntry;
import com.oneorthree.phone.shop.repository.domain.ShopProductRevision;
import com.oneorthree.phone.shop.repository.domain.ShopProductRevisionId;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.domain.User;
import org.assertj.core.api.ThrowableAssert.ThrowingCallable;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 섬 상점 5계약의 통합 검증 (GROMO-1781, island-shop LLD §2·§4, 2026-09-19 결정 N24·N25).
 *
 * <p>배선이 운영 Flyway 체인 + {@code ddl-auto=validate} 라 V74 스키마와 엔티티를 함께 맞댄다. 카탈로그·가격·
 * 곡 길이는 <b>운영 엔티티의 생성 경로</b>로 심는다 — 「데이터만 넣으면 동작한다」를 운영이 넣을 모양 그대로
 * 검증한다. 활성 포인터는 싱글톤이라 테스트마다 자기 발행본으로 갈아 끼운다. 시설 게이트를 켠다 — 방송기 완공이
 * 재생 PATCH 판정에 들어간다.
 */
@SpringBootTest
class ShopServiceIntegrationTest {

    private static final AtomicLong PUBLICATIONS = new AtomicLong(1000);

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
        registry.add("construction.facility-gates.enforce", () -> true);
    }

    @Autowired
    ShopService shop;
    @Autowired
    IslandPlaybackService playback;
    @Autowired
    IslandWalletService walletService;
    @Autowired
    CatalogAssetRepository assets;
    @Autowired
    AudioTrackRepository tracks;
    @Autowired
    ShopProductRevisionRepository revisions;
    @Autowired
    ShopCatalogPublicationRepository publications;
    @Autowired
    ShopCatalogPublicationEntryRepository entries;
    @Autowired
    ShopCatalogActivePublicationRepository activePublication;
    @Autowired
    IslandFacilityRepository facilities;
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

    // ---------------------------------------------------------------- 빈 카탈로그·미승인 가격

    @Test
    @DisplayName("활성 발행본이 없으면 목록은 오류가 아니라 빈 배열이고, 상세·구매는 PRODUCT_NOT_FOUND 다 (N25)")
    void emptyCatalogIsAnEmptyList() {
        activePublication.deleteAll();
        Fixture f = island(GroupPermissionScope.OWNER_ONLY);

        ShopViews.ProductPage page = shop.products(f.islandId, f.ownerId, "personal", null, null, null, 30);

        assertThat(page.items()).isEmpty();
        assertThat(page.publicationVersion()).isNull();
        assertThat(page.hasMore()).isFalse();
        assertCode(() -> shop.product(f.islandId, f.ownerId, "anything"), ShopErrorCode.PRODUCT_NOT_FOUND);
        assertCode(() -> buy(f, f.ownerId, "anything", UUID.randomUUID()), ShopErrorCode.PRODUCT_NOT_FOUND);
        ShopViews.Wallets wallets = shop.wallets(f.islandId, f.ownerId);
        assertThat(wallets.villagePoints()).isZero();
        assertThat(wallets.fish()).isZero();
        assertThat(wallets.fishVersion()).as("개인 지갑엔 version 축이 없다 — 지어내지 않는다").isNull();
    }

    @Test
    @DisplayName("가격 미승인(NULL) 상품은 목록에 available=false·STATE_CONFLICT 로 보이고 구매는 차감 없이 409 다 (S03)")
    void unpricedProductIsNeverSoldAsZero() {
        Fixture f = island(GroupPermissionScope.OWNER_ONLY);
        fund(f.islandId, 100);
        String id = product("island_theme", "island", null);
        publish(entry(id, 1, null, null, null, "island", 1));

        ShopViews.Item item = shop.products(f.islandId, f.ownerId, "island", null, null, null, 30).items().get(0);

        assertThat(item.price()).isNull();
        assertThat(item.available()).isFalse();
        assertThat(item.reason()).isEqualTo("STATE_CONFLICT");
        assertCode(() -> buy(f, f.ownerId, id, UUID.randomUUID()), ShopErrorCode.STATE_CONFLICT);
        assertThat(islandBalance(f.islandId)).isEqualTo(100);
        assertThat(count("SELECT COUNT(*) FROM shop_orders WHERE island_id = ?", f.islandId)).isZero();
    }

    // ---------------------------------------------------------------- 구매·멱등

    @Test
    @DisplayName("구매는 섬 통장을 정확히 한 번 차감하고 섬 소유를 주문 id 로 지급한다 — 같은 키는 원 결과 재생, 새 키는 409")
    void purchaseDebitsOnceGrantsAndReplays() {
        Fixture f = island(GroupPermissionScope.OWNER_ONLY);
        fund(f.islandId, 100);
        String id = product("island_theme", "island", null);
        publish(entry(id, 1, 30, null, null, "island", 1));
        UUID key = UUID.randomUUID();
        long seenWallet = shop.wallets(f.islandId, f.ownerId).villagePointsVersion();

        ShopViews.Order order = shop.purchase(f.islandId, f.ownerId, id, seenWallet, 1, key);

        assertThat(order.spent()).isEqualTo(30);
        assertThat(order.currency()).isEqualTo("village_points");
        assertThat(order.ownerType()).isEqualTo("island");
        assertThat(order.owned()).isTrue();
        assertThat(order.walletVersion()).isEqualTo(shop.wallets(f.islandId, f.ownerId).villagePointsVersion());
        assertThat(islandBalance(f.islandId)).isEqualTo(70);
        assertThat(count("SELECT COUNT(*) FROM island_wallet_transactions WHERE island_id = ? AND type = 'SHOP_PURCHASE'"
                + " AND amount = 30", f.islandId)).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT granted_ref FROM owned_products WHERE owner_type = 'island'"
                + " AND group_id = ? AND product_id = ?", String.class, f.islandId, id))
                .isEqualTo(order.id().toString());
        // currency_spent 내구 의도 — 주문 행의 차감 후 잔액, 아직 미전달.
        assertThat(jdbc.queryForMap("SELECT balance_after, analytics_delivered_at, paid_price FROM shop_orders"
                + " WHERE id = ?", order.id()))
                .containsEntry("balance_after", 70).containsEntry("analytics_delivered_at", null)
                .containsEntry("paid_price", 30);
        assertThat(events("wallet.updated", f.islandId.toString())).isEqualTo(1);
        assertThat(events("inventory.updated", f.islandId.toString())).isEqualTo(1);

        // 응답 유실 뒤 앱의 재시도 — 같은 키·같은 본문. 지갑 version 이 이미 올랐어도 비교 전에 원 결과를 재생한다.
        ShopViews.Order replay = shop.purchase(f.islandId, f.ownerId, id, seenWallet, 1, key);
        assertThat(replay).isEqualTo(order);
        assertThat(islandBalance(f.islandId)).as("재생은 다시 차감하지 않는다").isEqualTo(70);
        assertThat(events("wallet.updated", f.islandId.toString())).isEqualTo(1);
        assertThat(count("SELECT COUNT(*) FROM shop_orders WHERE island_id = ?", f.islandId)).isEqualTo(1);

        assertCode(() -> shop.purchase(f.islandId, f.ownerId, id, 999, 1, key),
                OutboxErrorCode.IDEMPOTENCY_KEY_CONFLICT);
        assertCode(() -> buy(f, f.ownerId, id, UUID.randomUUID()), ShopErrorCode.STATE_CONFLICT);
        assertThat(islandBalance(f.islandId)).as("새 키도 소유 유일성이 이중 차감을 막는다").isEqualTo(70);
        ShopViews.Item listed = shop.products(f.islandId, f.ownerId, "island", null, null, null, 30).items().get(0);
        assertThat(listed.owned()).isTrue();
        assertThat(listed.available()).isFalse();
    }

    @Test
    @DisplayName("같은 상품을 새 키 둘로 동시에 사도 한 번만 차감된다 — 섬 잠금 아래 소유 판정")
    void concurrentPurchasesDebitOnce() throws Exception {
        Fixture f = island(GroupPermissionScope.OWNER_ONLY);
        fund(f.islandId, 100);
        String id = product("island_theme", "island", null);
        publish(entry(id, 1, 30, null, null, "island", 1));

        List<Object> results = race(() -> buy(f, f.ownerId, id, UUID.randomUUID()),
                () -> buy(f, f.ownerId, id, UUID.randomUUID()));

        assertThat(results).filteredOn(ShopViews.Order.class::isInstance).hasSize(1);
        assertThat(results).filteredOn(DomainException.class::isInstance).singleElement()
                .satisfies(e -> assertThat(((DomainException) e).getErrorCode()).isEqualTo(ShopErrorCode.STATE_CONFLICT));
        assertThat(islandBalance(f.islandId)).isEqualTo(70);
    }

    @Test
    @DisplayName("개인 상품(옷)은 구매자 소유로 지급되지만 돈은 섬 통장에서 나간다 — 개인 지갑은 건드리지 않는다 (SH-재화)")
    void personalProductIsPaidByTheIsland() {
        Fixture f = island(GroupPermissionScope.OWNER_ONLY);
        fund(f.islandId, 50);
        String id = product("clothes", "user", null);
        publish(entry(id, 1, 20, null, null, "personal", 1));

        ShopViews.Order order = buy(f, f.ownerId, id, UUID.randomUUID());

        assertThat(order.ownerType()).isEqualTo("user");
        assertThat(islandBalance(f.islandId)).isEqualTo(30);
        assertThat(count("SELECT COUNT(*) FROM owned_products WHERE owner_type = 'user' AND user_id = ?"
                + " AND product_id = '" + id + "'", f.ownerId)).isEqualTo(1);
        assertThat(count("SELECT COUNT(*) FROM user_fish_wallets WHERE user_id = ?", f.ownerId)).isZero();
        assertThat(count("SELECT COUNT(*) FROM event_outbox WHERE type = 'inventory.updated'"
                + " AND aggregate_id = ? AND subject_id IS NULL", f.ownerId.toString())).isEqualTo(1);
    }

    @Test
    @DisplayName("잔액 부족은 아무것도 남기지 않고 409 — 충전 뒤 새 키로 사면 성공한다")
    void insufficientThenNewKey() {
        Fixture f = island(GroupPermissionScope.OWNER_ONLY);
        fund(f.islandId, 10);
        String id = product("island_theme", "island", null);
        publish(entry(id, 1, 30, null, null, "island", 1));

        assertCode(() -> buy(f, f.ownerId, id, UUID.randomUUID()), ShopErrorCode.INSUFFICIENT_FUNDS);
        assertThat(shop.products(f.islandId, f.ownerId, "island", null, null, null, 30).items().get(0).reason())
                .isEqualTo("INSUFFICIENT_FUNDS");
        assertThat(islandBalance(f.islandId)).isEqualTo(10);
        assertThat(count("SELECT COUNT(*) FROM shop_orders WHERE island_id = ?", f.islandId)).isZero();
        assertThat(count("SELECT COUNT(*) FROM owned_products WHERE group_id = ?", f.islandId)).isZero();

        fund(f.islandId, 40);
        ShopViews.Order order = buy(f, f.ownerId, id, UUID.randomUUID());

        assertThat(order.spent()).isEqualTo(30);
        assertThat(islandBalance(f.islandId)).isEqualTo(20);
    }

    // ---------------------------------------------------------------- 권한·선행·버전

    @Test
    @DisplayName("SHARED_PURCHASE — 기본 OWNER_ONLY 섬의 주민은 403, ALL_MEMBERS 섬의 주민은 산다. 비주민은 MEMBER_ONLY")
    void sharedPurchasePermission() {
        Fixture ownerOnly = island(GroupPermissionScope.OWNER_ONLY);
        UUID resident = join(ownerOnly.islandId);
        Fixture open = island(GroupPermissionScope.ALL_MEMBERS);
        UUID openResident = join(open.islandId);
        fund(ownerOnly.islandId, 100);
        fund(open.islandId, 100);
        String id = product("island_theme", "island", null);
        publish(entry(id, 1, 30, null, null, "island", 1));

        assertCode(() -> buy(ownerOnly, resident, id, UUID.randomUUID()), ShopErrorCode.SHOP_FORBIDDEN);
        assertThat(shop.products(ownerOnly.islandId, resident, "island", null, null, null, 30).items().get(0)
                .reason()).isEqualTo("FORBIDDEN");
        assertThat(islandBalance(ownerOnly.islandId)).isEqualTo(100);
        assertCode(() -> buy(ownerOnly, newUser(), id, UUID.randomUUID()), GroupErrorCode.MEMBER_ONLY);
        assertCode(() -> shop.wallets(ownerOnly.islandId, newUser()), GroupErrorCode.MEMBER_ONLY);

        assertThat(buy(open, openResident, id, UUID.randomUUID()).spent()).isEqualTo(30);
        assertThat(islandBalance(open.islandId)).isEqualTo(70);
    }

    @Test
    @DisplayName("선행 조건 — requiredBuilding 미완공은 FACILITY_LOCKED, requiredProduct 미보유는 STATE_CONFLICT")
    void prerequisitesAreEnforced() {
        Fixture f = island(GroupPermissionScope.OWNER_ONLY);
        fund(f.islandId, 100);
        String base = product("island_theme", "island", null);
        String deluxe = product("building_theme", "island", "hall");
        publish(entry(base, 1, 10, "shop", null, "island", 1), entry(deluxe, 1, 20, null, base, "island", 2));

        assertCode(() -> buy(f, f.ownerId, base, UUID.randomUUID()), ShopErrorCode.FACILITY_LOCKED);
        assertCode(() -> buy(f, f.ownerId, deluxe, UUID.randomUUID()), ShopErrorCode.STATE_CONFLICT);
        ShopViews.Product detail = shop.product(f.islandId, f.ownerId, deluxe);
        assertThat(detail.requiredProduct()).isEqualTo(new ShopViews.RequiredProduct(base, base + "-title"));
        assertThat(detail.targetBuilding()).isEqualTo("hall");
        assertThat(detail.blockedReason()).isEqualTo("STATE_CONFLICT");
        assertThat(shop.product(f.islandId, f.ownerId, base).blockedReason()).isEqualTo("FACILITY_LOCKED");

        complete(f, "shop");
        buy(f, f.ownerId, base, UUID.randomUUID());
        buy(f, f.ownerId, deluxe, UUID.randomUUID());

        assertThat(islandBalance(f.islandId)).isEqualTo(70);
    }

    @Test
    @DisplayName("낡은 expectedProductVersion·expectedWalletVersion 은 차감 없이 VERSION_CONFLICT 다")
    void staleVersionsConflict() {
        Fixture f = island(GroupPermissionScope.OWNER_ONLY);
        fund(f.islandId, 100);
        String id = product("island_theme", "island", null);
        publish(entry(id, 2, 30, null, null, "island", 1));
        long walletVersion = shop.wallets(f.islandId, f.ownerId).villagePointsVersion();

        assertCode(() -> shop.purchase(f.islandId, f.ownerId, id, walletVersion, 1, UUID.randomUUID()),
                ShopErrorCode.VERSION_CONFLICT);
        assertCode(() -> shop.purchase(f.islandId, f.ownerId, id, walletVersion + 1, 2, UUID.randomUUID()),
                ShopErrorCode.VERSION_CONFLICT);
        assertThat(islandBalance(f.islandId)).isEqualTo(100);
        assertThat(shop.purchase(f.islandId, f.ownerId, id, walletVersion, 2, UUID.randomUUID()).spent())
                .isEqualTo(30);
    }

    // ---------------------------------------------------------------- 목록 커서·내역

    @Test
    @DisplayName("카탈로그 커서는 첫 발행본을 고정한다 — 새 발행본이 켜져도 이어 읽고, 폐기되면 CURSOR_EXPIRED")
    void catalogCursorPinsThePublication() {
        Fixture f = island(GroupPermissionScope.OWNER_ONLY);
        String a = product("decor", "user", null);
        String b = product("decor", "user", null);
        long first = publish(entry(a, 1, 5, null, null, "personal", 1), entry(b, 1, 5, null, null, "personal", 2));

        ShopViews.ProductPage one = shop.products(f.islandId, f.ownerId, "personal", null, null, null, 1);
        assertThat(one.items()).extracting(ShopViews.Item::id).containsExactly(a);
        assertThat(one.hasMore()).isTrue();
        publish(entry(b, 1, 5, null, null, "personal", 1));   // 새 발행본 — a 가 빠졌다

        ShopViews.ProductPage two = shop.products(f.islandId, f.ownerId, "personal", one.publicationVersion(),
                one.lastDisplayOrder(), one.lastProductId(), 1);
        assertThat(two.publicationVersion()).isEqualTo(first);
        assertThat(two.items()).extracting(ShopViews.Item::id).containsExactly(b);
        assertThat(two.hasMore()).isFalse();

        jdbc.update("UPDATE shop_catalog_publications SET invalidated_at = now() WHERE version = ?", first);
        assertCode(() -> shop.products(f.islandId, f.ownerId, "personal", first, 1, a, 1),
                ShopErrorCode.CURSOR_EXPIRED);
        assertCode(() -> shop.products(f.islandId, f.ownerId, "hull", null, null, null, 1), ShopErrorCode.OUT_OF_RANGE);
    }

    @Test
    @DisplayName("내역은 섬 귀속이다 — personal 은 그 섬의 내 주문, shared 는 그 섬의 공동 주문, 다른 섬 주문은 섞이지 않는다")
    void orderHistoryIsIslandScoped() {
        Fixture f = island(GroupPermissionScope.OWNER_ONLY);
        Fixture other = island(GroupPermissionScope.ALL_MEMBERS);
        members.save(GroupMember.builder().user(users.getReferenceById(f.ownerId))
                .group(groups.getReferenceById(other.islandId)).role(GroupMemberRole.MEMBER).build());
        fund(f.islandId, 100);
        fund(other.islandId, 100);
        String clothes = product("clothes", "user", null);
        String theme = product("island_theme", "island", null);
        String otherTheme = product("island_theme", "island", null);
        publish(entry(clothes, 1, 10, null, null, "personal", 1), entry(theme, 1, 20, null, null, "island", 1),
                entry(otherTheme, 1, 30, null, null, "island", 2));
        ShopViews.Order bought = buy(f, f.ownerId, clothes, UUID.randomUUID());
        ShopViews.Order shared = buy(f, f.ownerId, theme, UUID.randomUUID());
        ShopViews.Order elsewhere = buy(other, f.ownerId, otherTheme, UUID.randomUUID());

        ShopViews.OrderPage personal = shop.orders(f.islandId, f.ownerId, "personal", null, null, 1);
        assertThat(personal.items()).extracting(ShopViews.OrderItem::id).containsExactly(shared.id());
        assertThat(personal.hasMore()).isTrue();
        ShopViews.OrderItem last = personal.items().get(0);
        assertThat(shop.orders(f.islandId, f.ownerId, "personal", last.createdAt(), last.id(), 1).items())
                .extracting(ShopViews.OrderItem::id).containsExactly(bought.id());
        assertThat(shop.orders(f.islandId, f.ownerId, "shared", null, null, 30).items())
                .extracting(ShopViews.OrderItem::id).containsExactly(shared.id());
        assertThat(shop.orders(other.islandId, f.ownerId, "personal", null, null, 30).items())
                .extracting(ShopViews.OrderItem::id).containsExactly(elsewhere.id());
        assertThat(shop.orders(f.islandId, f.ownerId, "shared", null, null, 30).items().get(0).price())
                .isEqualTo(20);
        assertCode(() -> shop.orders(f.islandId, f.ownerId, "all", null, null, 30), ShopErrorCode.OUT_OF_RANGE);
    }

    // ---------------------------------------------------------------- 음원 → 재생

    @Test
    @DisplayName("sound 음원을 사면 섬이 소유하고, 방송기 재생 PATCH 가 그 곡을 고를 수 있다 (B20·#825)")
    void soundPurchaseIsPlayable() {
        Fixture f = island(GroupPermissionScope.OWNER_ONLY);
        complete(f, "gram");
        fund(f.islandId, 100);
        String id = product("audio", "island", null);
        tracks.save(AudioTrack.of(id, 95_000, Instant.now()));
        publish(entry(id, 1, 30, "gram", null, "sound", 1));

        ShopViews.Item item = shop.products(f.islandId, f.ownerId, "sound", null, null, null, 30).items().get(0);
        assertThat(item.kind()).isEqualTo("audio");
        assertThat(item.available()).isTrue();
        buy(f, f.ownerId, id, UUID.randomUUID());

        PlaybackView view = playback.patch(f.islandId, f.ownerId, UUID.randomUUID(), List.of("trackId", "playing"),
                Map.of("trackId", id, "playing", true), 0L).data();

        assertThat(view.trackId()).isEqualTo(id);
        assertThat(view.durationSeconds()).isEqualTo(95.0);
    }

    // ---------------------------------------------------------------- 도구

    private ShopViews.Order buy(Fixture f, UUID userId, String productId, UUID key) {
        ShopViews.Wallets wallets = shop.wallets(f.islandId, userId);
        long productVersion = revisionOf(productId);
        return shop.purchase(f.islandId, userId, productId, wallets.villagePointsVersion(), productVersion, key);
    }

    /** 활성 발행본에서 이 상품의 revision — 앱이 상세에서 받은 productVersion 과 같다. 없으면 1(어차피 404 경로). */
    private long revisionOf(String productId) {
        return activePublication.findCurrent()
                .flatMap(p -> entries.findAll().stream()
                        .filter(e -> e.getPublicationVersion() == p.getPublicationVersion()
                                && e.getProductId().equals(productId))
                        .findFirst())
                .map(ShopCatalogPublicationEntry::getProductRevision)
                .orElse(1);
    }

    /** 운영이 넣을 모양 그대로 — 자산 정의(제목 = id + "-title"). */
    private String product(String kind, String ownerType, String targetBuilding) {
        String id = kind + "-" + UUID.randomUUID().toString().substring(0, 8);
        assets.save(CatalogAsset.define(id, id + "-title", kind, ownerType, targetBuilding, Instant.now()));
        return id;
    }

    private record Listed(String productId, int revision, Integer price, String requiredBuilding,
                          String requiredProductId, String category, int displayOrder) {
    }

    private static Listed entry(String productId, int revision, Integer price, String requiredBuilding,
                                String requiredProductId, String category, int displayOrder) {
        return new Listed(productId, revision, price, requiredBuilding, requiredProductId, category, displayOrder);
    }

    /** 새 발행본을 만들고 활성 포인터를 그리로 옮긴다 — 운영 발행과 같은 순서(revision → 항목 → 포인터). */
    private long publish(Listed... listed) {
        long version = PUBLICATIONS.incrementAndGet();
        Instant now = Instant.now();
        publications.save(ShopCatalogPublication.published(version, now));
        for (Listed l : listed) {
            if (!revisions.existsById(new ShopProductRevisionId(l.productId(), l.revision()))) {
                revisions.save(ShopProductRevision.of(l.productId(), l.revision(), l.price(), l.requiredBuilding(),
                        l.requiredProductId(), null, now));
            }
            entries.save(ShopCatalogPublicationEntry.of(version, l.productId(), l.revision(), l.category(),
                    l.displayOrder()));
        }
        activePublication.save(ShopCatalogActivePublication.pointTo(version, now));
        return version;
    }

    private void fund(UUID islandId, int amount) {
        new TransactionTemplate(transactionManager).executeWithoutResult(status ->
                walletService.creditQuestSettlement(islandId, amount, "seed-" + UUID.randomUUID()));
    }

    private int islandBalance(UUID islandId) {
        return walletService.balanceOf(islandId);
    }

    private void complete(Fixture f, String buildingId) {
        Instant now = Instant.now();
        IslandFacility facility = IslandFacility.started(f.islandId, buildingId, 0, 1, f.ownerId, now, now);
        facility.complete(now);
        facilities.save(facility);
    }

    private Fixture island(GroupPermissionScope permission) {
        User owner = users.save(User.builder().nickname("방장-" + UUID.randomUUID()).build());
        Group island = groups.save(Group.builder().name("섬").maxMembers(10).sharedPurchasePermission(permission)
                .build());
        members.save(GroupMember.builder().user(owner).group(island).role(GroupMemberRole.OWNER).build());
        return new Fixture(island.getId(), owner.getId());
    }

    private UUID join(UUID islandId) {
        UUID userId = newUser();
        members.save(GroupMember.builder().user(users.getReferenceById(userId))
                .group(groups.getReferenceById(islandId)).role(GroupMemberRole.MEMBER).build());
        return userId;
    }

    private UUID newUser() {
        return users.save(User.builder().nickname("u-" + UUID.randomUUID()).build()).getId();
    }

    private long count(String sql, Object... args) {
        Long n = jdbc.queryForObject(sql, Long.class, args);
        return n == null ? 0 : n;
    }

    private long events(String type, String aggregateId) {
        return count("SELECT COUNT(*) FROM event_outbox WHERE type = ? AND aggregate_id = ?", type, aggregateId);
    }

    private static void assertCode(ThrowingCallable call, ErrorCode code) {
        assertThatThrownBy(call).isInstanceOfSatisfying(DomainException.class,
                e -> assertThat(e.getErrorCode()).isEqualTo(code));
    }

    private static List<Object> race(Callable<Object> first, Callable<Object> second) throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(2);
        CyclicBarrier together = new CyclicBarrier(2);
        try {
            List<Future<Object>> futures = List.of(pool.submit(() -> attempt(together, first)),
                    pool.submit(() -> attempt(together, second)));
            return List.of(futures.get(0).get(30, TimeUnit.SECONDS), futures.get(1).get(30, TimeUnit.SECONDS));
        } finally {
            pool.shutdownNow();
        }
    }

    private static Object attempt(CyclicBarrier barrier, Callable<Object> call) throws Exception {
        barrier.await(30, TimeUnit.SECONDS);
        try {
            return call.call();
        } catch (DomainException e) {
            return e;
        }
    }

    private record Fixture(UUID islandId, UUID ownerId) {
    }
}
