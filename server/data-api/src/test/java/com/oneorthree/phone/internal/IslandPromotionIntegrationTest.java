package com.oneorthree.phone.internal;

import com.oneorthree.phone.auth.service.AuthService;
import com.oneorthree.phone.auth.support.JwtProvider;
import com.oneorthree.phone.common.util.ZonePolicy;
import com.oneorthree.phone.construction.exception.ConstructionErrorCode;
import com.oneorthree.phone.construction.exception.ConstructionException;
import com.oneorthree.phone.construction.service.IslandWalletService;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.group.repository.domain.GroupMemberRole;
import com.oneorthree.phone.group.repository.domain.GroupStatus;
import com.oneorthree.phone.internal.dto.CreateIslandCommandRequest;
import com.oneorthree.phone.internal.dto.IslandLedgerPageView;
import com.oneorthree.phone.internal.service.IslandEconomyReadService;
import com.oneorthree.phone.internal.service.IslandManagementService;
import com.oneorthree.phone.internal.service.IslandMembershipService;
import com.oneorthree.phone.internal.service.IslandPromotionService;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import com.oneorthree.phone.user.repository.UserQueryService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.transaction.IllegalTransactionStateException;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.YearMonth;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 고양이 잡지 홍보비와 섬 소식 (GROMO-2267)을 <b>실제 Flyway PostgreSQL</b> 위에서 생산 진입점(내부 표면)으로 검증한다.
 * 시계는 고정한다(KST 하루 경계). 시드는 전부 생산 엔티티·서비스이고, 섬 통장 잔액만 SQL 로 맞춘다.
 *
 * <p>보는 것: 신청의 차감·원장·소식·이벤트, 하루 1회(KST 자정 경계), 잔액 부족의 무흔적 실패, 섬장·게스트 가드,
 * 같은 키 재생(재생 인가 포함), 동시 두 신청, 소식 읽기, 섬이 닫힐 때의 정리, 지갑 계층 계약과 공동 가계부 반영.
 */
