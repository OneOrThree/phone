package com.oneorthree.phone.internal;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
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
import com.oneorthree.phone.internal.dto.MagazineViews;
import com.oneorthree.phone.internal.service.IslandEconomyReadService;
import com.oneorthree.phone.internal.service.IslandManagementService;
import com.oneorthree.phone.internal.service.IslandMembershipService;
import com.oneorthree.phone.internal.service.IslandPromotionService;
import com.oneorthree.phone.internal.service.MagazineIssueService;
import com.oneorthree.phone.internal.service.MagazinePublishService;
import com.oneorthree.phone.magazine.repository.domain.MagazineIssue;
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
import org.springframework.test.util.AopTestUtils;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.transaction.IllegalTransactionStateException;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.YearMonth;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
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
import static org.hamcrest.Matchers.nullValue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 고양이 잡지 홍보 칸·홍보비·섬 소식 (GROMO-2267 · GROMO-2289)을 <b>실제 Flyway PostgreSQL</b> 위에서 생산 진입점(내부
 * 표면)으로 검증한다. 시계는 고정한다(KST 07시·자정 경계). 시드는 전부 생산 엔티티·서비스와 V118 재료 시드이고, 섬 통장
 * 잔액·시즌 재료·보유 행만 SQL 로 맞춘다.
 *
 * <p>보는 것: 신청의 차감·원장·칸·소식·이벤트, 한 호에 한 번과 신청 창(07~24시), 비공개 섬, 글·배치·보유 검증(직전 칸에
 * 있던 재료 포함), 잔액 부족의 무흔적 실패, 섬장·게스트 가드, 같은 키 재생(재생 인가·다른 본문 포함), 동시 두 신청,
 * 고치기(창 안에서만·돈·지면 순서 불변), 쓰기 화면 불러오기, 꾸미기 재료 목록, 기능 스위치, 소식 읽기, 섬이 닫힐 때의
 * 정리, 지갑 계층 계약과 공동 가계부 반영.
 */
