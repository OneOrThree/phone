package com.oneorthree.phone.shop.repository;

import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import com.oneorthree.phone.shop.repository.domain.ShopCatalogPublicationEntryId;
import com.oneorthree.phone.shop.repository.domain.ShopOrder;
import com.oneorthree.phone.shop.repository.domain.ShopProductRevision;
import com.oneorthree.phone.shop.repository.domain.ShopProductRevisionId;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.domain.User;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 상점 테이블 선구축(GROMO-1781, V74)의 실 마이그레이션 검증.
 *
 * <p>배선이 {@code OutboxTestPostgres.applyProductionMigrationWiring} 이라 컨텍스트 부팅 때 운영
 * Flyway 를 V74 까지 돌리고 {@code ddl-auto=validate} 가 엔티티 ↔ 스키마를 맞댄다. writer 가 아직
 * 없으므로(엔드포인트·구매 로직은 후속) 행은 JDBC 로 심고 repository 로 읽는다.
 */
@SpringBootTest
class ShopSchemaIntegrationTest {

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
    }

    @Autowired
    ShopProductRevisionRepository revisions;
    @Autowired
    ShopCatalogActivePublicationRepository activePublication;
    @Autowired
    ShopCatalogPublicationEntryRepository entries;
    @Autowired
    ShopOrderRepository orders;
    @Autowired
    UserRepository users;
    @Autowired
    GroupRepository groups;
    @Autowired
    JdbcTemplate jdbc;

    @Test
    @DisplayName("V74 는 가격을 심지 않는다 — 활성 카탈로그 없음, 미승인 가격은 NULL 로 읽히고 섬 귀속 주문이 매핑된다")
    void mapsTablesWithoutSeededPrices() {
        // 가격 추후 확정(S03) — 마이그레이션은 행을 하나도 만들지 않는다.
        assertThat(activePublication.findAll()).isEmpty();
        assertThat(revisions.count()).isZero();

        UUID userId = users.save(User.builder().nickname("u-" + UUID.randomUUID()).build()).getId();
        UUID islandId = groups.save(Group.builder().name("섬").maxMembers(10).build()).getId();
        seedAsset("rain-1781", "audio", "island");
        jdbc.update("INSERT INTO shop_product_revisions (product_id, revision, preview_media_key)"
                + " VALUES ('rain-1781', 1, 'media/rain')");
        jdbc.update("INSERT INTO shop_product_revisions (product_id, revision, price)"
                + " VALUES ('rain-1781', 2, 30)");
        jdbc.update("INSERT INTO shop_catalog_publications (version) VALUES (1)");
        jdbc.update("INSERT INTO shop_catalog_publication_entries"
                + " (publication_version, product_id, product_revision, category, display_order)"
                + " VALUES (1, 'rain-1781', 2, 'sound', 10)");
        jdbc.update("INSERT INTO shop_catalog_active_publication (publication_version) VALUES (1)");
        UUID orderId = UUID.randomUUID();
        jdbc.update("INSERT INTO shop_orders (id, island_id, requester_id, owner_type, product_id,"
                        + " product_revision, paid_price, currency, wallet_version_after, balance_after)"
                        + " VALUES (?, ?, ?, 'island', 'rain-1781', 2, 30, 'village_points', 5, 70)",
                orderId, islandId, userId);

        ShopProductRevision unapproved = revisions.findById(new ShopProductRevisionId("rain-1781", 1))
                .orElseThrow();
        assertThat(unapproved.getPrice()).as("미승인 = NULL, 0 이 아니다").isNull();
        assertThat(unapproved.getCurrency()).isEqualTo("village_points");
        assertThat(entries.findById(new ShopCatalogPublicationEntryId(1L, "rain-1781")).orElseThrow()
                .getProductRevision()).isEqualTo(2);
        assertThat(activePublication.findAll()).singleElement()
                .satisfies(p -> assertThat(p.getPublicationVersion()).isEqualTo(1L));
        ShopOrder order = orders.findById(orderId).orElseThrow();
        assertThat(order.getIslandId()).isEqualTo(islandId);
        assertThat(order.getPayerType()).isEqualTo("island");
        assertThat(order.getPayerUserId()).isNull();
    }

    @Test
    @DisplayName("0원 가격·섬 밖 통화·개인 결제자는 DB 가 거부한다")
    void rejectsZeroPriceFishCurrencyAndPersonalPayer() {
        seedAsset("scarf-1781", "clothes", "user");

        assertThatThrownBy(() -> jdbc.update("INSERT INTO shop_product_revisions (product_id, revision, price)"
                + " VALUES ('scarf-1781', 1, 0)"))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("shop_product_revisions_price_check");
        assertThatThrownBy(() -> jdbc.update("INSERT INTO shop_product_revisions"
                + " (product_id, revision, currency, price) VALUES ('scarf-1781', 1, 'fish', 20)"))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("shop_product_revisions_currency_check");
        // CHECK 는 FK 트리거보다 먼저 평가된다 — 참조 행 없이도 결제자 제약만 본다.
        assertThatThrownBy(() -> jdbc.update("INSERT INTO shop_orders (id, island_id, requester_id,"
                        + " owner_type, product_id, product_revision, paid_price, currency, payer_type,"
                        + " payer_user_id, wallet_version_after, balance_after) VALUES (?, ?, ?, 'user',"
                        + " 'scarf-1781', 1, 20, 'village_points', 'user', ?, 1, 0)",
                UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID()))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("shop_orders_payer_check");
    }

    private void seedAsset(String productId, String kind, String ownerType) {
        jdbc.update("INSERT INTO catalog_assets (product_id, title, kind, owner_type)"
                + " VALUES (?, ?, ?, ?) ON CONFLICT (product_id) DO NOTHING", productId, productId, kind, ownerType);
    }
}
