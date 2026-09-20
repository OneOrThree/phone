package com.oneorthree.phone.internal;

import com.oneorthree.phone.auth.service.AuthService;
import com.oneorthree.phone.auth.support.JwtProvider;
import com.oneorthree.phone.construction.exception.ConstructionErrorCode;
import com.oneorthree.phone.construction.repository.IslandFacilityRepository;
import com.oneorthree.phone.construction.repository.domain.FacilityStatus;
import com.oneorthree.phone.construction.repository.domain.IslandFacility;
import com.oneorthree.phone.construction.service.IslandWalletService;
import com.oneorthree.phone.focus.repository.FocusSessionDetailRepository;
import com.oneorthree.phone.focus.repository.FocusSessionRepository;
import com.oneorthree.phone.focus.repository.domain.FocusSession;
import com.oneorthree.phone.focus.repository.domain.FocusSessionDetail;
import com.oneorthree.phone.focus.repository.domain.FocusSessionLifecycle;
import com.oneorthree.phone.focus.repository.domain.FocusRewardAccrual;
import com.oneorthree.phone.focus.repository.domain.FocusSettlement;
import com.oneorthree.phone.focus.repository.domain.FocusType;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.group.repository.domain.GroupMemberRole;
import com.oneorthree.phone.group.repository.domain.GroupStatus;
import com.oneorthree.phone.internal.dto.IslandFishEarningsView;
import com.oneorthree.phone.internal.dto.IslandLedgerPageView;
import com.oneorthree.phone.internal.dto.MyJoinRequestsPageView;
import com.oneorthree.phone.internal.service.IslandEconomyReadService;
import com.oneorthree.phone.internal.service.IslandJoinService;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import com.oneorthree.phone.user.repository.UserQueryService;
import com.oneorthree.phone.user.repository.domain.User;
import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.time.YearMonth;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.tuple;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 화면 조각의 빠진 재료 3종 (GROMO-1895) — 내 가입 대기 목록·섬 공동 가계부·주민별 누적 획득 물고기를
 * <b>실제 Flyway PostgreSQL</b> 위에서 생산 진입점으로 검증한다.
 *
 * <p>권한 행렬(방장·주민·구경꾼), keyset 페이지의 동률 경계, 합계의 정확성, KST 월 경계, 도서관 게이트를 본다.
 * 시드는 생산 서비스(가입·섬 지갑 적립/차감)와 운영 엔티티로 만든다. 정산은 지급 경로(GROMO-1924)가 아직
 * 닫혀 있어 그 경로가 쓰는 것과 같은 행(기본 마커 · 상세 · 정산)을 직접 심는다({@code IslandFocusMembersIntegrationTest} 선례).
 * 시각을 고정해야 하는 행(월 경계·동률)은 생산 경로로 만든 뒤 {@code created_at} 만 옮긴다.
 */
