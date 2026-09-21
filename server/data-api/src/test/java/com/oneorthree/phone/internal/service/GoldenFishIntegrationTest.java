package com.oneorthree.phone.internal.service;

import com.oneorthree.phone.focus.repository.FocusFishEarningsRepository;
import com.oneorthree.phone.focus.repository.FocusRewardAccrualRepository;
import com.oneorthree.phone.focus.repository.FocusSessionDetailRepository;
import com.oneorthree.phone.focus.repository.FocusSessionRepository;
import com.oneorthree.phone.focus.repository.domain.FocusRewardAccrual;
import com.oneorthree.phone.focus.repository.domain.FocusSession;
import com.oneorthree.phone.focus.repository.domain.FocusSessionDetail;
import com.oneorthree.phone.focus.repository.domain.FocusSessionLifecycle;
import com.oneorthree.phone.focus.repository.domain.FocusType;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.group.repository.domain.GroupMemberRole;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.domain.User;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

/**
 * 황금 물고기 (GROMO-1956) — 실 Flyway(V91 포함) 스키마 위에서 추첨·적립·배분·사건을 전 경로로 검증한다.
 *
 * <p>추첨은 «정책 설정값» 으로 가른다: 확률표를 100%(또는 0%)로 심은 revision 을 하나 올려
 * {@code findFirstByOrderByRevisionDesc} 가 그걸 읽게 한다. 주사위 자체의 결정성·분포는
 * {@code GoldenFishDrawTest} 가 따로 본다 — 여기서 난수에 기대면 테스트가 무작위로 깜빡인다.
 */
@SpringBootTest
class GoldenFishIntegrationTest {

