package com.oneorthree.phone.internal;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.oneorthree.phone.common.util.ZonePolicy;
import com.oneorthree.phone.focus.repository.FocusSessionDetailRepository;
import com.oneorthree.phone.focus.repository.FocusSessionIntervalRepository;
import com.oneorthree.phone.focus.repository.FocusSessionRepository;
import com.oneorthree.phone.focus.repository.domain.FocusIntervalKind;
import com.oneorthree.phone.focus.repository.domain.FocusSession;
import com.oneorthree.phone.focus.repository.domain.FocusSessionDetail;
import com.oneorthree.phone.focus.repository.domain.FocusSessionInterval;
import com.oneorthree.phone.focus.repository.domain.FocusSessionLifecycle;
import com.oneorthree.phone.focus.repository.domain.FocusType;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.group.repository.domain.GroupMemberRole;
import com.oneorthree.phone.internal.dto.MagazineViews;
import com.oneorthree.phone.internal.service.IslandFocusAverageReader;
import com.oneorthree.phone.internal.service.IslandFocusAverageSnapshotService;
import com.oneorthree.phone.internal.service.MagazineIssueService;
import com.oneorthree.phone.internal.service.MagazinePublishService;
import com.oneorthree.phone.magazine.repository.IslandPromotionRepository;
import com.oneorthree.phone.magazine.repository.domain.IslandPromotion;
import com.oneorthree.phone.magazine.repository.domain.MagazineIssue;
import com.oneorthree.phone.magazine.support.IslandCard;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import com.oneorthree.phone.ranking.service.IslandWeeklyFocusService;
import com.oneorthree.phone.ranking.support.RankingWeek;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.domain.User;
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
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.util.AopTestUtils;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.nullValue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 고양이 잡지 07시 발행과 읽기·받음 상태 (GROMO-2289)를 <b>실제 Flyway PostgreSQL</b> 위에서 본다 — 발행은 서비스를 직접
 * 부르고(크론은 ci 프로필에서 꺼져 있다), 읽기·받음은 생산 진입점(내부 표면)으로 부른다. 시계는 고정한다.
 *
 * <p>호는 DB 전체에 한 줄로 쌓이므로 테스트마다 잡지 표를 비우고, 주간 랭킹·7일 평균은 DB 의 모든 섬을 훑으므로 테스트마다
 * 2주씩 떨어진 다른 날(수요일)을 쓴다 — 앞선 테스트의 집중 기록이 뒤 테스트의 랭킹에 섞이지 않게.
 */