@SpringBootTest
@AutoConfigureMockMvc
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class IslandPromotionIntegrationTest {

    private static final String TOKEN = "test-island-promotion-business";
    private static final Instant DAY1 = Instant.parse("2026-10-12T05:00:00Z"); // KST 14:00
    private static final String NEWS_BODY = "섬장이 오늘 잡지 홍보에 60마리를 썼어요";

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
        // 섬이 닫히는 경로(마지막 주민의 나가기)가 섬 관리 명령 스위치 뒤에 있다.
        registry.add("island-management.commands-enabled", () -> true);
        registry.add("internal.api.enabled", () -> true);
        registry.add("internal.api.callers.business.token", () -> TOKEN);
        String[] allow = {"POST /internal/users/*/islands/*/promotions", "GET /internal/users/*/islands/*/news"};
        for (int i = 0; i < allow.length; i++) {
            String entry = allow[i];
            registry.add("internal.api.callers.business.allow[" + i + "]", () -> entry);
        }
    }

    @MockitoBean
    Clock clock;
    @Autowired
    IslandMembershipService islands;
    @Autowired
    IslandManagementService management;
    @Autowired
    IslandWalletService wallets;
    @Autowired
    IslandEconomyReadService economy;
    @Autowired
    PlatformTransactionManager transactions;
    @Autowired
    GroupRepository groups;
    @Autowired
    GroupMemberRepository members;
    @Autowired
    UserQueryService users;
    @Autowired
    AuthService auth;
    @Autowired
    JwtProvider jwt;
    @Autowired
    JdbcTemplate jdbc;
    @Autowired
    MockMvc mvc;

    private final AtomicReference<Instant> now = new AtomicReference<>(DAY1);

    @BeforeEach
    void fixClock() {
        now.set(DAY1);
        when(clock.instant()).thenAnswer(invocation -> now.get());
        when(clock.getZone()).thenReturn(ZonePolicy.KST);
        when(clock.withZone(any())).thenAnswer(invocation -> Clock.fixed(now.get(), invocation.getArgument(0)));
    }

    // ---------------------------------------------------------------- 신청

    @Test
    @DisplayName("섬장이 신청하면 통장에서 60마리가 빠지고(100→40) 원장 1건·섬 소식 1건·wallet.updated 1건이 생긴다")
    void hostPaysSixtyAndNewsIsPublished() throws Exception {
        Island island = island(100);

        String body = promote(island.host, island.id, UUID.randomUUID())
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.feeFish").value(60))
                .andExpect(jsonPath("$.balanceAfter").value(40))
                .andExpect(jsonPath("$.newsId").isString())
                .andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);

        assertThat(balance(island.id)).isEqualTo(40);
        List<Map<String, Object>> ledger = jdbc.queryForList("select type, amount, idempotency_key "
                + "from island_wallet_transactions where island_id = ?", island.id);
        assertThat(ledger).hasSize(1);
        assertThat(ledger.get(0)).containsEntry("type", "PROMOTION_FEE").containsEntry("amount", 60)
                .containsEntry("idempotency_key", "promotion:" + island.id + ":2026-10-12");

        List<Map<String, Object>> news = jdbc.queryForList("select id, kind, body from island_news "
                + "where island_id = ?", island.id);
        assertThat(news).hasSize(1);
        assertThat(news.get(0)).containsEntry("kind", "PROMOTION").containsEntry("body", NEWS_BODY);
        assertThat(body).contains(news.get(0).get("id").toString());
        assertThat(jdbc.queryForObject("select created_at from island_news where island_id = ?",
                OffsetDateTime.class, island.id).toInstant()).as("소식 시각은 주입 Clock 이다").isEqualTo(DAY1);
        assertThat(events("wallet.updated", island.id)).isEqualTo(1);
    }

    @Test
    @DisplayName("같은 KST 날 다른 키로 두 번째 신청은 409 PROMOTION_ALREADY_REQUESTED_TODAY 이고 자정(KST)을 넘기면 다시 된다")
    void oneRequestPerKstDay() throws Exception {
        Island island = island(200);
        promote(island.host, island.id, UUID.randomUUID()).andExpect(status().isCreated());

        promote(island.host, island.id, UUID.randomUUID()).andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("PROMOTION_ALREADY_REQUESTED_TODAY"));
        // 같은 UTC 날이라도 KST 자정(= 15:00Z) 전이면 같은 날이다.
        now.set(Instant.parse("2026-10-12T14:59:00Z"));
        promote(island.host, island.id, UUID.randomUUID()).andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("PROMOTION_ALREADY_REQUESTED_TODAY"));
        assertThat(balance(island.id)).as("거절된 신청은 잔액을 건드리지 않는다").isEqualTo(140);
        assertThat(ledgerRows(island.id)).isEqualTo(1);
        assertThat(newsRows(island.id)).isEqualTo(1);

        now.set(Instant.parse("2026-10-12T15:01:00Z")); // KST 10/13 00:01
        promote(island.host, island.id, UUID.randomUUID()).andExpect(status().isCreated())
                .andExpect(jsonPath("$.balanceAfter").value(80));
        assertThat(jdbc.queryForList("select idempotency_key from island_wallet_transactions where island_id = ? "
                + "order by idempotency_key", String.class, island.id))
                .containsExactly("promotion:" + island.id + ":2026-10-12", "promotion:" + island.id + ":2026-10-13");
        assertThat(newsRows(island.id)).isEqualTo(2);
    }

    @Test
    @DisplayName("잔액이 59 면 409 INSUFFICIENT_FUNDS 이고 흔적이 없다 — 충전 뒤 같은 키로 다시 눌러도 성공한다")
    void insufficientFundsLeavesNoTrace() throws Exception {
        Island island = island(59);
        UUID key = UUID.randomUUID();

        promote(island.host, island.id, key).andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("INSUFFICIENT_FUNDS"));

        assertThat(balance(island.id)).isEqualTo(59);
        assertThat(ledgerRows(island.id)).isZero();
        assertThat(newsRows(island.id)).isZero();
        assertThat(events("wallet.updated", island.id)).isZero();
        assertThat(count("select count(*) from command_idempotency where user_id = ?", island.host))
                .as("실패는 receipt 를 남기지 않는다").isZero();

        setBalance(island.id, 60);
        promote(island.host, island.id, key).andExpect(status().isCreated())
                .andExpect(jsonPath("$.balanceAfter").value(0));
        assertThat(balance(island.id)).as("정확히 60 이면 0 으로 떨어진다").isZero();
        assertThat(newsRows(island.id)).isEqualTo(1);
    }

    @Test
    @DisplayName("섬장이 아니면 403 NOT_OWNER — 일반 주민도 비주민도 차감·소식이 없다")
    void onlyTheHostPays() throws Exception {
        Island island = island(100);

        promote(island.member, island.id, UUID.randomUUID()).andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("NOT_OWNER"));
        promote(island.visitor, island.id, UUID.randomUUID()).andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("NOT_OWNER"));

        assertThat(balance(island.id)).isEqualTo(100);
        assertThat(ledgerRows(island.id)).isZero();
        assertThat(newsRows(island.id)).isZero();
    }

    @Test
    @DisplayName("게스트는 403 SOCIAL_LOGIN_REQUIRED — 섬장이 게스트여도 차감도 receipt 도 없다")
    void guestIsRejectedBeforeAnythingIsWritten() throws Exception {
        UUID guestHost = newGuest();
        UUID islandId = newIsland();
        join(guestHost, islandId, GroupMemberRole.OWNER);
        setBalance(islandId, 100);

        promote(guestHost, islandId, UUID.randomUUID()).andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("SOCIAL_LOGIN_REQUIRED"));

        assertThat(balance(islandId)).isEqualTo(100);
        assertThat(newsRows(islandId)).isZero();
        assertThat(count("select count(*) from command_idempotency where user_id = ?", guestHost)).isZero();
    }

    @Test
    @DisplayName("같은 키 재시도는 원 응답을 그대로 돌려주고 다시 차감하지 않는다 — 재생도 지금 섬장이어야 한다")
    void sameKeyReplaysTheOriginalResult() throws Exception {
        Island island = island(100);
        UUID key = UUID.randomUUID();

        String first = promote(island.host, island.id, key).andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);
        String replay = promote(island.host, island.id, key).andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);

        assertThat(replay).as("같은 응답 — newsId·balanceAfter 포함").isEqualTo(first);
        assertThat(balance(island.id)).as("재생은 다시 차감하지 않는다").isEqualTo(40);
        assertThat(ledgerRows(island.id)).isEqualTo(1);
        assertThat(newsRows(island.id)).isEqualTo(1);
        assertThat(events("wallet.updated", island.id)).as("재생은 사건을 다시 적지 않는다").isEqualTo(1);

        // 위임·강등 뒤의 옛 섬장은 같은 키로 결과를 다시 받을 수 없다.
        jdbc.update("update group_members set role = 'MEMBER' where user_id = ? and group_id = ?",
                island.host, island.id);
        promote(island.host, island.id, key).andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("NOT_OWNER"));
        assertThat(balance(island.id)).isEqualTo(40);
    }

    @Test
    @DisplayName("같은 섬장이 서로 다른 키로 동시에 두 번 신청해도 한 번만 차감된다 — 201 하나, 409 하나")
    void concurrentRequestsChargeOnce() throws Exception {
        Island island = island(200);

        List<Integer> statuses = race(
                () -> promote(island.host, island.id, UUID.randomUUID()).andReturn().getResponse().getStatus(),
                () -> promote(island.host, island.id, UUID.randomUUID()).andReturn().getResponse().getStatus());

        Collections.sort(statuses);
        assertThat(statuses).containsExactly(201, 409);
        assertThat(balance(island.id)).isEqualTo(140);
        assertThat(ledgerRows(island.id)).isEqualTo(1);
        assertThat(newsRows(island.id)).isEqualTo(1);
    }

    // ---------------------------------------------------------------- 소식 읽기

    @Test
    @DisplayName("소식은 주민(섬장·일반 주민)이 최신순으로 읽고 limit 을 지키며, 비주민은 403 MEMBER_ONLY, 범위 밖 limit 은 400")
    void residentsReadNewsNewestFirst() throws Exception {
        Island island = island(200);
        promote(island.host, island.id, UUID.randomUUID()).andExpect(status().isCreated());
        now.set(Instant.parse("2026-10-13T05:00:00Z")); // 다음 KST 날
        promote(island.host, island.id, UUID.randomUUID()).andExpect(status().isCreated());
        // 다른 섬의 소식 — 이 섬 목록에 섞이면 안 된다.
        Island other = island(100);
        promote(other.host, other.id, UUID.randomUUID()).andExpect(status().isCreated());

        for (UUID resident : List.of(island.host, island.member)) {
            readNews(resident, island.id, "").andExpect(status().isOk())
                    .andExpect(jsonPath("$.items.length()").value(2))
                    .andExpect(jsonPath("$.items[0].kind").value("PROMOTION"))
                    .andExpect(jsonPath("$.items[0].body").value(NEWS_BODY))
                    .andExpect(jsonPath("$.items[0].createdAt").value("2026-10-13T05:00:00Z"))
                    .andExpect(jsonPath("$.items[1].createdAt").value("2026-10-12T05:00:00Z"));
        }
        readNews(island.member, island.id, "?limit=1").andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(1))
                .andExpect(jsonPath("$.items[0].createdAt").value("2026-10-13T05:00:00Z"));
        readNews(island.member, island.id, "?limit=50").andExpect(status().isOk());

        readNews(island.visitor, island.id, "").andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("MEMBER_ONLY"));
        readNews(island.member, island.id, "?limit=0").andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_PAGE_REQUEST"));
        readNews(island.member, island.id, "?limit=51").andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_PAGE_REQUEST"));
    }

    @Test
    @DisplayName("소식이 없는 섬은 빈 목록이고, 게스트 주민도 읽을 수 있다 — 읽기는 쓰기가 아니다")
    void emptyNewsAndGuestResidentsMayRead() throws Exception {
        UUID guestMember = newGuest();
        Island island = island(0);
        join(guestMember, island.id, GroupMemberRole.MEMBER);

        readNews(guestMember, island.id, "").andExpect(status().isOk())
                .andExpect(jsonPath("$.items").isEmpty());
    }

    // ---------------------------------------------------------------- 정리 (섬이 닫힐 때)

    @Test
    @DisplayName("섬이 닫히면(purge) 섬 소식과 홍보비 원장이 지워진다 — 그 섬 것만이고, 닫힌 섬엔 더 신청할 수 없다")
    void closingTheIslandPurgesItsNewsOnly() throws Exception {
        UUID host = newUser();
        UUID closing = islands.create(host, new CreateIslandCommandRequest("닫힐", null, false, null),
                UUID.randomUUID()).id();
        setBalance(closing, 100);
        promote(host, closing, UUID.randomUUID()).andExpect(status().isCreated());
        // 다른 섬의 소식 — WHERE island_id 가 빠져 전부 지우는 실수를 잡는다.
        Island staying = island(100);
        promote(staying.host, staying.id, UUID.randomUUID()).andExpect(status().isCreated());
        assertThat(newsRows(closing)).isEqualTo(1);

        management.leave(host, closing, UUID.randomUUID());

        assertThat(count("select count(*) from groups where id = ? and deleted_at is not null", closing))
                .as("삭제 묘비 — 섬 행이 남아 ON DELETE CASCADE 는 돌지 않는다").isEqualTo(1);
        assertThat(newsRows(closing))
                .as("닫힌 섬의 소식").isZero();
        assertThat(ledgerRows(closing))
                .as("닫힌 섬의 홍보비 원장").isZero();
        assertThat(newsRows(staying.id))
                .as("다른 섬의 소식").isEqualTo(1);
        assertThat(ledgerRows(staying.id))
                .as("다른 섬의 원장").isEqualTo(1);

        promote(host, closing, UUID.randomUUID()).andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("GROUP_NOT_FOUND"));
        readNews(host, closing, "").andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("GROUP_NOT_FOUND"));
    }

    // ---------------------------------------------------------------- 지갑 계층 · 가계부

    @Test
    @DisplayName("debitForPromotion — 잠긴 지갑에서 빼 PROMOTION_FEE 원장에 적고, 모자라면 INSUFFICIENT_FUNDS 로 아무것도 바꾸지 않는다")
    void walletDebitContract() {
        Island island = island(100);
        TransactionTemplate tx = new TransactionTemplate(transactions);

        Integer after = tx.execute(status -> wallets.debitForPromotion(island.id, 60, "promotion:test:1"));
        assertThat(after).isEqualTo(40);
        assertThat(jdbc.queryForList("select type, amount from island_wallet_transactions where island_id = ?",
                island.id)).singleElement()
                .satisfies(row -> assertThat(row).containsEntry("type", "PROMOTION_FEE").containsEntry("amount", 60));

        assertThatThrownBy(() -> tx.executeWithoutResult(status -> wallets.debitForPromotion(island.id, 60, "x")))
                .isInstanceOfSatisfying(ConstructionException.class, e ->
                        assertThat(e.getErrorCode()).isEqualTo(ConstructionErrorCode.INSUFFICIENT_FUNDS));
        assertThat(ConstructionErrorCode.INSUFFICIENT_FUNDS.getStatus().value()).isEqualTo(409);
        assertThat(balance(island.id)).as("모자란 차감은 잔액을 바꾸지 않는다").isEqualTo(40);
        assertThat(ledgerRows(island.id))
                .isEqualTo(1);

        // 잠금이 즉시 풀려 아무 일도 하지 않는 호출을 허용하지 않는다 — 트랜잭션 밖 호출은 거절된다.
        assertThatThrownBy(() -> wallets.debitForPromotion(island.id, 60, "no-tx"))
                .isInstanceOf(IllegalTransactionStateException.class);
    }

    @Test
    @DisplayName("공동 가계부에는 지출(spend) 줄 promotion_fee 로 나타나고 지출 합계에 들어간다")
    void ledgerShowsPromotionFeeAsSpend() throws Exception {
        Island island = island(100);
        promote(island.host, island.id, UUID.randomUUID()).andExpect(status().isCreated());

        // 원장 행의 created_at 은 JPA 가 실제 시각으로 적는다 — 질의 달도 실제 시계의 KST 달이다.
        IslandLedgerPageView spend = economy.ledger(island.host, island.id, YearMonth.now(ZonePolicy.KST),
                "spend", null, null, 10);

        assertThat(spend.spentTotal()).isEqualTo(60);
        assertThat(spend.earnedTotal()).isZero();
        assertThat(spend.items()).singleElement().satisfies(entry -> {
            assertThat(entry.direction()).isEqualTo("spend");
            assertThat(entry.reason()).isEqualTo("promotion_fee");
            assertThat(entry.amount()).isEqualTo(IslandPromotionService.PROMOTION_FEE_FISH);
        });
        assertThat(economy.ledger(island.host, island.id, YearMonth.now(ZonePolicy.KST), "earn", null, null, 10)
                .items()).isEmpty();
    }

    // ---------------------------------------------------------------- 도구

    private record Island(UUID id, UUID host, UUID member, UUID visitor) {
    }

    /** 섬장·일반 주민이 있는 섬과 비주민 한 명. 섬 통장은 SQL 로 {@code balance} 에 맞춘다. */
    private Island island(int balance) {
        UUID host = newUser();
        UUID member = newUser();
        UUID islandId = newIsland();
        join(host, islandId, GroupMemberRole.OWNER);
        join(member, islandId, GroupMemberRole.MEMBER);
        setBalance(islandId, balance);
        return new Island(islandId, host, member, newUser());
    }

    private UUID newIsland() {
        return groups.save(Group.builder().name("테스트").maxMembers(10).isPrivate(false)
                .status(GroupStatus.WAITING).build()).getId();
    }

    private void join(UUID userId, UUID islandId, GroupMemberRole role) {
        members.save(GroupMember.builder().user(users.getCaller(userId))
                .group(groups.findById(islandId).orElseThrow()).role(role).build());
    }

    private void setBalance(UUID islandId, int balance) {
        jdbc.update("insert into island_wallets (island_id, balance) values (?, ?) "
                + "on conflict (island_id) do update set balance = excluded.balance", islandId, balance);
    }

    /** 회원 — 게스트로 만든 뒤 {@code is_guest} 만 내린다. */
    private UUID newUser() {
        UUID id = newGuest();
        jdbc.update("update users set is_guest = false where id = ?", id);
        return id;
    }

    private UUID newGuest() {
        return jwt.extractUserId(auth.guestLogin().accessToken());
    }

    private ResultActions promote(UUID actor, UUID islandId, UUID key) throws Exception {
        return mvc.perform(post("/internal/users/" + actor + "/islands/" + islandId + "/promotions")
                .header("Authorization", "Bearer " + TOKEN).header("X-User-Id", actor)
                .header("Idempotency-Key", key));
    }

    private ResultActions readNews(UUID actor, UUID islandId, String query) throws Exception {
        return mvc.perform(get("/internal/users/" + actor + "/islands/" + islandId + "/news" + query)
                .header("Authorization", "Bearer " + TOKEN).header("X-User-Id", actor));
    }

    /** 두 호출을 동시에 출발시키고 결과를 모은다. */
    private static List<Integer> race(Callable<Integer> left, Callable<Integer> right) throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(2);
        CountDownLatch start = new CountDownLatch(1);
        try {
            List<Future<Integer>> futures = new ArrayList<>();
            for (Callable<Integer> task : List.of(left, right)) {
                futures.add(pool.submit(() -> {
                    start.await();
                    return task.call();
                }));
            }
            start.countDown();
            List<Integer> results = new ArrayList<>();
            for (Future<Integer> future : futures) {
                results.add(future.get(60, TimeUnit.SECONDS));
            }
            return results;
        } finally {
            pool.shutdownNow();
        }
    }

    private int balance(UUID islandId) {
        Integer value = jdbc.queryForObject("select balance from island_wallets where island_id = ?",
                Integer.class, islandId);
        return value == null ? 0 : value;
    }

    private long ledgerRows(UUID islandId) {
        return count("select count(*) from island_wallet_transactions where island_id = ?", islandId);
    }

    private long newsRows(UUID islandId) {
        return count("select count(*) from island_news where island_id = ?", islandId);
    }

    private long events(String type, UUID islandId) {
        return count("select count(*) from event_outbox where type = ? and aggregate_id = ?",
                type, islandId.toString());
    }

    private long count(String sql, Object... args) {
        Long value = jdbc.queryForObject(sql, Long.class, args);
        return value == null ? 0L : value;
    }
}
