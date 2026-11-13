package com.oneorthree.phone.db;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.containers.PostgreSQLContainer;

import java.sql.Connection;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** 새 배포마다 실행하는 기본 데이터 콜백의 복구·보존·충돌·동시성 계약. */
class V0DefaultSeedTest {
    private static final PostgreSQLContainer<?> POSTGRES;
    private static final Map<String, Integer> DEFAULT_COUNTS = Map.ofEntries(
            Map.entry("construction_cost_policies", 7), Map.entry("construction_cost_policy_publication", 1),
            Map.entry("focus_reward_policies", 1), Map.entry("catalog_assets", 162),
            Map.entry("magazine_asset_meta", 64), Map.entry("audio_tracks", 3),
            Map.entry("customization_reward_policies", 2), Map.entry("customization_reward_items", 110),
            Map.entry("shop_product_revisions", 35), Map.entry("shop_catalog_publications", 1),
            Map.entry("shop_catalog_publication_entries", 35), Map.entry("shop_catalog_active_publication", 1));

    static {
        POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");
        POSTGRES.start();
    }

    private DriverManagerDataSource dataSource;
    private JdbcTemplate jdbc;

    @BeforeEach
    void resetSchema() {
        dataSource = new DriverManagerDataSource(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
        jdbc = new JdbcTemplate(dataSource);
        jdbc.execute("DROP SCHEMA public CASCADE");
        jdbc.execute("CREATE SCHEMA public");
    }

    @Test
    void 빈_DB는_최종_기본데이터와_V0_한_행만_생성한다() throws Exception {
        migrate();

        assertDefaults();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM users", Integer.class)).isZero();
        assertThat(jdbc.queryForObject("SELECT category_weights::text FROM customization_reward_policies "
                + "WHERE revision=2", String.class)).isEqualTo("{\"head\": 1, \"neck\": 1}");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM customization_reward_items WHERE revision=2 "
                + "AND jsonb_array_length(render_data->'validatedColors')=6", Integer.class)).isEqualTo(20);
        try (var canonical = getClass().getResourceAsStream("/db/seed/insert.sql");
                var callback = getClass().getResourceAsStream("/db/v0/afterMigrate__defaults.sql")) {
            assertThat(canonical).isNotNull();
            assertThat(callback).isNotNull();
            assertThat(callback.readAllBytes()).isEqualTo(canonical.readAllBytes());
        }
    }

    @Test
    void 신규_마이그레이션이_없어도_누락을_복구하고_재실행은_멱등이다() {
        migrate();
        Map<String, Object> existing = jdbc.queryForMap("SELECT * FROM catalog_assets "
                + "WHERE product_id='campfire'");
        removeAudio();

        migrate();
        migrate();

        assertDefaults();
        assertThat(jdbc.queryForMap("SELECT * FROM catalog_assets WHERE product_id='campfire'"))
                .isEqualTo(existing);
    }

    @Test
    void 운영_건설정책과_발행포인터_및_퇴역상태는_보존한다() {
        migrate();
        jdbc.update("UPDATE construction_cost_policies SET cost=999 WHERE revision=1 AND building_id='hall'");
        jdbc.update("INSERT INTO construction_cost_policies(revision,building_id,cost,build_seconds) "
                + "VALUES (42,'hall',333,120)");
        jdbc.update("UPDATE construction_cost_policy_publication SET revision=42");
        jdbc.update("UPDATE magazine_asset_meta SET retired_at=now() WHERE product_id="
                + "(SELECT min(product_id) FROM magazine_asset_meta)");
        Map<String, Object> policy = jdbc.queryForMap("SELECT * FROM construction_cost_policy_publication");

        migrate();

        assertThat(jdbc.queryForObject("SELECT cost FROM construction_cost_policies "
                + "WHERE revision=1 AND building_id='hall'", Integer.class)).isEqualTo(999);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM construction_cost_policies", Integer.class)).isEqualTo(8);
        assertThat(jdbc.queryForMap("SELECT * FROM construction_cost_policy_publication")).isEqualTo(policy);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM magazine_asset_meta WHERE retired_at IS NOT NULL",
                Integer.class)).isOne();
    }

    @Test
    void 빈_DB는_상점_발행본_v1을_활성으로_만들고_소다_섬_테마는_팔지_않는다() {
        migrate();

        assertThat(jdbc.queryForObject("SELECT publication_version FROM shop_catalog_active_publication",
                Long.class)).isEqualTo(1L);
        assertThat(jdbc.queryForList("SELECT product_id FROM shop_catalog_publication_entries "
                + "WHERE publication_version=1 AND category='island' ORDER BY display_order", String.class))
                .containsExactly("strawberry-roof", "strawberry-board", "strawberry-tower", "strawberry-mail",
                        "strawberry-shop");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM shop_catalog_publication_entries e "
                + "JOIN catalog_assets a ON a.product_id=e.product_id WHERE e.category='personal' "
                + "AND a.kind IN ('head','neck','shoes') AND a.owner_type='user'", Integer.class)).isEqualTo(30);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM catalog_assets WHERE product_id='soda-theme'",
                Integer.class)).isZero();
    }

    @Test
    void 운영이_옮긴_상점_발행포인터와_발행본_시각은_보존한다() {
        migrate();
        jdbc.update("INSERT INTO shop_catalog_publications(version) VALUES (2)");
        jdbc.update("UPDATE shop_catalog_publications SET retired_at=now(), invalidated_at=now() WHERE version=1");
        jdbc.update("UPDATE shop_catalog_active_publication SET publication_version=2, "
                + "activated_at=now() - interval '1 day'");
        Map<String, Object> pointer = jdbc.queryForMap("SELECT * FROM shop_catalog_active_publication");
        Map<String, Object> first = jdbc.queryForMap("SELECT * FROM shop_catalog_publications WHERE version=1");

        migrate();

        assertThat(jdbc.queryForMap("SELECT * FROM shop_catalog_active_publication")).isEqualTo(pointer);
        assertThat(jdbc.queryForMap("SELECT * FROM shop_catalog_publications WHERE version=1")).isEqualTo(first);
        assertVersionZero();
    }

    @Test
    void 운영이_무효로_내린_발행본_v1의_포인터는_되살리지_않는다() {
        migrate();
        jdbc.update("DELETE FROM shop_catalog_active_publication");
        jdbc.update("UPDATE shop_catalog_publications SET invalidated_at=now() WHERE version=1");

        migrate();

        assertThat(jdbc.queryForObject("SELECT count(*) FROM shop_catalog_active_publication", Integer.class))
                .isZero();
        assertVersionZero();
    }

    /** dev 는 2026-11-12 에 같은 발행본 v1 을 SQL 로 먼저 넣었고, 1번 자리에 소다 섬 테마가 더 있다. */
    @Test
    void dev가_먼저_넣은_발행본_v1에_상품이_더_있어도_충돌없이_보존한다() {
        migrate();
        jdbc.update("INSERT INTO catalog_assets(product_id,title,kind,owner_type,target_building) "
                + "VALUES ('soda-theme','소다 섬 테마','island_theme','island',NULL)");
        jdbc.update("INSERT INTO shop_product_revisions(product_id,revision,currency,price) "
                + "VALUES ('soda-theme',1,'village_points',1000)");
        jdbc.update("INSERT INTO shop_catalog_publication_entries"
                + "(publication_version,product_id,product_revision,category,display_order) "
                + "VALUES (1,'soda-theme',1,'island',1)");

        migrate();

        assertThat(jdbc.queryForObject("SELECT count(*) FROM shop_catalog_publication_entries "
                + "WHERE publication_version=1", Integer.class)).isEqualTo(36);
        assertThat(jdbc.queryForObject("SELECT product_id FROM shop_catalog_publication_entries "
                + "WHERE publication_version=1 AND category='island' AND display_order=1", String.class))
                .isEqualTo("soda-theme");
        assertVersionZero();
    }

    @Test
    void 판매_revision_가격이_다르면_기본데이터_전체가_롤백된다() {
        migrate();
        jdbc.update("UPDATE shop_product_revisions SET price=999 WHERE product_id='cust.head.bear' AND revision=1");

        assertThatThrownBy(this::migrate).hasStackTraceContaining("기본 데이터 충돌: shop_product_revisions");

        assertThat(jdbc.queryForObject("SELECT price FROM shop_product_revisions "
                + "WHERE product_id='cust.head.bear' AND revision=1", Integer.class)).isEqualTo(999);
        assertVersionZero();
    }

    @Test
    void 같은_상품의_의미가_다르면_기본데이터_전체가_롤백된다() {
        migrate();
        jdbc.update("DELETE FROM construction_cost_policies WHERE revision=1 AND building_id='board'");
        jdbc.update("UPDATE catalog_assets SET title='다른 상품' WHERE product_id='waves'");

        assertThatThrownBy(this::migrate).hasStackTraceContaining("기본 데이터 충돌: catalog_assets");

        assertThat(jdbc.queryForObject("SELECT count(*) FROM construction_cost_policies "
                + "WHERE revision=1 AND building_id='board'", Integer.class)).isZero();
        assertVersionZero();
    }

    @Test
    void 불변_보상정책이_다르면_앞서_복구한_행까지_롤백된다() {
        migrate();
        removeAudio();
        jdbc.update("UPDATE customization_reward_policies SET minimum_active_seconds=901 WHERE revision=2");

        assertThatThrownBy(this::migrate).hasStackTraceContaining("기본 데이터 충돌: customization_reward_policies");

        assertThat(jdbc.queryForObject("SELECT count(*) FROM catalog_assets WHERE product_id='waves'",
                Integer.class)).isZero();
        assertVersionZero();
    }

    @Test
    void 동시_배포는_같은_잠금을_기다린_뒤_한_기본데이터로_수렴한다() throws Exception {
        migrate();
        removeAudio();
        ExecutorService workers = Executors.newFixedThreadPool(2);
        CountDownLatch started = new CountDownLatch(2);
        try (Connection blocker = dataSource.getConnection()) {
            blocker.setAutoCommit(false);
            try (var statement = blocker.createStatement()) {
                statement.execute("SELECT pg_advisory_xact_lock(182212017, 1)");
            }
            var first = workers.submit(() -> {
                started.countDown();
                migrate();
            });
            var second = workers.submit(() -> {
                started.countDown();
                migrate();
            });
            assertThat(started.await(5, TimeUnit.SECONDS)).isTrue();
            assertThatThrownBy(() -> first.get(300, TimeUnit.MILLISECONDS)).isInstanceOf(TimeoutException.class);
            assertThatThrownBy(() -> second.get(300, TimeUnit.MILLISECONDS)).isInstanceOf(TimeoutException.class);
            blocker.commit();
            first.get(20, TimeUnit.SECONDS);
            second.get(20, TimeUnit.SECONDS);
        } finally {
            workers.shutdownNow();
        }
        assertDefaults();
    }

    private void removeAudio() {
        jdbc.update("DELETE FROM audio_tracks WHERE product_id='waves'");
        jdbc.update("DELETE FROM catalog_assets WHERE product_id='waves'");
    }

    private void migrate() {
        Flyway.configure().dataSource(dataSource).locations("classpath:db/v0").load().migrate();
    }

    private void assertDefaults() {
        DEFAULT_COUNTS.forEach((table, count) ->
                assertThat(jdbc.queryForObject("SELECT count(*) FROM " + table, Integer.class)).isEqualTo(count));
        assertVersionZero();
    }

    /** 기본데이터 콜백은 V0 체인에 버전 행을 남기지 않는다. */
    private void assertVersionZero() {
        assertThat(jdbc.queryForList("SELECT version FROM flyway_schema_history", String.class))
                .containsExactly("0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16");
    }
}