@SpringBootTest
@AutoConfigureMockMvc
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class MagazinePublishIntegrationTest {

    private static final String TOKEN = "test-magazine-business";
    private static final LocalDate FIRST_DATE = LocalDate.of(2034, 5, 10); // 수요일
    private static final AtomicInteger DATE_SEQ = new AtomicInteger();
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String LAYOUT = "{\"v\":1,\"frameId\":\"mag.frame-scallop\",\"stickers\":[],\"tape\":null}";

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
        registry.add("magazine.enabled", () -> true);
        registry.add("internal.api.enabled", () -> true);
        registry.add("internal.api.callers.business.token", () -> TOKEN);
        String[] allow = {"GET /internal/users/*/magazine/today", "GET /internal/users/*/magazine/issues",
            "GET /internal/users/*/magazine/issues/*", "PUT /internal/users/*/magazine/issues/*/receipt"};
        for (int i = 0; i < allow.length; i++) {
            String entry = allow[i];
            registry.add("internal.api.callers.business.allow[" + i + "]", () -> entry);
        }
    }

    @MockitoBean
    Clock clock;
    @Autowired
    IslandWeeklyFocusService weeklyFocus;
    @Autowired
    MagazinePublishService publisher;
    @Autowired
    IslandFocusAverageSnapshotService averages;
    @Autowired
    UserRepository users;
    @Autowired
    GroupRepository groups;
    @Autowired
    GroupMemberRepository members;
    @Autowired
    FocusSessionRepository sessions;
    @Autowired
    FocusSessionDetailRepository details;
    @Autowired
    FocusSessionIntervalRepository intervals;
    @Autowired
    JdbcTemplate jdbc;
    @Autowired
    MockMvc mvc;
    @Autowired
    IslandPromotionRepository promotions;
    @Autowired
    MagazineIssueService magazine;
    @MockitoSpyBean
    IslandFocusAverageReader averageReader;
    @Autowired
    PlatformTransactionManager transactionManager;

    private final AtomicReference<Instant> now = new AtomicReference<>();
    /** 이 테스트의 첫 호 날짜(KST). */
    private LocalDate date;

    @BeforeEach
    void setUp() {
        date = FIRST_DATE.plusWeeks(2L * DATE_SEQ.getAndIncrement());
        now.set(kst(date, 7, 0));
        when(clock.instant()).thenAnswer(invocation -> now.get());
        when(clock.getZone()).thenReturn(ZonePolicy.KST);
        when(clock.withZone(any())).thenAnswer(invocation -> Clock.fixed(now.get(), invocation.getArgument(0)));
        jdbc.execute("TRUNCATE island_promotion_reports, magazine_receipts, magazine_issues, "
                + "island_promotions, magazine_editorial_notes, telescope_pins");
    }

    // ---------------------------------------------------------------- 발행

    @Test
    @DisplayName("07시 발행 — 1호가 나오고, 신청한 칸은 신청 순으로 숫자가 고정되며, 비공개 섬 칸도 싣는다(10/16). 다시 돌려도 호는 하나다")
    void publishesOnceWithFrozenCells() {
        Island first = island("첫섬", false);
        Island second = island("둘째섬", false);
        Island hidden = island("숨은섬", true);
        Island closed = island("닫힌섬", false);
        jdbc.update("update groups set deleted_at = now() where id = ?", closed.id);
        resident(first.group);
        UUID late = promotion(first.id, date, kst(date.minusDays(1), 9, 0), "늦게 신청");
        UUID early = promotion(second.id, date, kst(date.minusDays(1), 8, 0), "먼저 신청");
        UUID visiblePrivate = promotion(hidden.id, date, kst(date.minusDays(1), 8, 30), "비공개");
        UUID skipped = promotion(closed.id, date, kst(date.minusDays(1), 8, 40), "닫힌 섬");
        promotion(first.id, date.plusDays(1), kst(date, 7, 30), "내일 호");

        MagazineIssue issue = publisher.publish(date).orElseThrow();

        assertThat(issue.getIssueNo()).isEqualTo(1);
        assertThat(issue.getIssueDate()).isEqualTo(date);
        assertThat(issue.getPublishedAt()).isEqualTo(kst(date, 7, 0));
        assertThat(issue.getPromotionCount()).as("비공개 섬 칸도 센다").isEqualTo(3);
        assertThat(issue.getEditorial().note().type()).isEqualTo("TIP");
        assertThat(issue.getEditorial().note().tipNo()).as("팁 번호 = 호수 % 14").isEqualTo(1);
        assertThat(snapshotOf(late).path("memberCount").asInt()).isEqualTo(2);
        assertThat(snapshotOf(late).path("name").asText()).isEqualTo("첫섬");
        assertThat(snapshotOf(late).path("maxMembers").asInt()).isEqualTo(10);
        assertThat(snapshotOf(late).path("buildingCount").asInt()).isZero();
        assertThat(snapshotOf(early).path("islandId").asText()).isEqualTo(second.id.toString());
        assertThat(snapshotOf(visiblePrivate).path("name").asText()).as("비공개 섬 칸도 싣는다").isEqualTo("숨은섬");
        assertThat(snapshotOf(skipped).isMissingNode()).as("발행 순간 닫힌 섬의 칸은 싣지 않는다").isTrue();
        assertThat(jdbc.queryForObject("select count(*) from island_promotions where snapshot is not null "
                + "and issue_date <> ?", Integer.class, date)).as("다른 호의 칸은 건드리지 않는다").isZero();
        assertThat(jdbc.queryForObject("select count(*) from island_focus_averages where snapshot_date = ? "
                + "and island_id = ?", Integer.class, date, first.id))
                .as("발행이 7일 평균 스냅샷을 먼저 부른다").isEqualTo(1);

        now.set(kst(date, 7, 10));
        assertThat(publisher.publish(date)).as("그날 두 번째 틱은 아무것도 하지 않는다").isEmpty();
        assertThat(averages.snapshot(date)).as("평균 배치가 나중에 돌아도 이미 적힌 값을 바꾸지 않는다").isZero();
        assertThat(jdbc.queryForObject("select count(*) from magazine_issues", Integer.class)).isEqualTo(1);

        now.set(kst(date.plusDays(1), 7, 0));
        assertThat(publisher.publish(date.plusDays(1)).orElseThrow().getIssueNo()).isEqualTo(2);
    }

    @Test
    @DisplayName("편집부 칸 — 주간 랭킹 1~3위는 비공개 섬도 넣어 매기고, 어제(KST) 새로 생긴 공개 섬을 먼저 만든 순으로, 운영 소식이 있으면 그 문구다")
    void editorialPage() {
        Island top = island("일등섬", true);
        Island second = island("이등섬", false);
        Island third = island("삼등섬", false);
        Island fourth = island("사등섬", false);
        Island fifth = island("오등섬", false);
        focus(top, 300);
        focus(second, 200);
        focus(third, 150);
        focus(fourth, 100);
        focus(fifth, 50);
        Island newer = island("어제늦게", false);
        Island older = island("어제일찍", false);
        Island newPrivate = island("어제비공개", true);
        Island today = island("오늘섬", false);
        created(older, kst(date.minusDays(1), 0, 0));
        created(newer, kst(date.minusDays(1), 23, 59));
        created(newPrivate, kst(date.minusDays(1), 12, 0));
        created(today, kst(date, 0, 0));
        jdbc.update("insert into magazine_editorial_notes (issue_date, body) values (?, ?)", date, "오늘은 쉬어 가요");

        MagazineIssue issue = publisher.publish(date).orElseThrow();

        assertThat(issue.getEditorial().ranking()).extracting(row -> row.rank() + ":" + row.island().name())
                .containsExactly("1:일등섬", "2:이등섬", "3:삼등섬");
        assertThat(issue.getEditorial().newIslands()).extracting(card -> card.name())
                .containsExactly("어제일찍", "어제늦게");
        assertThat(issue.getEditorial().note().type()).isEqualTo("EDITOR");
        assertThat(issue.getEditorial().note().body()).isEqualTo("오늘은 쉬어 가요");
    }

    @Test
    @DisplayName("편집부 랭킹·새 섬 항목도 읽는 시점의 privateIsland 를 싣는다 — 비공개 일등섬 true, 공개 섬 false")
    void editorialItemsCarryPrivateIsland() throws Exception {
        User reader = user();
        Island top = island("일등섬", true);
        Island second = island("이등섬", false);
        focus(top, 300);
        focus(second, 200);
        Island fresh = island("어제섬", false);
        created(fresh, kst(date.minusDays(1), 12, 0));
        UUID issueId = publisher.publish(date).orElseThrow().getId();
        now.set(kst(date, 9, 0));

        issue(reader.getId(), issueId, "").andExpect(status().isOk())
                .andExpect(jsonPath("$.editorial.ranking[0].name").value("일등섬"))
                .andExpect(jsonPath("$.editorial.ranking[0].privateIsland").value(true))
                .andExpect(jsonPath("$.editorial.ranking[1].privateIsland").value(false))
                .andExpect(jsonPath("$.editorial.newIslands[0].privateIsland").value(false));

        jdbc.update("update groups set is_private = true where id = ?", fresh.id);
        issue(reader.getId(), issueId, "").andExpect(jsonPath("$.editorial.newIslands[0].privateIsland").value(true));
    }

    @Test
    @DisplayName("8호째 발행이 최근 7호 밖이 된 1호의 받음 상태를 지운다 — 호 행은 남고, 1호는 더 읽을 수 없다")
    void keepsReceiptsOfTheLatestSevenIssues() throws Exception {
        User reader = user();
        UUID firstIssue = publisher.publish(date).orElseThrow().getId();
        receipt(reader.getId(), firstIssue, "{\"place\":\"ISLAND\",\"opened\":true}").andExpect(status().isOk());
        for (int day = 1; day < 7; day++) {
            now.set(kst(date.plusDays(day), 7, 0));
            publisher.publish(date.plusDays(day)).orElseThrow();
        }
        shelf(reader.getId()).andExpect(status().isOk()).andExpect(jsonPath("$.items.length()").value(7))
                .andExpect(jsonPath("$.items[6].issueNo").value(1))
                .andExpect(jsonPath("$.items[6].opened").value(true))
                .andExpect(jsonPath("$.items[0].issueNo").value(7))
                .andExpect(jsonPath("$.items[0].opened").value(false));
        assertThat(receiptRows(firstIssue)).isEqualTo(1);

        now.set(kst(date.plusDays(7), 7, 0));
        publisher.publish(date.plusDays(7)).orElseThrow();

        assertThat(receiptRows(firstIssue)).as("7호 밖의 받음 상태").isZero();
        receipt(reader.getId(), firstIssue, "{\"place\":\"ISLAND\",\"opened\":true}").andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("MAGAZINE_ISSUE_NOT_FOUND"));
        assertThat(receiptRows(firstIssue)).as("7호 밖이 된 호에는 받음 행을 다시 만들지 않는다").isZero();
        assertThat(jdbc.queryForObject("select count(*) from magazine_issues", Integer.class)).isEqualTo(8);
        issue(reader.getId(), firstIssue, "").andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("MAGAZINE_ISSUE_NOT_FOUND"));
        shelf(reader.getId()).andExpect(jsonPath("$.items.length()").value(7))
                .andExpect(jsonPath("$.items[0].issueNo").value(8));
    }

    @Test
    @DisplayName("8호 발행이 스냅샷을 잡은 뒤 1호 받음이 커밋돼도, 발행 뒤 정리가 그 행까지 지운다 — 7호 밖 행이 남지 않는다")
    void receiptCommittedDuringPublishingIsStillForgotten() throws Exception {
        User reader = user();
        UUID firstIssue = publisher.publish(date).orElseThrow().getId();
        for (int day = 1; day < 7; day++) {
            now.set(kst(date.plusDays(day), 7, 0));
            publisher.publish(date.plusDays(day)).orElseThrow();
        }
        Island island = island("여덟째섬", false);
        promotion(island.id, date.plusDays(7), kst(date.plusDays(6), 8, 0), "8호 홍보");
        ExecutorService other = Executors.newSingleThreadExecutor();
        AtomicReference<Integer> inserted = new AtomicReference<>();
        // 발행 트랜잭션 안(첫 조회 뒤 — REPEATABLE READ 스냅샷이 잡힌 뒤)에서, 다른 스레드가 아직 최근 7호인 1호의 받음을 커밋한다.
        doAnswer(invocation -> {
            await(other.submit(() -> magazine.receive(reader.getId(), firstIssue,
                    new MagazineViews.ReceiptRequest(MagazineViews.Place.ISLAND, null, true))));
            // 이 스레드의 조회는 발행 트랜잭션의 스냅샷이라 그 행이 안 보인다 — 다른 스레드에서 센다.
            inserted.set(other.submit(() -> receiptRows(firstIssue)).get(30, TimeUnit.SECONDS));
            return invocation.callRealMethod();
        }).when(averageReader).latest(any());
        try {
            now.set(kst(date.plusDays(7), 7, 0));
            publisher.publish(date.plusDays(7)).orElseThrow();
        } finally {
            other.shutdownNow();
            reset(averageReader);
        }

        assertThat(inserted.get()).as("발행 도중 받음은 커밋됐다(그때는 1호가 아직 최근 7호)").isEqualTo(1);
        assertThat(receiptRows(firstIssue)).as("발행 뒤 정리가 그 행까지 지운다").isZero();
    }

    @Test
    @DisplayName("magazine.enabled 가 꺼져 있으면 발행하지 않는다")
    void switchedOffDoesNotPublish() {
        Object target = AopTestUtils.getUltimateTargetObject(publisher);
        ReflectionTestUtils.setField(target, "enabled", false);
        try {
            assertThat(publisher.publish(date)).isEmpty();
            assertThat(jdbc.queryForObject("select count(*) from magazine_issues", Integer.class)).isZero();
        } finally {
            ReflectionTestUtils.setField(target, "enabled", true);
        }
    }

    // ---------------------------------------------------------------- 읽기

    @Test
    @DisplayName("호 읽기 — 숫자는 발행 때 값 그대로, 숨긴 칸만 빠지고(발행 뒤 비공개가 된 섬의 칸은 보이며 privateIsland=true), 관계는 읽는 순간 MEMBER/KICKED/NONE, 편집부 칸은 첫 페이지에만")
    void readingAnIssue() throws Exception {
        User reader = user();
        Island mine = island("우리섬", false);
        Island kickedFrom = island("쫓겨난섬", false);
        Island other = island("남의섬", false);
        Island goesPrivate = island("숨을섬", false);
        Island reported = island("신고섬", false);
        Island ended = island("끝난섬", false);
        join(reader, mine.group);
        GroupMember kicked = join(reader, kickedFrom.group);
        kicked.kick(kst(date.minusDays(2), 9, 0));
        members.save(kicked);
        promotion(mine.id, date, kst(date.minusDays(1), 8, 0), "우리 섬 홍보");
        promotion(goesPrivate.id, date, kst(date.minusDays(1), 8, 10), "곧 비공개");
        promotion(kickedFrom.id, date, kst(date.minusDays(1), 8, 20), "쫓겨난 섬 홍보");
        UUID hiddenCell = promotion(reported.id, date, kst(date.minusDays(1), 8, 30), "신고된 홍보");
        promotion(other.id, date, kst(date.minusDays(1), 8, 40), "남의 섬 홍보");
        promotion(ended.id, date, kst(date.minusDays(1), 8, 50), "곧 끝날 섬");
        UUID issueId = publisher.publish(date).orElseThrow().getId();
        // 발행 뒤의 변화 — 주민이 늘고, 한 섬은 비공개가 되고, 한 칸은 신고로 숨겨진다.
        resident(mine.group);
        jdbc.update("update groups set is_private = true where id = ?", goesPrivate.id);
        jdbc.update("update groups set status = 'ENDED' where id = ?", ended.id);
        jdbc.update("update island_promotions set moderation = 'HIDDEN' where id = ?", hiddenCell);

        now.set(kst(date, 9, 0));
        String first = issue(reader.getId(), issueId, "?limit=2").andExpect(status().isOk())
                .andExpect(jsonPath("$.issue.issueNo").value(1))
                .andExpect(jsonPath("$.issue.issueDate").value(date.toString()))
                .andExpect(jsonPath("$.issue.current").value(true))
                .andExpect(jsonPath("$.editorial.note.type").value("TIP"))
                .andExpect(jsonPath("$.cells.length()").value(2))
                .andExpect(jsonPath("$.cells[0].name").value("우리섬"))
                .andExpect(jsonPath("$.cells[0].memberCount").value(2))
                .andExpect(jsonPath("$.cells[0].privateIsland").value(false))
                .andExpect(jsonPath("$.cells[0].relation").value("MEMBER"))
                .andExpect(jsonPath("$.cells[0].body").value("우리 섬 홍보"))
                .andExpect(jsonPath("$.cells[0].layout.frameId").value("mag.frame-scallop"))
                .andExpect(jsonPath("$.cells[1].name").value("숨을섬"))
                .andExpect(jsonPath("$.cells[1].privateIsland").value(true))
                .andExpect(jsonPath("$.nextAppliedAt").isString())
                .andExpect(jsonPath("$.nextPromotionId").isString())
                .andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);
        JsonNode page = JSON.readTree(first);

        issue(reader.getId(), issueId, "?limit=2&afterAppliedAt=" + page.get("nextAppliedAt").asText()
                + "&afterPromotionId=" + page.get("nextPromotionId").asText()).andExpect(status().isOk())
                .andExpect(jsonPath("$.editorial").value(nullValue()))
                .andExpect(jsonPath("$.cells.length()").value(2))
                .andExpect(jsonPath("$.cells[0].name").value("쫓겨난섬"))
                .andExpect(jsonPath("$.cells[0].relation").value("KICKED"))
                .andExpect(jsonPath("$.cells[1].name").value("남의섬"))
                .andExpect(jsonPath("$.cells[1].relation").value("NONE"))
                .andExpect(jsonPath("$.nextAppliedAt").value(nullValue()))
                .andExpect(jsonPath("$.nextPromotionId").value(nullValue()));

        // 다음 날 07:00 이 지나면 다음 호가 늦어져도 현재 호가 아니다(동그라미 없음).
        now.set(kst(date.plusDays(1), 7, 0));
        issue(reader.getId(), issueId, "").andExpect(jsonPath("$.issue.current").value(false))
                .andExpect(jsonPath("$.cells.length()").value(4));
        issue(reader.getId(), issueId, "?limit=0").andExpect(status().isBadRequest());
        issue(reader.getId(), UUID.randomUUID(), "").andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("MAGAZINE_ISSUE_NOT_FOUND"));
    }

    @Test
    @DisplayName("오늘 호와 받음 상태 — 호가 없으면 둘 다 null, 받은 곳·시각은 처음 값으로 고정, 나중에·읽음은 처음 한 번만 적힌다")
    void todayAndReceipt() throws Exception {
        User reader = user();
        today(reader.getId()).andExpect(status().isOk())
                .andExpect(jsonPath("$.issue").value(nullValue()))
                .andExpect(jsonPath("$.receipt").value(nullValue()));

        UUID issueId = publisher.publish(date).orElseThrow().getId();
        today(reader.getId()).andExpect(jsonPath("$.issue.issueId").value(issueId.toString()))
                .andExpect(jsonPath("$.issue.current").value(true))
                .andExpect(jsonPath("$.receipt").value(nullValue()));

        now.set(kst(date, 8, 0));
        receipt(reader.getId(), issueId, "{\"place\":\"ISLAND\",\"deferred\":true}").andExpect(status().isOk())
                .andExpect(jsonPath("$.place").value("ISLAND"))
                .andExpect(jsonPath("$.receivedAt").value(kst(date, 8, 0).toString()))
                .andExpect(jsonPath("$.deferredAt").value(kst(date, 8, 0).toString()))
                .andExpect(jsonPath("$.openedAt").value(nullValue()));
        now.set(kst(date, 9, 0));
        receipt(reader.getId(), issueId, "{\"place\":\"SEA\",\"opened\":true,\"deferred\":true}")
                .andExpect(jsonPath("$.place").value("ISLAND"))
                .andExpect(jsonPath("$.receivedAt").value(kst(date, 8, 0).toString()))
                .andExpect(jsonPath("$.deferredAt").value(kst(date, 8, 0).toString()))
                .andExpect(jsonPath("$.openedAt").value(kst(date, 9, 0).toString()));
        now.set(kst(date, 10, 0));
        receipt(reader.getId(), issueId, "{\"place\":\"ISLAND\",\"opened\":false}")
                .andExpect(jsonPath("$.openedAt").value(kst(date, 9, 0).toString()));
        today(reader.getId()).andExpect(jsonPath("$.receipt.place").value("ISLAND"))
                .andExpect(jsonPath("$.receipt.openedAt").value(kst(date, 9, 0).toString()));
        assertThat(receiptRows(issueId)).isEqualTo(1);

        receipt(reader.getId(), issueId, "{\"place\":\"MOON\"}").andExpect(status().isBadRequest());
        receipt(reader.getId(), issueId, "{\"opened\":true}").andExpect(status().isBadRequest());
        receipt(reader.getId(), UUID.randomUUID(), "{\"place\":\"SEA\"}").andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("MAGAZINE_ISSUE_NOT_FOUND"));

        // 탈퇴한 계정은 받음 상태를 새로 만들 수 없다 — 사용자 행 공유 잠금 아래에서 활성 여부를 본다.
        User withdrawn = user();
        jdbc.update("update users set is_deleted = true where id = ?", withdrawn.getId());
        receipt(withdrawn.getId(), issueId, "{\"place\":\"ISLAND\"}").andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("USER_NOT_FOUND"));
        assertThat(jdbc.queryForObject("select count(*) from magazine_receipts where user_id = ?", Integer.class,
                withdrawn.getId())).isZero();
    }

    @Test
    @DisplayName("발행이 칸을 읽은 뒤 신고 숨김이 커밋돼도 발행의 UPDATE 는 숫자(snapshot)만 써서 숨김을 되돌리지 않는다")
    void publishingDoesNotOverwriteAConcurrentHide() throws Exception {
        Island island = island("겹친섬", false);
        UUID promotionId = promotion(island.id, date, kst(date.minusDays(1), 8, 0), "겹친 홍보");
        ExecutorService other = Executors.newSingleThreadExecutor();
        try {
            new TransactionTemplate(transactionManager).executeWithoutResult(status -> {
                IslandPromotion loaded = promotions.findById(promotionId).orElseThrow();
                // 다른 트랜잭션(다른 스레드의 자동 커밋)이 그사이 숨긴다.
                await(other.submit(() -> jdbc.update(
                        "update island_promotions set moderation = 'HIDDEN' where id = ?", promotionId)));
                loaded.publish(new IslandCard(island.id, "겹친섬", 0, 1, 10, null));
            });
        } finally {
            other.shutdownNow();
        }

        assertThat(jdbc.queryForObject("select moderation from island_promotions where id = ?", String.class,
                promotionId)).isEqualTo("HIDDEN");
        assertThat(snapshotOf(promotionId).path("name").asText()).isEqualTo("겹친섬");
    }

    // ---------------------------------------------------------------- 도구

    private record Island(UUID id, Group group, User owner) {
    }

    /** 방장 한 명짜리 섬(정원 10). */
    private Island island(String name, boolean isPrivate) {
        User owner = user();
        Group group = groups.save(Group.builder().name(name).maxMembers(10).isPrivate(isPrivate).build());
        members.save(GroupMember.builder().user(owner).group(group).role(GroupMemberRole.OWNER).build());
        return new Island(group.getId(), group, owner);
    }

    private User user() {
        return users.save(User.builder().nickname("잡지-" + UUID.randomUUID()).build());
    }

    private void resident(Group group) {
        join(user(), group);
    }

    private GroupMember join(User user, Group group) {
        return members.save(GroupMember.builder().user(user).group(group).role(GroupMemberRole.MEMBER).build());
    }

    private void created(Island island, Instant at) {
        jdbc.update("update groups set created_at = ? where id = ?", Timestamp.from(at), island.id);
    }

    /** 이번 주(발행 순간이 속한 UTC 일요일 주)에 끝난 집중 — 섬 방장 한 명의 순수 집중 {@code minutes} 분. */
    private void focus(Island island, int minutes) {
        Instant start = kst(date.minusDays(1), 10, 0);
        UUID session = sessions.save(FocusSession.builder().user(island.owner).focusType(FocusType.INFINITE)
                .startedAt(start).build()).getId();
        details.save(FocusSessionDetail.builder().sessionId(session).userId(island.owner.getId())
                .islandId(island.id).membershipEpochAtStart(1L).subject("공부").targetMinutes(30)
                .lifecycle(FocusSessionLifecycle.COMPLETED).lastTransitionAt(start).build());
        intervals.save(FocusSessionInterval.builder().sessionId(session).ordinal(1).kind(FocusIntervalKind.ACTIVE)
                .startedAt(start).endedAt(start.plusSeconds(minutes * 60L)).build());
        // 완료 전이를 거치지 않고 심은 세션이라 랭킹 분자 read model(GROMO-2343)을 정본으로 다시 채운다.
        weeklyFocus.recompute(RankingWeek.weekStart(start));
    }

    private UUID promotion(UUID islandId, LocalDate issueDate, Instant appliedAt, String body) {
        UUID id = UUID.randomUUID();
        UUID applicant = jdbc.queryForObject("select user_id from group_members where group_id = ? "
                + "and role = 'OWNER' limit 1", UUID.class, islandId);
        jdbc.update("insert into island_promotions (id, island_id, issue_date, applied_by, applied_at, updated_at, "
                + "body, layout) values (?, ?, ?, ?, ?, ?, ?, ?::jsonb)", id, islandId, issueDate, applicant,
                Timestamp.from(appliedAt), Timestamp.from(appliedAt), body, LAYOUT);
        return id;
    }

    private JsonNode snapshotOf(UUID promotionId) {
        String json = jdbc.queryForObject("select snapshot::text from island_promotions where id = ?", String.class,
                promotionId);
        return Optional.ofNullable(json).map(this::tree).orElse(JSON.missingNode());
    }

    private JsonNode tree(String json) {
        try {
            return JSON.readTree(json);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private int receiptRows(UUID issueId) {
        return jdbc.queryForObject("select count(*) from magazine_receipts where issue_id = ?", Integer.class,
                issueId);
    }

    private static void await(Future<?> future) {
        try {
            future.get(30, TimeUnit.SECONDS);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private static Instant kst(LocalDate day, int hour, int minute) {
        return day.atTime(hour, minute).atZone(ZonePolicy.KST).toInstant();
    }

    private ResultActions today(UUID actor) throws Exception {
        return mvc.perform(get("/internal/users/" + actor + "/magazine/today").header("Authorization", "Bearer " + TOKEN)
                .header("X-User-Id", actor));
    }

    private ResultActions shelf(UUID actor) throws Exception {
        return mvc.perform(get("/internal/users/" + actor + "/magazine/issues").header("Authorization", "Bearer " + TOKEN)
                .header("X-User-Id", actor));
    }

    private ResultActions issue(UUID actor, UUID issueId, String query) throws Exception {
        return mvc.perform(get("/internal/users/" + actor + "/magazine/issues/" + issueId + query)
                .header("Authorization", "Bearer " + TOKEN).header("X-User-Id", actor));
    }

    private ResultActions receipt(UUID actor, UUID issueId, String body) throws Exception {
        return mvc.perform(put("/internal/users/" + actor + "/magazine/issues/" + issueId + "/receipt")
                .header("Authorization", "Bearer " + TOKEN).header("X-User-Id", actor)
                .contentType("application/json").content(body));
    }
}
