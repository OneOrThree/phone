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
    private static final Map<String, Integer> DEFAULT_COUNTS = Map.of(
            "construction_cost_policies", 7, "construction_cost_policy_publication", 1,
            "focus_reward_policies", 1, "catalog_assets", 157, "magazine_asset_meta", 64,
            "audio_tracks", 3, "customization_reward_policies", 2, "customization_reward_items", 110);

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

    private void assertVersionZero() {
        assertThat(jdbc.queryForList("SELECT version FROM flyway_schema_history", String.class)).containsExactly("0");
    }
}