    /** 추첨 분(UTC). 적립일도 이 날짜다(결정 D8 — 하루 리셋 UTC 00:00). */
    private static final Instant MINUTE = Instant.parse("2031-03-10T10:00:00Z");
    private static final LocalDate DAY = LocalDate.of(2031, 3, 10);
    private static final AtomicReference<Instant> NOW = new AtomicReference<>(MINUTE);

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
    }

    @MockitoBean
    Clock clock;

    @Autowired
    GoldenFishService goldenFish;
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
    FocusRewardAccrualRepository accruals;
    @Autowired
    FocusFishEarningsRepository earnings;
    @Autowired
    JdbcTemplate jdbc;

    @BeforeEach
    void controlClock() {
        NOW.set(MINUTE);
        when(clock.instant()).thenAnswer(invocation -> NOW.get());
        when(clock.getZone()).thenReturn(ZoneOffset.UTC);
    }

    @Test
    @DisplayName("ACTIVE 6명 당첨 — 섬 잔액 +50, 주민별 기록·건설 몫 +8, 나머지 2는 섬에만 남는다")
    void sixActiveMembersSplitFiftyAndLeaveTheRemainderOnTheIsland() {
        alwaysWin();
        Island island = island();
        chooseConstructionTarget(island.id);
        List<Member> caught = active(island, 6);

        assertThat(goldenFish.drawAndCredit(island.id, MINUTE)).isTrue();

        assertThat(balance(island.id)).as("섬 잔액은 인원수만큼 곱하지 않는다").isEqualTo(50);
        assertThat(ledger(island.id)).containsExactly(Map.entry("GOLDEN_FISH", 50));
        for (Member member : caught) {
            assertThat(goldenOf(member.sessionId)).as("누적 획득 몫 = 50 ÷ 6 (내림)").isEqualTo(8);
            assertThat(contribution(island.id, member.userId)).as("건설 각자 몫도 같은 8").isEqualTo(8);
        }
        // 50 − 8 × 6 = 2 — 나눠 준 합보다 섬 잔액이 2 많다.
        assertThat(50 - caught.size() * 8).isEqualTo(2);
    }

    @Test
    @DisplayName("오늘 480마리를 채운 주민도 인원·배분에 들고, 황금은 자체 상한이 없어 같은 분 여러 회차를 다 받는다")
    void dailyCapNeitherExcludesMembersNorLimitsGoldenFish() {
        alwaysWin();
        Island island = island();
        List<Member> caught = active(island, 2);
        // 한 명은 오늘 기본 상한(480)을 이미 채웠다 — 그래도 인원에 넣고 함께 낚는다(기획 정본).
        accruals.save(FocusRewardAccrual.builder().sessionId(caught.get(0).sessionId)
                .accruedOn(DAY).earnedFish(480).build());

        assertThat(goldenFish.drawAndCredit(island.id, MINUTE)).isTrue();
        // 같은 섬의 다음 분 추첨도 그대로 당첨된다 — 황금 물고기에는 자체 상한이 없다.
        assertThat(goldenFish.drawAndCredit(island.id, MINUTE.plusSeconds(60))).isTrue();

        assertThat(balance(island.id)).isEqualTo(100);
        assertThat(goldenOf(caught.get(0).sessionId)).as("상한 도달자도 두 번 다 받는다").isEqualTo(50);
        assertThat(goldenOf(caught.get(1).sessionId)).isEqualTo(50);
        // 기본 적립(earned_fish)은 상한 축 그대로다 — 황금이 그 열을 건드리지 않는다.
        assertThat(accruals.sumEarnedFishOnDay(caught.get(0).userId, island.id, DAY)).isEqualTo(480);
        // 주민 누적 획득 기록은 둘의 합이다.
        assertThat(earnedRecordOf(island.id, caught.get(0).userId)).isEqualTo(480 + 50);
        assertThat(earnedRecordOf(island.id, caught.get(1).userId)).isEqualTo(50);
    }

    @Test
    @DisplayName("같은 추첨을 다시 처리해도 잔액·기록·건설 몫이 한 번만 늘어난다")
    void replayingTheSameDrawCreditsOnce() {
        alwaysWin();
        Island island = island();
        chooseConstructionTarget(island.id);
        List<Member> caught = active(island, 2);

        assertThat(goldenFish.drawAndCredit(island.id, MINUTE)).isTrue();
        for (int i = 0; i < 3; i++) {
            assertThat(goldenFish.drawAndCredit(island.id, MINUTE)).as("재처리는 아무것도 쓰지 않는다").isFalse();
        }

        assertThat(balance(island.id)).isEqualTo(50);
        assertThat(ledger(island.id)).containsExactly(Map.entry("GOLDEN_FISH", 50));
        for (Member member : caught) {
            assertThat(goldenOf(member.sessionId)).isEqualTo(25);
            assertThat(contribution(island.id, member.userId)).isEqualTo(25);
        }
        assertThat(outboxEvents(island.id)).as("사건도 한 번만").hasSize(1);
    }

    @Test
    @DisplayName("혼자 집중하거나 휴식(PAUSED)뿐이면 추첨하지 않는다 — 확률이 100%여도 나타나지 않는다")
    void neverDrawsForFewerThanTwoActiveMembers() {
        alwaysWin();
        Island alone = island();
        active(alone, 1);
        assertThat(goldenFish.drawAndCredit(alone.id, MINUTE)).isFalse();

        Island resting = island();
        active(resting, 1);
        // 휴식 중인 주민은 ACTIVE 가 아니라 인원에 들지 않는다.
        Member rester = member(resting, FocusSessionLifecycle.PAUSED);
        assertThat(goldenFish.drawAndCredit(resting.id, MINUTE)).isFalse();

        assertThat(balance(alone.id)).isZero();
        assertThat(balance(resting.id)).isZero();
        assertThat(goldenOf(rester.sessionId)).isZero();
    }

    @Test
    @DisplayName("확률 0 이면 ACTIVE 가 몇 명이든 나타나지 않는다 — 확률표는 서버 정책 설정값이다")
    void neverDrawsWhenTheConfiguredChanceIsZero() {
        neverWin();
        Island island = island();
        active(island, 5);

        assertThat(goldenFish.drawAndCredit(island.id, MINUTE)).isFalse();
        assertThat(balance(island.id)).isZero();
        assertThat(outboxEvents(island.id)).isEmpty();
    }

    @Test
    @DisplayName("focus.golden 봉투 한 장에 함께 낚은 주민 전원과 배분량이 실린다 — 수신자별로 펼치지 않는다")
    void publishesOneEnvelopeCarryingEveryCatcher() {
        alwaysWin();
        Island island = island();
        List<Member> caught = active(island, 4);

        assertThat(goldenFish.drawAndCredit(island.id, MINUTE)).isTrue();

        List<Map<String, Object>> events = outboxEvents(island.id);
        assertThat(events).hasSize(1);
        String params = String.valueOf(events.get(0).get("params"));
        String compact = params.replace(" ", "");
        assertThat(compact).contains("\"reward\":50").contains("\"sharePerMember\":12")
                .contains("\"drawnAt\":\"2031-03-10T10:00:00Z\"");
        for (Member member : caught) {
            assertThat(params).contains(member.userId.toString()).contains(member.sessionId.toString());
        }
    }

    // ---------------------------------------------------------------- 심기·읽기

    /** 확률표를 100%로 올린 새 revision — 현재 정책은 가장 큰 revision 이다. */
    private void alwaysWin() {
        publishPolicy(50, 5, "1000000,1000000,1000000,1000000");
    }

    private void neverWin() {
        publishPolicy(50, 5, "0,0,0,0");
    }

    private void publishPolicy(int reward, int maxMembers, String chanceTable) {
        jdbc.update("INSERT INTO focus_reward_policies (revision, seconds_per_fish, daily_cap_fish, "
                        + "personal_share_percent, golden_fish_reward, golden_max_members, golden_chance_ppm) "
                        + "SELECT COALESCE(MAX(revision), 0) + 1, 60, 480, 0, ?, ?, ? FROM focus_reward_policies",
                reward, maxMembers, chanceTable);
    }

    private Island island() {
        User owner = users.save(User.builder().nickname("방장-" + UUID.randomUUID()).build());
        Group group = groups.save(Group.builder().name("섬").maxMembers(15).build());
        members.save(GroupMember.builder().user(owner).group(group).role(GroupMemberRole.OWNER).build());
        return new Island(group.getId(), group);
    }

    /** 건설 목표를 고른다 — 「각자 몫은 목표를 고른 뒤부터 모은 물고기로 판단한다」(정책 P-D04). */
    private void chooseConstructionTarget(UUID islandId) {
        jdbc.update("INSERT INTO island_construction_states (island_id, target_building_id) VALUES (?, 'library') "
                + "ON CONFLICT (island_id) DO UPDATE SET target_building_id = 'library'", islandId);
    }

    private List<Member> active(Island island, int count) {
        List<Member> seeded = new ArrayList<>();
        for (int i = 0; i < count; i++) {
            seeded.add(member(island, FocusSessionLifecycle.ACTIVE));
        }
        return seeded;
    }

    private Member member(Island island, FocusSessionLifecycle lifecycle) {
        User user = users.save(User.builder().nickname("주민-" + UUID.randomUUID()).build());
        members.save(GroupMember.builder().user(user).group(island.group).role(GroupMemberRole.MEMBER).build());
        UUID sessionId = sessions.save(FocusSession.builder().user(user).focusType(FocusType.INFINITE)
                .startedAt(MINUTE).build()).getId();
        details.save(FocusSessionDetail.builder().sessionId(sessionId).userId(user.getId())
                .islandId(island.id).membershipEpochAtStart(1L).subject("공부").targetMinutes(30)
                .lifecycle(lifecycle).lastTransitionAt(MINUTE).build());
        return new Member(user.getId(), sessionId);
    }

    private int balance(UUID islandId) {
        return jdbc.query("SELECT balance FROM island_wallets WHERE island_id = ?",
                rs -> rs.next() ? rs.getInt(1) : 0, islandId);
    }

    private List<Map.Entry<String, Integer>> ledger(UUID islandId) {
        return jdbc.query("SELECT type, amount FROM island_wallet_transactions WHERE island_id = ? "
                        + "ORDER BY created_at",
                (rs, row) -> Map.entry(rs.getString(1), rs.getInt(2)), islandId);
    }

    private int goldenOf(UUID sessionId) {
        return jdbc.query("SELECT COALESCE(SUM(golden_fish), 0) FROM focus_reward_accruals WHERE session_id = ?",
                rs -> rs.next() ? rs.getInt(1) : 0, sessionId);
    }

    private int contribution(UUID islandId, UUID userId) {
        return jdbc.query("SELECT COALESCE(SUM(amount), 0) FROM island_construction_contributions "
                        + "WHERE island_id = ? AND user_id = ?",
                rs -> rs.next() ? rs.getInt(1) : 0, islandId, userId);
    }

    private long earnedRecordOf(UUID islandId, UUID userId) {
        return earnings.sumEarnedFishByUser(islandId, List.of(userId)).stream()
                .findFirst().map(FocusFishEarningsRepository.UserEarnings::getEarnedFish).orElse(0L);
    }

    private List<Map<String, Object>> outboxEvents(UUID islandId) {
        return jdbc.queryForList("SELECT params FROM event_outbox WHERE type = ? AND subject_id = ?",
                GoldenFishService.EVENT_TYPE, islandId.toString());
    }

    private record Island(UUID id, Group group) {
    }

    private record Member(UUID userId, UUID sessionId) {
    }
}