@SpringBootTest
@AutoConfigureMockMvc
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class IslandPromotionIntegrationTest {

    private static final String TOKEN = "test-island-promotion-business";
    private static final Instant DAY1 = Instant.parse("2026-10-12T05:00:00Z"); // KST 10/12 14:00 → 10/13 호
    private static final String NEWS_BODY = "섬장이 오늘 잡지 홍보에 60마리를 썼어요";
    private static final String BODY = "같이 아침 공부해요";
    private static final String FRAME = "mag.frame-scallop";
    private static final String STICKER = "mag.cat-black-book";
    private static final String TAPE = "mag.tape-cream";
    private static final ObjectMapper JSON = new ObjectMapper();

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
        // 섬이 닫히는 경로(마지막 주민의 나가기)가 섬 관리 명령 스위치 뒤에 있다.
        registry.add("island-management.commands-enabled", () -> true);
        registry.add("internal.api.enabled", () -> true);
        registry.add("internal.api.callers.business.token", () -> TOKEN);
        registry.add("magazine.enabled", () -> true);
        String[] allow = {"POST /internal/users/*/islands/*/promotions", "GET /internal/users/*/islands/*/news",
            "PUT /internal/users/*/islands/*/promotions/*", "GET /internal/users/*/islands/*/promotions/editor",
            "GET /internal/users/*/magazine/assets"};
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
    @Autowired
    IslandPromotionService promotionService;
    @Autowired
    MagazinePublishService publisher;
    @Autowired
    MagazineIssueService issueService;

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
    @DisplayName("섬장이 신청하면 통장에서 60마리가 빠지고(100→40) 내일 호 칸 1건·원장 1건·섬 소식 1건·wallet.updated 1건이 생긴다")
    void hostPaysSixtyAndNewsIsPublished() throws Exception {
        Island island = island(100);

        String body = promote(island.host, island.id, UUID.randomUUID(),
                content("  " + BODY + " ", layout(FRAME, List.of(STICKER, STICKER), TAPE)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.promotionId").isString())
                .andExpect(jsonPath("$.issueDate").value("2026-10-13"))
                .andExpect(jsonPath("$.feeFish").value(60))
                .andExpect(jsonPath("$.balanceAfter").value(40))
                .andExpect(jsonPath("$.newsId").isString())
                .andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);

        assertThat(balance(island.id)).isEqualTo(40);
        List<Map<String, Object>> ledger = jdbc.queryForList("select type, amount, idempotency_key "
                + "from island_wallet_transactions where island_id = ?", island.id);
        assertThat(ledger).hasSize(1);
        assertThat(ledger.get(0)).containsEntry("type", "PROMOTION_FEE").containsEntry("amount", 60)
                .as("원장 키는 신청한 날이 아니라 실릴 호의 날짜다")
                .containsEntry("idempotency_key", "promotion:" + island.id + ":2026-10-13");
        Map<String, Object> row = jdbc.queryForMap("select id, issue_date::text as issue_date, applied_by, body, "
                + "layout::text as layout, moderation, applied_at, updated_at from island_promotions "
                + "where island_id = ?", island.id);
        assertThat(body).contains(row.get("id").toString());
        assertThat(row).containsEntry("issue_date", "2026-10-13").containsEntry("applied_by", island.host)
                .as("앞뒤 공백을 뗀 정규형").containsEntry("body", BODY).containsEntry("moderation", "NONE");
        assertThat(JSON.readTree((String) row.get("layout"))).isEqualTo(JSON.readTree(
                layout(FRAME, List.of(STICKER, STICKER), TAPE)));
        assertThat(((Timestamp) row.get("applied_at")).toInstant()).isEqualTo(DAY1);

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
    @DisplayName("같은 호에 다른 키로 두 번째 신청은 409 PROMOTION_ALREADY_REQUESTED_TODAY, 자정~07시는 409 PROMOTION_WINDOW_CLOSED, 07시부터 다음 호가 된다")
    void oneRequestPerIssueInsideTheWindow() throws Exception {
        Island island = island(200);
        promote(island.host, island.id, UUID.randomUUID()).andExpect(status().isCreated());

        promote(island.host, island.id, UUID.randomUUID()).andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("PROMOTION_ALREADY_REQUESTED_TODAY"));
        // 같은 UTC 날이라도 KST 자정(= 15:00Z) 전이면 같은 창이다.
        now.set(Instant.parse("2026-10-12T14:59:59Z"));
        promote(island.host, island.id, UUID.randomUUID()).andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("PROMOTION_ALREADY_REQUESTED_TODAY"));
        for (String closed : List.of("2026-10-12T15:00:00Z", "2026-10-12T18:30:00Z", "2026-10-12T21:59:59Z")) {
            now.set(Instant.parse(closed)); // KST 10/13 00:00 · 03:30 · 06:59:59
            promote(island.host, island.id, UUID.randomUUID()).andExpect(status().isConflict())
                    .andExpect(jsonPath("$.code").value("PROMOTION_WINDOW_CLOSED"));
        }
        assertThat(balance(island.id)).as("거절된 신청은 잔액을 건드리지 않는다").isEqualTo(140);
        assertThat(ledgerRows(island.id)).isEqualTo(1);
        assertThat(newsRows(island.id)).isEqualTo(1);
        assertThat(promotionRows(island.id)).isEqualTo(1);

        now.set(Instant.parse("2026-10-12T22:00:00Z")); // KST 10/13 07:00 — 10/13 호 발행, 10/14 호 창 열림
        promote(island.host, island.id, UUID.randomUUID()).andExpect(status().isCreated())
                .andExpect(jsonPath("$.issueDate").value("2026-10-14"))
                .andExpect(jsonPath("$.balanceAfter").value(80));
        assertThat(jdbc.queryForList("select idempotency_key from island_wallet_transactions where island_id = ? "
                + "order by idempotency_key", String.class, island.id))
                .containsExactly("promotion:" + island.id + ":2026-10-13", "promotion:" + island.id + ":2026-10-14");
        assertThat(jdbc.queryForList("select issue_date::text from island_promotions where island_id = ? "
                + "order by issue_date", String.class, island.id)).containsExactly("2026-10-13", "2026-10-14");
        assertThat(newsRows(island.id)).isEqualTo(2);
    }

    @Test
    @DisplayName("비공개 섬도 신청된다(10/16) — 201·차감·칸·소식·receipt 가 있고, 다음 호 발행 때 칸이 실려 읽힌다(privateIsland=true)")
    void privateIslandCanPromote() throws Exception {
        Island island = island(100);
        jdbc.update("update groups set is_private = true where id = ?", island.id);

        promote(island.host, island.id, UUID.randomUUID()).andExpect(status().isCreated());

        assertThat(balance(island.id)).isEqualTo(40);
        assertThat(ledgerRows(island.id)).isEqualTo(1);
        assertThat(promotionRows(island.id)).isEqualTo(1);
        assertThat(newsRows(island.id)).isEqualTo(1);
        assertThat(count("select count(*) from command_idempotency where user_id = ?", island.host)).isEqualTo(1);

        now.set(Instant.parse("2026-10-12T22:00:00Z")); // KST 10/13 07:00
        MagazineIssue issue = publisher.publish(LocalDate.of(2026, 10, 13)).orElseThrow();
        MagazineViews.IssuePage page = issueService.issue(island.host, issue.getId(), null, null, 50);
        assertThat(page.cells()).filteredOn(cell -> cell.islandId().equals(island.id))
                .singleElement().satisfies(cell -> assertThat(cell.privateIsland()).isTrue());
    }

    @Test
    @DisplayName("글·배치가 틀리면 아무것도 남지 않는다 — 61자 422 · 금칙어 400 · 줄바꿈(앞뒤 포함) 400 · 스티커 6개 400 · 없는 재료 400 · 자리에 맞지 않는 종류 400 · 모르는 키·틀린 타입 400")
    void invalidContentLeavesNoTrace() throws Exception {
        Island island = island(100);
        String ok = layout(FRAME, List.of(STICKER), TAPE);

        expectRejected(island, content("가".repeat(61), ok), 422, "PROMOTION_TEXT_TOO_LONG");
        expectRejected(island, content("씨발 섬", ok), 400, "BANNED_WORD");
        expectRejected(island, content("첫 줄\n둘째 줄", ok), 400, "PROMOTION_LAYOUT_INVALID");
        expectRejected(island, content(BODY, layout(FRAME, Collections.nCopies(6, STICKER), null)), 400,
                "PROMOTION_LAYOUT_INVALID");
        expectRejected(island, content(BODY, layout("mag.no-such-frame", List.of(), null)), 400,
                "PROMOTION_LAYOUT_INVALID");
        expectRejected(island, content(BODY, layout(STICKER, List.of(), null)), 400, "PROMOTION_LAYOUT_INVALID");
        expectRejected(island, content(BODY, layout(FRAME, List.of(TAPE), null)), 400, "PROMOTION_LAYOUT_INVALID");
        expectRejected(island, content(BODY, layout(FRAME, List.of(), STICKER)), 400, "PROMOTION_LAYOUT_INVALID");
        expectRejected(island, "{\"body\":\"" + BODY + "\"}", 400, "PROMOTION_LAYOUT_INVALID");
        expectRejected(island, content(BODY + "\n", ok), 400, "PROMOTION_LAYOUT_INVALID");
        // 스티커 목록 키의 오타는 빈 칸으로 실리지 않고 거절된다 — 60마리가 빠지지 않는다.
        expectRejected(island, content(BODY, ok.replace("\"stickers\"", "\"sticker\"")), 400,
                "PROMOTION_LAYOUT_INVALID");
        expectRejected(island, content(BODY, ok.replace("\"scale\"", "\"size\"")), 400, "PROMOTION_LAYOUT_INVALID");
        expectRejected(island, content(BODY, ok.replace("\"x\":0.1", "\"x\":\"left\"")), 400,
                "PROMOTION_LAYOUT_INVALID");

        assertNothingWritten(island, 100);
        // 경계값은 통과한다 — 60자, 스티커 5개.
        promote(island.host, island.id, UUID.randomUUID(),
                content("가".repeat(60), layout(FRAME, Collections.nCopies(5, STICKER), TAPE)))
                .andExpect(status().isCreated());
    }

    @Test
    @DisplayName("재료 보유 — 안 가진 시즌 재료·퇴역한 무료 재료는 403, 보유 행이 생기면 통과한다")
    void unownedAssetsAreRejected() throws Exception {
        Island island = island(200);
        String season = magazineAsset("ad_sticker", "sea", "season", false);
        String retiredFrame = magazineAsset("ad_frame", null, "free", true);

        expectRejected(island, content(BODY, layout(FRAME, List.of(season), null)), 403,
                "PROMOTION_ASSET_NOT_OWNED");
        expectRejected(island, content(BODY, layout(retiredFrame, List.of(), null)), 403,
                "PROMOTION_ASSET_NOT_OWNED");
        // 다른 사람(일반 주민)이 가진 것은 섬장의 것이 아니다.
        grant(island.member, season);
        expectRejected(island, content(BODY, layout(FRAME, List.of(season), null)), 403,
                "PROMOTION_ASSET_NOT_OWNED");
        assertNothingWritten(island, 200);

        grant(island.host, season);
        grant(island.host, retiredFrame);
        promote(island.host, island.id, UUID.randomUUID(),
                content(BODY, layout(retiredFrame, List.of(season, season), null))).andExpect(status().isCreated());
    }

    @Test
    @DisplayName("직전 칸에 있던 재료는 보유를 잃어도 그 장수까지 다시 실을 수 있다 — 한 장 더 늘리면 403")
    void assetsOfThePreviousCellStayUsableUpToTheirCount() throws Exception {
        Island island = island(300);
        String season = magazineAsset("ad_sticker", "cat", "season", false);
        grant(island.host, season);
        promote(island.host, island.id, UUID.randomUUID(),
                content(BODY, layout(FRAME, List.of(season, season), null))).andExpect(status().isCreated());
        jdbc.update("delete from owned_products where user_id = ? and product_id = ?", island.host, season);

        now.set(Instant.parse("2026-10-13T05:00:00Z")); // 다음 날 14:00 → 10/14 호
        expectRejected(island, content(BODY, layout(FRAME, List.of(season, season, season), null)), 403,
                "PROMOTION_ASSET_NOT_OWNED");
        promote(island.host, island.id, UUID.randomUUID(),
                content(BODY, layout(FRAME, List.of(STICKER, season, season), null))).andExpect(status().isCreated());
        // 섬장이 바뀌어도 새 섬장이 불러온 칸을 그대로 실을 수 있다(계획 P27).
        jdbc.update("update group_members set role = 'MEMBER' where user_id = ? and group_id = ?",
                island.host, island.id);
        jdbc.update("update group_members set role = 'OWNER' where user_id = ? and group_id = ?",
                island.member, island.id);
        now.set(Instant.parse("2026-10-14T05:00:00Z")); // → 10/15 호
        promote(island.member, island.id, UUID.randomUUID(),
                content(BODY, layout(FRAME, List.of(season, season), null))).andExpect(status().isCreated());
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
        assertThat(promotionRows(island.id)).as("돈이 모자라면 칸도 없다").isZero();

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
        assertThat(promotionRows(island.id)).isEqualTo(1);

        // 같은 키·다른 본문은 재생이 아니라 충돌이다 — 의미 요청에 본문이 실린다.
        promote(island.host, island.id, key, content("다른 글", layout(FRAME, List.of(), null)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("IDEMPOTENCY_KEY_CONFLICT"));
        assertThat(balance(island.id)).isEqualTo(40);

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
        assertThat(promotionRows(closing))
                .as("닫힌 섬의 홍보 칸").isZero();
        assertThat(promotionRows(staying.id))
                .as("다른 섬의 홍보 칸").isEqualTo(1);
        assertThat(newsRows(staying.id))
                .as("다른 섬의 소식").isEqualTo(1);
        assertThat(ledgerRows(staying.id))
                .as("다른 섬의 원장").isEqualTo(1);

        promote(host, closing, UUID.randomUUID()).andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("GROUP_NOT_FOUND"));
        readNews(host, closing, "").andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("GROUP_NOT_FOUND"));
    }

    // ---------------------------------------------------------------- 고치기

    @Test
    @DisplayName("신청 창 안의 고치기는 글·틀·스티커를 바꾸고 돈을 다시 빼지 않으며 지면 순서(applied_at)는 그대로다")
    void editingInsideTheWindow() throws Exception {
        Island island = island(100);
        String promotionId = promotionIdOf(promote(island.host, island.id, UUID.randomUUID()));

        now.set(Instant.parse("2026-10-12T14:59:59Z")); // KST 23:59:59 — 마감 직전
        String edited = layout("mag.frame-cloud", List.of("mag.fish", "mag.fish"), null);
        update(island.host, island.id, promotionId, content(" 고친 글 ", edited)).andExpect(status().isOk())
                .andExpect(jsonPath("$.promotionId").value(promotionId))
                .andExpect(jsonPath("$.issueDate").value("2026-10-13"))
                .andExpect(jsonPath("$.body").value("고친 글"))
                .andExpect(jsonPath("$.layout.frameId").value("mag.frame-cloud"))
                .andExpect(jsonPath("$.layout.stickers.length()").value(2))
                .andExpect(jsonPath("$.layout.tape").doesNotExist())
                .andExpect(jsonPath("$.updatedAt").value("2026-10-12T14:59:59Z"));

        Map<String, Object> row = jdbc.queryForMap("select body, layout::text as layout, applied_at, updated_at "
                + "from island_promotions where id = ?::uuid", promotionId);
        assertThat(row).containsEntry("body", "고친 글");
        assertThat(JSON.readTree((String) row.get("layout"))).isEqualTo(JSON.readTree(edited));
        assertThat(((Timestamp) row.get("applied_at")).toInstant()).as("지면 순서 불변").isEqualTo(DAY1);
        assertThat(((Timestamp) row.get("updated_at")).toInstant())
                .isEqualTo(Instant.parse("2026-10-12T14:59:59Z"));
        assertThat(balance(island.id)).as("고치기는 무료").isEqualTo(40);
        assertThat(ledgerRows(island.id)).isEqualTo(1);
        assertThat(newsRows(island.id)).as("고치기는 소식을 남기지 않는다").isEqualTo(1);
    }

    @Test
    @DisplayName("자정(00:00:00 KST)부터는 409 PROMOTION_LOCKED — 글·틀·스티커 모두, 07시 뒤(발행 뒤)에도 그대로다")
    void editingAfterMidnightIsLocked() throws Exception {
        Island island = island(100);
        String promotionId = promotionIdOf(promote(island.host, island.id, UUID.randomUUID()));
        String original = jdbc.queryForObject("select layout::text from island_promotions where id = ?::uuid",
                String.class, promotionId);

        for (String locked : List.of("2026-10-12T15:00:00Z", "2026-10-12T21:59:59Z", "2026-10-12T22:00:00Z",
                "2026-10-13T05:00:00Z")) {
            now.set(Instant.parse(locked));
            update(island.host, island.id, promotionId, content(BODY, layout(FRAME, List.of(), null)))
                    .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("PROMOTION_LOCKED"));
            update(island.host, island.id, promotionId, content("글만 바꾸기", original))
                    .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("PROMOTION_LOCKED"));
        }
        assertThat(jdbc.queryForObject("select body from island_promotions where id = ?::uuid", String.class,
                promotionId)).isEqualTo(BODY);
    }

    @Test
    @DisplayName("고치기 가드 — 다른 섬의 홍보·없는 홍보 404, 섬장 아님 403 NOT_OWNER, 게스트 403, 틀린 내용 400")
    void editingGuards() throws Exception {
        Island island = island(100);
        Island other = island(100);
        String promotionId = promotionIdOf(promote(island.host, island.id, UUID.randomUUID()));
        String otherPromotion = promotionIdOf(promote(other.host, other.id, UUID.randomUUID()));
        String fine = content("고친 글", layout(FRAME, List.of(), null));

        update(island.host, island.id, otherPromotion, fine).andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("PROMOTION_NOT_FOUND"));
        update(island.host, island.id, UUID.randomUUID().toString(), fine).andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("PROMOTION_NOT_FOUND"));
        update(island.member, island.id, promotionId, fine).andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("NOT_OWNER"));
        jdbc.update("update users set is_guest = true where id = ?", island.host);
        update(island.host, island.id, promotionId, fine).andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("SOCIAL_LOGIN_REQUIRED"));
        jdbc.update("update users set is_guest = false where id = ?", island.host);
        update(island.host, island.id, promotionId, content("가".repeat(61), layout(FRAME, List.of(), null)))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("PROMOTION_TEXT_TOO_LONG"));
        assertThat(jdbc.queryForObject("select body from island_promotions where id = ?::uuid", String.class,
                promotionId)).isEqualTo(BODY);
    }

    // ---------------------------------------------------------------- 쓰기 화면 불러오기

    @Test
    @DisplayName("불러오기 — 처음엔 next·latest 가 없고, 신청하면 next(고칠 수 있음), 자정 뒤엔 next(못 고침), 다음 날 07시 뒤엔 latest 다")
    void editorFollowsTheWindow() throws Exception {
        Island island = island(100);

        editor(island.host, island.id).andExpect(status().isOk())
                .andExpect(jsonPath("$.window.open").value(true))
                .andExpect(jsonPath("$.window.issueDate").value("2026-10-13"))
                .andExpect(jsonPath("$.window.opensAt").value("2026-10-11T22:00:00Z"))
                .andExpect(jsonPath("$.window.closesAt").value("2026-10-12T15:00:00Z"))
                .andExpect(jsonPath("$.next").value(nullValue()))
                .andExpect(jsonPath("$.latest").value(nullValue()))
                .andExpect(jsonPath("$.feeFish").value(60))
                .andExpect(jsonPath("$.balance").value(100))
                .andExpect(jsonPath("$.privateIsland").value(false));

        String promotionId = promotionIdOf(promote(island.host, island.id, UUID.randomUUID()));
        editor(island.host, island.id).andExpect(status().isOk())
                .andExpect(jsonPath("$.next.promotionId").value(promotionId))
                .andExpect(jsonPath("$.next.issueDate").value("2026-10-13"))
                .andExpect(jsonPath("$.next.body").value(BODY))
                .andExpect(jsonPath("$.next.layout.frameId").value(FRAME))
                .andExpect(jsonPath("$.next.layout.stickers[0].assetId").value(STICKER))
                .andExpect(jsonPath("$.next.layout.tape.assetId").value(TAPE))
                .andExpect(jsonPath("$.next.appliedAt").value("2026-10-12T05:00:00Z"))
                .andExpect(jsonPath("$.next.editable").value(true))
                .andExpect(jsonPath("$.balance").value(40));

        now.set(Instant.parse("2026-10-12T18:00:00Z")); // KST 10/13 03:00 — 창 닫힘, 10/13 호 발행 전
        editor(island.host, island.id).andExpect(status().isOk())
                .andExpect(jsonPath("$.window.open").value(false))
                .andExpect(jsonPath("$.window.issueDate").value("2026-10-14"))
                .andExpect(jsonPath("$.window.opensAt").value("2026-10-12T22:00:00Z"))
                .andExpect(jsonPath("$.next.promotionId").value(promotionId))
                .andExpect(jsonPath("$.next.editable").value(false))
                .andExpect(jsonPath("$.latest").value(nullValue()));

        now.set(Instant.parse("2026-10-12T22:30:00Z")); // KST 10/13 07:30 — 10/13 호는 발행됐다
        editor(island.host, island.id).andExpect(status().isOk())
                .andExpect(jsonPath("$.window.open").value(true))
                .andExpect(jsonPath("$.next").value(nullValue()))
                .andExpect(jsonPath("$.latest.promotionId").value(promotionId))
                .andExpect(jsonPath("$.latest.body").value(BODY))
                .andExpect(jsonPath("$.latest.layout.frameId").value(FRAME));

        // 운영이 내린 칸은 글을 비우고 꾸미기만 불러온다.
        jdbc.update("update island_promotions set moderation = 'REMOVED' where id = ?::uuid", promotionId);
        editor(island.host, island.id).andExpect(status().isOk())
                .andExpect(jsonPath("$.latest.body").value(""))
                .andExpect(jsonPath("$.latest.layout.frameId").value(FRAME));
    }

    @Test
    @DisplayName("불러오기 가드 — 일반 주민·비주민 403 NOT_OWNER, 게스트 섬장 403 SOCIAL_LOGIN_REQUIRED(꾸미기 전에), 비공개 섬은 표시만")
    void editorGuards() throws Exception {
        Island island = island(100);

        editor(island.member, island.id).andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("NOT_OWNER"));
        editor(island.visitor, island.id).andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("NOT_OWNER"));
        jdbc.update("update groups set is_private = true where id = ?", island.id);
        editor(island.host, island.id).andExpect(status().isOk())
                .andExpect(jsonPath("$.privateIsland").value(true));

        UUID guestHost = newGuest();
        UUID guestIsland = newIsland();
        join(guestHost, guestIsland, GroupMemberRole.OWNER);
        editor(guestHost, guestIsland).andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("SOCIAL_LOGIN_REQUIRED"));
    }

    // ---------------------------------------------------------------- 꾸미기 재료 목록

    @Test
    @DisplayName("재료 목록 — 시드 64종(틀 11 · 스티커 45 · 테이프 8)은 누구에게나 owned, 시즌은 보유 행이 있어야, 퇴역은 보유자에게만 남는다")
    void assetCatalog() throws Exception {
        UUID user = newUser();
        UUID guest = newGuest();
        String season = magazineAsset("ad_sticker", "friends", "season", false);
        String retired = magazineAsset("ad_tape", null, "free", true);
        String retiredOwned = magazineAsset("ad_frame", null, "season", true);
        grant(user, retiredOwned);

        Map<String, Object> mine = JSON.readValue(assets(user).andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8), Map.class);
        assertThat(seeded(mine, "frames")).hasSize(11).allSatisfy(item -> assertThat(item)
                .containsEntry("bundle", "free").containsEntry("owned", true).doesNotContainKey("tab"));
        assertThat(seeded(mine, "stickers")).hasSize(45).allSatisfy(item -> assertThat(item)
                .containsEntry("bundle", "free").containsEntry("owned", true).containsKey("tab"));
        assertThat(seeded(mine, "tapes")).hasSize(8);
        assertThat(seeded(mine, "frames").get(0)).containsEntry("assetId", FRAME);
        assertThat(seeded(mine, "stickers").get(0)).containsEntry("assetId", STICKER).containsEntry("tab", "cat");
        assertThat(item(mine, "stickers", season)).containsEntry("bundle", "season").containsEntry("owned", false)
                .containsEntry("tab", "friends");
        assertThat(item(mine, "tapes", retired)).as("보유 행 없는 퇴역 재료는 빠진다").isNull();
        assertThat(item(mine, "frames", retiredOwned)).as("보유한 퇴역 재료는 남는다").containsEntry("owned", true);

        grant(user, season);
        assets(user).andExpect(status().isOk());
        assertThat(item(JSON.readValue(assets(user).andReturn().getResponse()
                .getContentAsString(StandardCharsets.UTF_8), Map.class), "stickers", season))
                .containsEntry("owned", true);
        assets(guest).andExpect(status().isOk()).andExpect(jsonPath("$.frames.length()").isNumber());
    }

    // ---------------------------------------------------------------- 기능 스위치

    @Test
    @DisplayName("magazine.enabled 가 꺼져 있으면 신청·고치기는 503 MAGAZINE_NOT_READY 이고 아무것도 남지 않는다 — 읽기는 열려 있다")
    void featureSwitchClosesWrites() throws Exception {
        Island island = island(100);
        String promotionId = promotionIdOf(promote(island.host, island.id, UUID.randomUUID()));
        Object target = AopTestUtils.getUltimateTargetObject(promotionService);
        ReflectionTestUtils.setField(target, "enabled", false);
        try {
            Island fresh = island(100);
            promote(fresh.host, fresh.id, UUID.randomUUID()).andExpect(status().isServiceUnavailable())
                    .andExpect(jsonPath("$.code").value("MAGAZINE_NOT_READY"));
            update(island.host, island.id, promotionId, content("고친 글", layout(FRAME, List.of(), null)))
                    .andExpect(status().isServiceUnavailable())
                    .andExpect(jsonPath("$.code").value("MAGAZINE_NOT_READY"));
            assertNothingWritten(fresh, 100);
            editor(island.host, island.id).andExpect(status().isOk());
            assets(island.host).andExpect(status().isOk());
        } finally {
            ReflectionTestUtils.setField(target, "enabled", true);
        }
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

    /** 기본 칸 — 틀·스티커 하나·테이프. */
    private ResultActions promote(UUID actor, UUID islandId, UUID key) throws Exception {
        return promote(actor, islandId, key, content(BODY, layout(FRAME, List.of(STICKER), TAPE)));
    }

    private ResultActions promote(UUID actor, UUID islandId, UUID key, String json) throws Exception {
        return mvc.perform(post("/internal/users/" + actor + "/islands/" + islandId + "/promotions")
                .header("Authorization", "Bearer " + TOKEN).header("X-User-Id", actor)
                .header("Idempotency-Key", key).contentType("application/json").content(json));
    }

    private ResultActions update(UUID actor, UUID islandId, String promotionId, String json) throws Exception {
        return mvc.perform(put("/internal/users/" + actor + "/islands/" + islandId + "/promotions/" + promotionId)
                .header("Authorization", "Bearer " + TOKEN).header("X-User-Id", actor)
                .contentType("application/json").content(json));
    }

    private ResultActions editor(UUID actor, UUID islandId) throws Exception {
        return mvc.perform(get("/internal/users/" + actor + "/islands/" + islandId + "/promotions/editor")
                .header("Authorization", "Bearer " + TOKEN).header("X-User-Id", actor));
    }

    private ResultActions assets(UUID actor) throws Exception {
        return mvc.perform(get("/internal/users/" + actor + "/magazine/assets")
                .header("Authorization", "Bearer " + TOKEN).header("X-User-Id", actor));
    }

    private static String promotionIdOf(ResultActions created) throws Exception {
        return JSON.readTree(created.andExpect(status().isCreated()).andReturn().getResponse()
                .getContentAsString(StandardCharsets.UTF_8)).get("promotionId").asText();
    }

    /** 요청 본문 {@code {body, layout}} — 배치는 이미 만든 JSON 문자열이다. */
    private static String content(String body, String layoutJson) throws JsonProcessingException {
        return "{\"body\":" + JSON.writeValueAsString(body) + ",\"layout\":" + layoutJson + "}";
    }

    /** 배치 JSON — 스티커는 칸 안 여기저기에, 테이프는 위 테두리에 붙인다. */
    private static String layout(String frameId, List<String> stickerIds, String tapeId)
            throws JsonProcessingException {
        Map<String, Object> layout = new LinkedHashMap<>();
        layout.put("v", 1);
        layout.put("frameId", frameId);
        List<Map<String, Object>> stickers = new ArrayList<>();
        for (int i = 0; i < stickerIds.size(); i++) {
            Map<String, Object> sticker = new LinkedHashMap<>();
            sticker.put("assetId", stickerIds.get(i));
            sticker.put("x", 0.1 + 0.08 * i);
            sticker.put("y", 0.5);
            sticker.put("scale", 0.2);
            sticker.put("rotation", -12.0 + i);
            stickers.add(sticker);
        }
        layout.put("stickers", stickers);
        if (tapeId != null) {
            Map<String, Object> tape = new LinkedHashMap<>();
            tape.put("assetId", tapeId);
            tape.put("x", 0.5);
            tape.put("y", 0.0);
            tape.put("rotation", -4.0);
            layout.put("tape", tape);
        } else {
            layout.put("tape", null);
        }
        return JSON.writeValueAsString(layout);
    }

    private void expectRejected(Island island, String json, int status, String code) throws Exception {
        promote(island.host, island.id, UUID.randomUUID(), json).andExpect(status().is(status))
                .andExpect(jsonPath("$.code").value(code));
    }

    /** 거절된 신청의 무흔적 — 잔액·원장·칸·소식·사건·receipt. */
    private void assertNothingWritten(Island island, int balance) {
        assertThat(balance(island.id)).isEqualTo(balance);
        assertThat(ledgerRows(island.id)).isZero();
        assertThat(promotionRows(island.id)).isZero();
        assertThat(newsRows(island.id)).isZero();
        assertThat(events("wallet.updated", island.id)).isZero();
        assertThat(count("select count(*) from command_idempotency where user_id = ?", island.host)).isZero();
    }

    /** 이 테스트만의 잡지 재료 — 카탈로그 행과 부가 정보를 함께 넣는다. 시드와 섞이지 않게 {@code mag.test-} 로 시작한다. */
    private String magazineAsset(String kind, String tab, String bundle, boolean retired) {
        String productId = "mag.test-" + UUID.randomUUID().toString().substring(0, 8);
        jdbc.update("insert into catalog_assets (product_id, title, kind, owner_type) values (?, ?, ?, 'user')",
                productId, productId, kind);
        jdbc.update("insert into magazine_asset_meta (product_id, kind, bundle, drawer_tab, sort_order, retired_at) "
                + "values (?, ?, ?, ?, 1000, " + (retired ? "now()" : "null") + ")", productId, kind, bundle, tab);
        return productId;
    }

    private void grant(UUID userId, String productId) {
        jdbc.update("insert into owned_products (id, owner_type, user_id, product_id) values (?, 'user', ?, ?)",
                UUID.randomUUID(), userId, productId);
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> seeded(Map<String, Object> assets, String group) {
        return ((List<Map<String, Object>>) assets.get(group)).stream()
                .filter(item -> !((String) item.get("assetId")).startsWith("mag.test-"))
                .toList();
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> item(Map<String, Object> assets, String group, String assetId) {
        return ((List<Map<String, Object>>) assets.get(group)).stream()
                .filter(item -> assetId.equals(item.get("assetId")))
                .findFirst().orElse(null);
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

    private long promotionRows(UUID islandId) {
        return count("select count(*) from island_promotions where island_id = ?", islandId);
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
