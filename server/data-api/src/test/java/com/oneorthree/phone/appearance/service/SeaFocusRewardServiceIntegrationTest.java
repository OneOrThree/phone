package com.oneorthree.phone.appearance.service;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.oneorthree.phone.appearance.dto.SeaRewardResult;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.domain.User;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.IllegalTransactionStateException;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 바다 집중 누적·단계표 보상 엔진 (GROMO-2274) — <b>실제 Flyway(V112) PostgreSQL</b> 위에서 본다.
 *
 * <p>배선이 {@code OutboxTestPostgres.applyProductionMigrationWiring} 이라 컨텍스트가 뜰 때 운영 마이그레이션을 전부
 * 돌리고 {@code ddl-auto=validate} 가 엔티티({@code char(7)} 매핑 포함)와 스키마를 맞댄다. 시각은 호출자가 넘기므로
 * 시계를 고정할 필요가 없다 — 달 경계(KST)를 정확히 짚는다. 테스트 메서드는 롤백 트랜잭션이라 단계표 행(전역
 * {@code base} 세트)이 서로 새지 않는다.
 */
@SpringBootTest
@Transactional
class SeaFocusRewardServiceIntegrationTest {

    /** KST 2026-10-12 12:00 — 10월이다. */
    private static final Instant OCT_12 = Instant.parse("2026-10-12T03:00:00Z");
    /** KST 2026-10-31 23:59:59 — 아직 10월. */
    private static final Instant OCT_LAST_SECOND = Instant.parse("2026-10-31T14:59:59Z");
    /** KST 2026-11-01 00:00:00 — 11월의 첫 순간. */
    private static final Instant NOV_FIRST_SECOND = Instant.parse("2026-10-31T15:00:00Z");
    private static final Instant NOV_3 = Instant.parse("2026-11-03T03:00:00Z");

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
    }

    @Autowired
    SeaFocusRewardService sea;
    @Autowired
    UserRepository users;
    @Autowired
    JdbcTemplate jdbc;
    @Autowired
    PlatformTransactionManager transactionManager;
    @PersistenceContext
    EntityManager em;

    // ---------------------------------------------------------------- 누적

    @Test
    @DisplayName("40분짜리 바다 집중이 끝나면 평생 누적과 이번 달 누적이 각각 2400초 늘고, 달은 정산 시각의 KST 달이다")
    void fortyMinutesAddsToLifetimeAndMonth() {
        UUID user = newUser();

        SeaRewardResult first = sea.settle(user, 2400, OCT_12);

        assertThat(first.grantedProductIds()).isEmpty();
        assertThat(first.minutesToNextTier()).as("단계표가 비어 있으면 다음 단계도 없다").isNull();
        assertThat(total(user)).containsEntry("lifetime_seconds", 2400L).containsEntry("month_key", "2026-10")
                .containsEntry("month_seconds", 2400L);

        sea.settle(user, 2400, OCT_12.plusSeconds(3600));

        assertThat(total(user)).containsEntry("lifetime_seconds", 4800L).containsEntry("month_seconds", 4800L);
    }

    @Test
    @DisplayName("0초 정산도 행을 만들 뿐 아무것도 지급하지 않는다 — 음수 초는 거부한다")
    void zeroSecondsOnlyCreatesTheRow() {
        UUID user = newUser();

        SeaRewardResult result = sea.settle(user, 0, OCT_12);

        assertThat(result.grantedProductIds()).isEmpty();
        assertThat(total(user)).containsEntry("lifetime_seconds", 0L).containsEntry("month_seconds", 0L);
        assertThatThrownBy(() -> sea.settle(user, -1, OCT_12)).isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    @DisplayName("달이 바뀌면 월 누적은 0 에서 다시 시작하고 평생 누적은 이어진다 — 경계는 KST 자정이다")
    void monthResetsAtKstMidnightButLifetimeContinues() {
        UUID user = newUser();

        sea.settle(user, 1500, OCT_12);
        sea.settle(user, 300, OCT_LAST_SECOND);
        assertThat(total(user)).as("23:59:59 KST 는 아직 10월").containsEntry("month_key", "2026-10")
                .containsEntry("month_seconds", 1800L).containsEntry("lifetime_seconds", 1800L);

        sea.settle(user, 600, NOV_FIRST_SECOND);

        assertThat(total(user)).as("00:00:00 KST 는 11월 — 월 누적만 처음부터")
                .containsEntry("month_key", "2026-11").containsEntry("month_seconds", 600L)
                .containsEntry("lifetime_seconds", 2400L);
    }

    // ---------------------------------------------------------------- 단계표 지급

    @Test
    @DisplayName("누적이 단계를 넘으면 개인 인벤토리에 1번 들어가고 사건이 남는다 — 이미 지나간 단계는 다시 넘지 않는다")
    void crossingATierGrantsOnceAndNeverAgain() {
        UUID user = newUser();
        String scarf = product("clothes");
        tier("base", 30, scarf);
        long eventsBefore = inventoryEvents(user);

        SeaRewardResult before = sea.settle(user, 1200, OCT_12);
        assertThat(before.grantedProductIds()).as("20분 — 아직 30분을 넘지 않았다").isEmpty();
        assertThat(before.minutesToNextTier()).isEqualTo(10);
        assertThat(owned(user)).isEmpty();

        SeaRewardResult crossing = sea.settle(user, 1200, OCT_12.plusSeconds(3600));
        assertThat(crossing.grantedProductIds()).containsExactly(scarf);
        assertThat(crossing.minutesToNextTier()).as("더 받을 단계가 없다").isNull();
        assertThat(crossing.events()).hasSize(1);
        assertThat(owned(user)).containsExactly(scarf);
        assertThat(jdbc.queryForObject("SELECT granted_ref FROM owned_products WHERE user_id = ? AND product_id = ?",
                String.class, user, scarf)).isEqualTo("sea:base:30");
        assertThat(inventoryEvents(user)).as("지급마다 인벤토리 사건 한 건").isEqualTo(eventsBefore + 1);

        SeaRewardResult after = sea.settle(user, 3600, OCT_12.plusSeconds(7200));
        assertThat(after.grantedProductIds()).as("이미 넘은 단계는 다시 넘지 않는다").isEmpty();
        assertThat(after.events()).isEmpty();
        assertThat(inventoryEvents(user)).isEqualTo(eventsBefore + 1);
    }

    @Test
    @DisplayName("이미 가진 상품의 단계를 넘으면 0 — 다른 세트가 같은 상품을 줘도 한 번만 들어가고, 같이 넘은 다른 상품은 정상 지급")
    void crossingATierWhoseProductIsAlreadyOwnedGrantsNothingNew() {
        UUID user = newUser();
        String scarf = product("clothes");
        String hat = product("decor");
        tier("base", 10, scarf);
        tier("2026-10", 20, scarf);
        tier("2026-10", 20, hat);

        assertThat(sea.settle(user, 600, OCT_12).grantedProductIds()).containsExactly(scarf);

        SeaRewardResult second = sea.settle(user, 600, OCT_12.plusSeconds(3600));

        assertThat(second.grantedProductIds()).as("시즌 20분 단계 둘 중 scarf 는 이미 가졌다").containsExactly(hat);
        assertThat(second.events()).hasSize(1);
        assertThat(owned(user)).containsExactlyInAnyOrder(scarf, hat);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM owned_products WHERE user_id = ? AND product_id = ?",
                Integer.class, user, scarf)).as("(user, product) 한 행").isEqualTo(1);
    }

    @Test
    @DisplayName("한 번의 가산이 여러 단계를 한꺼번에 넘으면 기준 분 순서대로 전부 준다")
    void oneSettleCanCrossSeveralTiers() {
        UUID user = newUser();
        String a = product("clothes");
        String b = product("decor");
        String c = product("clothes");
        tier("base", 60, c);
        tier("base", 10, a);
        tier("base", 30, b);

        SeaRewardResult result = sea.settle(user, 3 * 3600, OCT_12);

        assertThat(result.grantedProductIds()).containsExactly(a, b, c);
        assertThat(result.events()).hasSize(3);
        assertThat(result.minutesToNextTier()).isNull();
    }

    @Test
    @DisplayName("단계 기준 분 정각에 닿는 정산이 그 단계를 넘는다 — 1초 모자라면 다음 정산이다")
    void thresholdIsInclusive() {
        UUID user = newUser();
        String scarf = product("clothes");
        tier("base", 40, scarf);

        SeaRewardResult shy = sea.settle(user, 2399, OCT_12);
        assertThat(shy.grantedProductIds()).isEmpty();
        assertThat(shy.minutesToNextTier()).as("1초가 남아도 0분이 아니라 1분").isEqualTo(1);

        assertThat(sea.settle(user, 1, OCT_12.plusSeconds(60)).grantedProductIds()).containsExactly(scarf);
    }

    @Test
    @DisplayName("11월 시즌은 set_key='2026-11' 행을 넣기만 하면 열린다 — 코드를 바꾸지 않는다")
    void nextMonthSeasonOpensByInsertingRowsOnly() {
        UUID user = newUser();
        String season = product("decor");
        sea.settle(user, 600, OCT_12);

        SeaRewardResult closed = sea.settle(user, 600, NOV_3);
        assertThat(closed.grantedProductIds()).as("11월 행이 아직 없다").isEmpty();
        assertThat(closed.minutesToNextTier()).isNull();

        tier("2026-11", 30, season);
        SeaRewardResult shy = sea.settle(user, 600, NOV_3.plusSeconds(3600));
        assertThat(shy.grantedProductIds()).isEmpty();
        assertThat(shy.minutesToNextTier()).as("11월 누적 20분 → 30분까지 10분").isEqualTo(10);
        assertThat(sea.settle(user, 600, NOV_3.plusSeconds(7200)).grantedProductIds()).containsExactly(season);
        assertThat(owned(user)).containsExactly(season);
    }

    @Test
    @DisplayName("지난달 시즌 행은 이번 달 누적으로 평가되지 않는다 — 10월 세트는 11월에 닫힌다")
    void lastMonthsSeasonDoesNotLeakIntoThisMonth() {
        UUID user = newUser();
        String october = product("clothes");
        tier("2026-10", 20, october);

        SeaRewardResult result = sea.settle(user, 3600, NOV_3);

        assertThat(result.grantedProductIds()).isEmpty();
        assertThat(result.minutesToNextTier()).isNull();
        assertThat(owned(user)).isEmpty();
    }

    @Test
    @DisplayName("개인 인벤토리 종류(clothes·decor)가 아닌 상품 행은 건너뛰고 경고를 남긴다 — 나머지 행은 정상 지급")
    void nonInventoryKindsAreSkippedWithAWarning() {
        UUID user = newUser();
        String audio = product("audio");
        String islandTheme = product("island_theme");
        String scarf = product("clothes");
        tier("base", 10, audio);
        tier("base", 10, islandTheme);
        tier("base", 10, scarf);
        tier("base", 20, audio);
        tier("base", 40, product("decor"));

        Logger logger = (Logger) LoggerFactory.getLogger(SeaFocusRewardService.class);
        ListAppender<ILoggingEvent> appender = new ListAppender<>();
        appender.start();
        logger.addAppender(appender);
        try {
            SeaRewardResult result = sea.settle(user, 10 * 60, OCT_12);

            assertThat(result.grantedProductIds()).containsExactly(scarf);
            assertThat(owned(user)).containsExactly(scarf);
            assertThat(result.minutesToNextTier())
                    .as("20분 단계는 받지 못할 audio 라 안내하지 않는다 — 다음은 40분 decor").isEqualTo(30);
            assertThat(appender.list)
                    .filteredOn(event -> event.getLevel() == Level.WARN)
                    .extracting(ILoggingEvent::getFormattedMessage)
                    .anyMatch(message -> message.contains(audio) && message.contains("audio"))
                    .anyMatch(message -> message.contains(islandTheme) && message.contains("island_theme"));
        } finally {
            logger.detachAppender(appender);
        }
        // 지급 사건은 지급한 1건뿐이다 — 건너뛴 행은 사건도 보유 행도 남기지 않는다.
        assertThat(jdbc.queryForObject("SELECT count(*) FROM owned_products WHERE user_id = ?", Integer.class,
                user)).isEqualTo(1);
    }

    // ---------------------------------------------------------------- 다음 단계까지 남은 분

    @Test
    @DisplayName("다음 단계까지 남은 분은 상시·시즌 두 세트 중 가장 가까운 것이고, 초는 올림한다")
    void minutesToNextTierIsTheNearestOfBothSets() {
        UUID user = newUser();
        tier("base", 100, product("clothes"));
        tier("base", 200, product("decor"));
        tier("2026-10", 50, product("decor"));
        tier("2026-11", 5, product("clothes"));

        assertThat(sea.settle(user, 600, OCT_12).minutesToNextTier())
                .as("상시 100분 → 90, 시즌 50분 → 40 — 가까운 쪽").isEqualTo(40);
        assertThat(sea.settle(user, 2099, OCT_12.plusSeconds(3600)).minutesToNextTier())
                .as("시즌까지 301초 → 올림 6분").isEqualTo(6);
        sea.settle(user, 301, OCT_12.plusSeconds(7200));
        assertThat(sea.settle(user, 0, OCT_12.plusSeconds(7300)).minutesToNextTier())
                .as("시즌 50분을 넘은 뒤 가장 가까운 것은 상시 100분 — 누적 50분 → 50").isEqualTo(50);
    }

    // ---------------------------------------------------------------- 트랜잭션 · 경합 · 탈퇴

    @Test
    @Transactional(propagation = Propagation.NOT_SUPPORTED)
    @DisplayName("호출자의 트랜잭션에 합류해야 한다 — 밖에서 부르면 거절한다(집중 종료가 롤백돼도 상품이 남지 않게)")
    void requiresTheCallersTransaction() {
        assertThatThrownBy(() -> sea.settle(UUID.randomUUID(), 60, OCT_12))
                .isInstanceOf(IllegalTransactionStateException.class);
        assertThatThrownBy(() -> sea.eraseWithdrawnUser(UUID.randomUUID()))
                .isInstanceOf(IllegalTransactionStateException.class);
    }

    @Test
    @Transactional(propagation = Propagation.NOT_SUPPORTED)
    @DisplayName("누적 행이 아직 없는 유저의 첫 정산 둘이 겹쳐도 둘 다 반영된다 — PK 위반으로 종료가 실패하지 않는다")
    void concurrentFirstSettlesBothCount() throws Exception {
        UUID user = newUser();
        TransactionTemplate tx = new TransactionTemplate(transactionManager);
        CountDownLatch firstHoldsRow = new CountDownLatch(1);
        CountDownLatch releaseFirst = new CountDownLatch(1);

        CompletableFuture<Void> first = CompletableFuture.runAsync(() -> tx.executeWithoutResult(status -> {
            sea.settle(user, 600, OCT_12);
            firstHoldsRow.countDown();
            await(releaseFirst);
        }));
        assertThat(firstHoldsRow.await(10, TimeUnit.SECONDS)).isTrue();
        // 첫 트랜잭션이 행을 만든 채 커밋 전이다 — 둘째는 그 행을 기다린다(실패하지 않는다).
        CompletableFuture<Void> second = CompletableFuture.runAsync(
                () -> tx.executeWithoutResult(status -> sea.settle(user, 900, OCT_12.plusSeconds(60))));
        TimeUnit.MILLISECONDS.sleep(400);
        assertThat(second).as("첫 트랜잭션이 커밋하기 전에는 끝나지 않는다").isNotDone();
        releaseFirst.countDown();
        first.get(10, TimeUnit.SECONDS);
        second.get(10, TimeUnit.SECONDS);

        assertThat(total(user)).containsEntry("lifetime_seconds", 1500L).containsEntry("month_seconds", 1500L);
    }

    @Test
    @DisplayName("탈퇴 파기는 그 유저의 누적 행만 지운다 — 지급된 상품은 건드리지 않는다(외양 도메인의 파기 몫)")
    void eraseDeletesOnlyThatUsersTotals() {
        UUID gone = newUser();
        UUID stays = newUser();
        String scarf = product("clothes");
        tier("base", 10, scarf);
        sea.settle(gone, 600, OCT_12);
        sea.settle(stays, 600, OCT_12);

        sea.eraseWithdrawnUser(gone);
        flush();

        assertThat(jdbc.queryForObject("SELECT count(*) FROM sea_focus_totals WHERE user_id = ?", Integer.class, gone))
                .isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM sea_focus_totals WHERE user_id = ?", Integer.class,
                stays)).isEqualTo(1);
        assertThat(owned(gone)).as("보유 행은 AppearanceService.eraseWithdrawnUser 가 지운다").containsExactly(scarf);
    }

    // ---------------------------------------------------------------- 도우미

    private UUID newUser() {
        return users.save(User.builder().nickname("sea-" + UUID.randomUUID()).build()).getId();
    }

    /** 테스트마다 유일한 카탈로그 상품 — 종류에 맞는 주인 축으로 만든다(CHECK). */
    private String product(String kind) {
        String productId = kind + "-" + UUID.randomUUID().toString().substring(0, 8);
        String ownerType = kind.equals("clothes") || kind.equals("decor") ? "user" : "island";
        jdbc.update("INSERT INTO catalog_assets (product_id, title, kind, owner_type, created_at) "
                + "VALUES (?, ?, ?, ?, now())", productId, productId, kind, ownerType);
        return productId;
    }

    private void tier(String setKey, int minutes, String productId) {
        jdbc.update("INSERT INTO sea_reward_tiers (set_key, threshold_minutes, product_id) VALUES (?, ?, ?)",
                setKey, minutes, productId);
    }

    private Map<String, Object> total(UUID user) {
        flush();
        return jdbc.queryForMap("SELECT lifetime_seconds, month_key, month_seconds FROM sea_focus_totals "
                + "WHERE user_id = ?", user);
    }

    private List<String> owned(UUID user) {
        flush();
        return jdbc.queryForList("SELECT product_id FROM owned_products WHERE owner_type = 'user' "
                + "AND user_id = ? ORDER BY product_id", String.class, user);
    }

    private long inventoryEvents(UUID user) {
        flush();
        Long count = jdbc.queryForObject("SELECT count(*) FROM event_outbox WHERE type = 'inventory.updated' "
                + "AND aggregate_type = 'USER_INVENTORY' AND aggregate_id = ?", Long.class, user.toString());
        return count == null ? 0L : count;
    }

    /** JPA 로 쓴 행을 JDBC 로 읽기 전에 내보낸다 — 트랜잭션 밖(경합 테스트)에서는 쓸 것이 없다. */
    private void flush() {
        if (TransactionSynchronizationManager.isActualTransactionActive()) {
            em.flush();
        }
    }

    private static void await(CountDownLatch latch) {
        try {
            latch.await(10, TimeUnit.SECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}