@SpringBootTest
@AutoConfigureMockMvc
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class IslandScreenFragmentsIntegrationTest {

    private static final String TOKEN = "test-island-fragments-business";

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
        registry.add("notification.dispatch.mode", () -> "OUTBOX");
        // 도서관 게이트를 실제로 판정하게 한다 — 기본 OFF 면 모든 섬이 통과해 게이트가 검증되지 않는다.
        registry.add("construction.facility-gates.enforce", () -> true);
        registry.add("internal.api.enabled", () -> true);
        registry.add("internal.api.callers.business.token", () -> TOKEN);
        String[] allow = {"GET /internal/users/*/join-requests", "GET /internal/islands/*/resources/ledger",
            "GET /internal/islands/*/statistics/fish-earnings"};
        for (int i = 0; i < allow.length; i++) {
            String entry = allow[i];
            registry.add("internal.api.callers.business.allow[" + i + "]", () -> entry);
        }
    }

    @Autowired
    IslandJoinService joins;
    @Autowired
    IslandEconomyReadService economy;
    @Autowired
    IslandWalletService wallets;
    @Autowired
    IslandFacilityRepository facilities;
    @Autowired
    FocusSessionRepository sessions;
    @Autowired
    FocusSessionDetailRepository details;
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
    EntityManager em;
    @Autowired
    PlatformTransactionManager transactionManager;
    @Autowired
    MockMvc mvc;

    // ---------------------------------------------------------------- 내 가입 대기 목록

    @Test
    @DisplayName("내 대기 목록 — 본인의 pending 만, (createdAt, id) 오름차순, 같은 시각 두 행도 페이지 경계에서 빠짐·중복이 없다")
    void myRequestsListsOnlyOwnPendingWithStableKeyset() {
        UUID applicant = newUser();
        UUID a = joins.join(applicant, island("가섬", true), null, UUID.randomUUID()).requestId();
        UUID b = joins.join(applicant, island("나섬", true), null, UUID.randomUUID()).requestId();
        UUID c = joins.join(applicant, island("다섬", true), null, UUID.randomUUID()).requestId();
        UUID cancelled = joins.join(applicant, island("라섬", true), null, UUID.randomUUID()).requestId();
        joins.cancel(applicant, cancelled, UUID.randomUUID());
        // 남의 pending 은 후보조차 아니다.
        joins.join(newUser(), island("마섬", true), null, UUID.randomUUID());

        // b·c 를 같은 시각으로 — 순서는 id 가 가른다.
        Instant tie = Instant.parse("2026-09-10T00:00:00Z");
        setRequestCreatedAt(a, tie.minusSeconds(60));
        setRequestCreatedAt(b, tie);
        setRequestCreatedAt(c, tie);
        List<UUID> tied = b.compareTo(c) < 0 ? List.of(b, c) : List.of(c, b);

        List<UUID> seen = new ArrayList<>();
        Instant afterAt = null;
        UUID afterId = null;
        do {
            MyJoinRequestsPageView page = joins.myRequests(applicant, afterAt, afterId, 1);
            assertThat(page.items()).hasSize(1);
            MyJoinRequestsPageView.Item item = page.items().get(0);
            assertThat(item.status()).isEqualTo("pending");
            seen.add(item.id());
            afterAt = page.nextCreatedAt();
            afterId = page.nextRequestId();
        } while (afterId != null && seen.size() < 10);

        assertThat(seen).containsExactly(a, tied.get(0), tied.get(1));
        MyJoinRequestsPageView all = joins.myRequests(applicant, null, null, 10);
        assertThat(all.nextRequestId()).isNull();
        assertThat(all.items()).extracting(MyJoinRequestsPageView.Item::islandName)
                .containsExactlyInAnyOrder("가섬", "나섬", "다섬");
    }

    @Test
    @DisplayName("내 대기 목록 HTTP — 경로 사용자 축으로 열리고, 경계 한쪽만 오면 400 INVALID_PAGE_REQUEST")
    void myRequestsOverHttp() throws Exception {
        UUID applicant = newUser();
        UUID islandId = island("신청섬", true);
        UUID request = joins.join(applicant, islandId, null, UUID.randomUUID()).requestId();

        mvc.perform(get("/internal/users/" + applicant + "/join-requests").param("limit", "20")
                        .header("Authorization", "Bearer " + TOKEN).header("X-User-Id", applicant))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].id").value(request.toString()))
                .andExpect(jsonPath("$.items[0].islandId").value(islandId.toString()))
                .andExpect(jsonPath("$.items[0].islandName").value("신청섬"))
                .andExpect(jsonPath("$.items[0].status").value("pending"))
                .andExpect(jsonPath("$.nextRequestId").doesNotExist());
        mvc.perform(get("/internal/users/" + applicant + "/join-requests").param("limit", "20")
                        .param("afterCreatedAt", "2026-09-10T00:00:00Z")
                        .header("Authorization", "Bearer " + TOKEN).header("X-User-Id", applicant))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_PAGE_REQUEST"));
    }

    // ---------------------------------------------------------------- 공동 가계부

    @Test
    @DisplayName("가계부 — KST 월 경계로 자르고, 기간 합계는 방향 필터·페이지와 무관한 그 달 전체 합이다")
    void ledgerSumsWholeKstMonthRegardlessOfFilterAndPage() {
        Resident r = residentIsland();
        // 9월 KST 의 첫 순간(= 8/31 15:00Z)은 9월, 그 1초 전은 8월이다.
        contribute(r.islandId(), r.member(), 10, Instant.parse("2026-08-31T15:00:00Z"));
        contribute(r.islandId(), r.host(), 20, Instant.parse("2026-09-05T03:00:00Z"));
        contribute(r.islandId(), r.member(), 30, Instant.parse("2026-09-20T03:00:00Z"));
        debit(r.islandId(), 15, Instant.parse("2026-09-21T03:00:00Z"));
        contribute(r.islandId(), r.member(), 99, Instant.parse("2026-08-31T14:59:59Z"));
        contribute(r.islandId(), r.member(), 77, Instant.parse("2026-09-30T15:00:00Z"));

        IslandLedgerPageView september = economy.ledger(r.member(), r.islandId(), YearMonth.of(2026, 9), null,
                null, null, 50);
        assertThat(september.month()).isEqualTo("2026-09");
        assertThat(september.earnedTotal()).isEqualTo(60);
        assertThat(september.spentTotal()).isEqualTo(15);
        assertThat(september.items()).extracting(IslandLedgerPageView.Entry::amount).containsExactly(15, 30, 20, 10);
        assertThat(september.items().get(0).direction()).isEqualTo("spend");
        assertThat(september.items().get(0).reason()).isEqualTo("construction_debit");
        assertThat(september.items().get(1).reason()).isEqualTo("contribution");
        assertThat(september.items()).as("KST 날짜가 모두 달라 하루 묶음이 한 건씩이다(GROMO-1990)")
                .extracting(IslandLedgerPageView.Entry::entryCount).containsExactly(1, 1, 1, 1);
        assertThat(september.items().get(0).groupedUntil())
                .as("묶이지 않은 줄의 groupedUntil 은 createdAt 과 같다")
                .isEqualTo(september.items().get(0).createdAt());

        IslandLedgerPageView earnOnly = economy.ledger(r.host(), r.islandId(), YearMonth.of(2026, 9), "earn",
                null, null, 1);
        assertThat(earnOnly.items()).extracting(IslandLedgerPageView.Entry::amount).containsExactly(30);
        assertThat(earnOnly.earnedTotal()).isEqualTo(60);
        assertThat(earnOnly.spentTotal()).isEqualTo(15);
        assertThat(economy.ledger(r.host(), r.islandId(), YearMonth.of(2026, 9), "spend", null, null, 50).items())
                .extracting(IslandLedgerPageView.Entry::amount).containsExactly(15);

        IslandLedgerPageView august = economy.ledger(r.host(), r.islandId(), YearMonth.of(2026, 8), null,
                null, null, 50);
        assertThat(august.earnedTotal()).isEqualTo(99);
        assertThat(august.items()).extracting(IslandLedgerPageView.Entry::amount).containsExactly(99);
    }

    @Test
    @DisplayName("가계부 — 같은 시각의 여러 행도 최신순 keyset 페이지에서 빠짐·중복 없이 한 번씩 나온다")
    void ledgerKeysetTieBreakNeverSkipsOrRepeats() {
        Resident r = residentIsland();
        Instant tie = Instant.parse("2026-09-10T03:00:00Z");
        // 묶이지 않는 사유(건설 차감)로 본다 — 집중 적립은 하루로 접혀 동률 자체가 생기지 않는다(GROMO-1990).
        contribute(r.islandId(), r.member(), 1000, Instant.parse("2026-09-01T03:00:00Z"));
        for (int amount = 1; amount <= 5; amount++) {
            debit(r.islandId(), amount, tie);
        }
        debit(r.islandId(), 100, tie.plusSeconds(1));

        List<Integer> seen = new ArrayList<>();
        Instant afterAt = null;
        UUID afterId = null;
        do {
            IslandLedgerPageView page = economy.ledger(r.member(), r.islandId(), YearMonth.of(2026, 9), "spend",
                    afterAt, afterId, 2);
            page.items().forEach(entry -> seen.add(entry.amount()));
            afterAt = page.nextCreatedAt();
            afterId = page.nextEntryId();
        } while (afterId != null && seen.size() < 20);

        assertThat(seen).hasSize(6).first().isEqualTo(100);
        assertThat(seen).containsExactlyInAnyOrder(100, 1, 2, 3, 4, 5);
        List<UUID> tiedIds = jdbc.queryForList("select id from island_wallet_transactions where island_id=?"
                + " and created_at=? order by id desc", UUID.class, r.islandId(), Timestamp.from(tie));
        List<Integer> tiedAmounts = tiedIds.stream().map(id -> jdbc.queryForObject(
                "select amount from island_wallet_transactions where id=?", Integer.class, id)).toList();
        assertThat(seen.subList(1, 6)).as("동률 구간은 id 내림차순").isEqualTo(tiedAmounts);
    }

    @Test
    @DisplayName("가계부 — 집중 적립은 KST 하루로 접혀 한 줄이고, 그 줄이 묶음 커서라 페이지가 빠짐·중복 없이 이어진다")
    void ledgerFoldsFocusContributionsIntoOneRowPerDay() {
        Resident r = residentIsland();
        // 분당 적립을 흉내 낸다 — 같은 KST 날짜의 60건(9/10 12:00~12:59 KST)과 이튿날 2건.
        for (int minute = 0; minute < 60; minute++) {
            contribute(r.islandId(), r.member(), 1, Instant.parse("2026-09-10T03:00:00Z").plusSeconds(minute * 60L));
        }
        contribute(r.islandId(), r.host(), 5, Instant.parse("2026-09-11T03:00:00Z"));
        contribute(r.islandId(), r.host(), 7, Instant.parse("2026-09-11T04:00:00Z"));
        debit(r.islandId(), 12, Instant.parse("2026-09-11T05:00:00Z"));

        IslandLedgerPageView page = economy.ledger(r.member(), r.islandId(), YearMonth.of(2026, 9), null,
                null, null, 50);

        assertThat(page.items()).as("원장 63행이 3줄로 접힌다 — 9/11 차감 · 9/11 적립 묶음 · 9/10 적립 묶음")
                .hasSize(3);
        assertThat(page.items()).extracting(IslandLedgerPageView.Entry::reason, IslandLedgerPageView.Entry::amount,
                        IslandLedgerPageView.Entry::entryCount)
                .containsExactly(tuple("construction_debit", 12, 1), tuple("contribution", 12, 2),
                        tuple("contribution", 60, 60));
        assertThat(page.items().get(2).createdAt()).as("묶음의 createdAt 은 그 날 «첫» 기입")
                .isEqualTo(Instant.parse("2026-09-10T03:00:00Z"));
        assertThat(page.items().get(2).groupedUntil()).as("groupedUntil 은 그 날 «마지막» 기입")
                .isEqualTo(Instant.parse("2026-09-10T03:59:00Z"));
        assertThat(page.earnedTotal()).as("합계는 접기와 무관하게 원장 전체 합이다").isEqualTo(72);
        assertThat(page.spentTotal()).isEqualTo(12);
        assertThat(jdbc.queryForObject("select count(*) from island_wallet_transactions where island_id=?",
                Long.class, r.islandId()))
                .as("원장은 건별 그대로 남는다 — 접는 것은 조회뿐이다").isEqualTo(63L);

        // 묶음을 커서로 이어 받아도 빠짐·중복이 없다.
        List<Integer> seen = new ArrayList<>();
        Instant afterAt = null;
        UUID afterId = null;
        do {
            IslandLedgerPageView one = economy.ledger(r.member(), r.islandId(), YearMonth.of(2026, 9), null,
                    afterAt, afterId, 1);
            one.items().forEach(entry -> seen.add(entry.amount()));
            afterAt = one.nextCreatedAt();
            afterId = one.nextEntryId();
        } while (afterId != null && seen.size() < 10);
        assertThat(seen).containsExactly(12, 12, 60);
    }

    @Test
    @DisplayName("가계부 권한 — 방장·주민은 열리고 구경꾼은 403 MEMBER_ONLY, 방향 값 밖은 422, 월 형식 오류는 400")
    void ledgerPermissionsAndInputErrors() throws Exception {
        Resident r = residentIsland();
        UUID visitor = newUser();
        contribute(r.islandId(), r.member(), 5, Instant.parse("2026-09-10T03:00:00Z"));

        for (UUID resident : List.of(r.host(), r.member())) {
            mvc.perform(get("/internal/islands/" + r.islandId() + "/resources/ledger")
                            .param("month", "2026-09").param("limit", "20")
                            .header("Authorization", "Bearer " + TOKEN).header("X-User-Id", resident))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.earnedTotal").value(5))
                    .andExpect(jsonPath("$.items[0].direction").value("earn"));
        }
        mvc.perform(get("/internal/islands/" + r.islandId() + "/resources/ledger")
                        .param("month", "2026-09").param("limit", "20")
                        .header("Authorization", "Bearer " + TOKEN).header("X-User-Id", visitor))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("MEMBER_ONLY"));
        mvc.perform(get("/internal/islands/" + r.islandId() + "/resources/ledger")
                        .param("month", "2026-13").param("limit", "20")
                        .header("Authorization", "Bearer " + TOKEN).header("X-User-Id", r.member()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_PARAMETER"));
        assertThatThrownBy(() -> economy.ledger(r.member(), r.islandId(), YearMonth.of(2026, 9), "refund",
                null, null, 20))
                .hasFieldOrPropertyWithValue("errorCode", ConstructionErrorCode.OUT_OF_RANGE);
        assertThatThrownBy(() -> economy.ledger(r.member(), r.islandId(), YearMonth.of(2026, 9), null,
                null, null, 101))
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.INVALID_PAGE_REQUEST);
    }

    // ---------------------------------------------------------------- 주민별 누적 획득

    @Test
    @DisplayName("물고기 장 — 도서관 미완공이면 403 LIBRARY_LOCKED, 완공 뒤 주민별 이 섬 정산 합(다른 섬 제외·무기록 0)")
    void fishEarningsSumsSettlementsPerResidentBehindLibraryGate() throws Exception {
        Resident r = residentIsland();
        UUID quiet = newUser();
        joinAs(quiet, r.islandId(), GroupMemberRole.MEMBER);
        UUID visitor = newUser();
        UUID otherIsland = island("옆섬", false);
        joinAs(r.member(), otherIsland, GroupMemberRole.MEMBER);

        settle(r.member(), r.islandId(), 10);
        settle(r.member(), r.islandId(), 5);
        settle(r.member(), otherIsland, 100);
        settle(r.host(), r.islandId(), 7);

        assertThatThrownBy(() -> economy.fishEarnings(r.member(), r.islandId()))
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.LIBRARY_LOCKED);

        facilities.save(IslandFacility.builder().islandId(r.islandId()).buildingId("library")
                .status(FacilityStatus.COMPLETED).cost(2720).costRevision(1)
                .completedAt(Instant.now()).build());

        IslandFishEarningsView view = economy.fishEarnings(r.host(), r.islandId());
        assertThat(view.members()).extracting(IslandFishEarningsView.Member::userId)
                .containsExactly(r.member(), r.host(), quiet);
        assertThat(view.members()).extracting(IslandFishEarningsView.Member::earnedFish).containsExactly(15L, 7L, 0L);

        mvc.perform(get("/internal/islands/" + r.islandId() + "/statistics/fish-earnings")
                        .header("Authorization", "Bearer " + TOKEN).header("X-User-Id", r.member()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.members[0].userId").value(r.member().toString()))
                .andExpect(jsonPath("$.members[0].earnedFish").value(15))
                .andExpect(jsonPath("$.members[2].earnedFish").value(0));
        mvc.perform(get("/internal/islands/" + r.islandId() + "/statistics/fish-earnings")
                        .header("Authorization", "Bearer " + TOKEN).header("X-User-Id", visitor))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("MEMBER_ONLY"));
    }

    // ---------------------------------------------------------------- 도구

    private record Resident(UUID islandId, UUID host, UUID member) {
    }

    private Resident residentIsland() {
        UUID host = newUser();
        UUID member = newUser();
        UUID islandId = island("경제섬", false);
        joinAs(host, islandId, GroupMemberRole.OWNER);
        joinAs(member, islandId, GroupMemberRole.MEMBER);
        return new Resident(islandId, host, member);
    }

    /** 생산 적립 경로로 원장 한 줄을 쓰고 그 줄의 시각만 옮긴다. */
    private void contribute(UUID islandId, UUID userId, int amount, Instant at) {
        String key = "test:" + UUID.randomUUID();
        new TransactionTemplate(transactionManager).executeWithoutResult(status ->
                wallets.contribute(islandId, userId, amount, key));
        moveLedgerRow(islandId, key, at);
    }

    /** 생산 차감 경로 — 잔액이 모자라지 않게 호출 전 적립이 먼저 있어야 한다. */
    private void debit(UUID islandId, int amount, Instant at) {
        String key = "test:" + UUID.randomUUID();
        new TransactionTemplate(transactionManager).executeWithoutResult(status ->
                wallets.debitForConstruction(islandId, amount, key));
        moveLedgerRow(islandId, key, at);
    }

    private void moveLedgerRow(UUID islandId, String key, Instant at) {
        jdbc.update("update island_wallet_transactions set created_at=? where island_id=? and idempotency_key=?",
                Timestamp.from(at), islandId, key);
    }

    /**
     * 정산 한 건 — 지급 경로가 쓰는 행 넷(기본 마커 · 완료 상세 · 적립 원장 · 정산)을 운영 엔티티로 심는다.
     * 누적 획득의 정본은 GROMO-1990 부터 적립 원장({@code focus_reward_accruals})이다.
     */
    private void settle(UUID userId, UUID islandId, int earnedFish) {
        User user = users.getCaller(userId);
        Instant ended = Instant.now().minusSeconds(60);
        UUID sessionId = sessions.save(FocusSession.builder().user(user).focusType(FocusType.INFINITE)
                .startedAt(ended.minusSeconds(earnedFish * 60L)).endedAt(ended).build()).getId();
        details.save(FocusSessionDetail.builder().sessionId(sessionId).userId(userId).islandId(islandId)
                .membershipEpochAtStart(1L).subject("수학").targetMinutes(25)
                .lifecycle(FocusSessionLifecycle.COMPLETED).lastTransitionAt(ended).build());
        new TransactionTemplate(transactionManager).executeWithoutResult(status -> {
            if (earnedFish > 0) {
                em.persist(FocusRewardAccrual.builder().sessionId(sessionId)
                        .accruedOn(LocalDate.ofInstant(ended, ZoneOffset.UTC)).earnedFish(earnedFish).build());
            }
            em.persist(FocusSettlement.builder().sessionId(sessionId).activeSeconds(earnedFish * 60L)
                    .goalAchieved(true).earnedFish(earnedFish).personalFishAdded(0)
                    .constructionFishAdded(earnedFish).completedAt(ended).build());
        });
    }

    private void setRequestCreatedAt(UUID requestId, Instant at) {
        jdbc.update("update island_join_requests set created_at=? where id=?", Timestamp.from(at), requestId);
    }

    private UUID newUser() {
        return jwt.extractUserId(auth.guestLogin().accessToken());
    }

    private UUID island(String name, boolean approvalRequired) {
        return groups.save(Group.builder().name(name).description(null).maxMembers(10)
                .isPrivate(false).approvalRequired(approvalRequired)
                .status(GroupStatus.WAITING).build()).getId();
    }

    private void joinAs(UUID userId, UUID islandId, GroupMemberRole role) {
        User user = users.getCaller(userId);
        Group island = groups.findById(islandId).orElseThrow();
        members.save(GroupMember.builder().user(user).group(island).role(role).build());
    }
}
