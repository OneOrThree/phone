package com.oneorthree.phone.internal.notification;

import com.oneorthree.phone.focus.repository.domain.DailyFocusStat;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupBetStatus;
import com.oneorthree.phone.group.repository.domain.GroupChallenge;
import com.oneorthree.phone.group.repository.domain.GroupChallengeBet;
import com.oneorthree.phone.group.repository.domain.GroupChallengeBetParticipant;
import com.oneorthree.phone.group.repository.domain.GroupChallengeBetSession;
import com.oneorthree.phone.group.repository.domain.MissionCategory;
import com.oneorthree.phone.group.repository.domain.MissionType;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import com.oneorthree.phone.user.repository.domain.User;
import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.EnumSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** 실제 PG 정본을 바꾼 뒤 같은 지연 봉투의 적격성을 실제 내부 HTTP 표면에서 재조회한다. */
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class DelayedDomainEligibilityIntegrationTest {
    private static final String TOKEN = "delayed-domain-noti-to-data";
    private static final Instant NOW = Instant.parse("2026-09-13T12:00:00Z"); // 일요일 KST 21시
    private static final LocalDate TODAY = LocalDate.of(2026, 9, 13);
    private static final ZoneId KST = ZoneId.of("Asia/Seoul");

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
        registry.add("internal.api.enabled", () -> true);
        registry.add("internal.api.callers.notification.token", () -> TOKEN);
        registry.add("internal.api.callers.notification.allow[0]",
                () -> "POST /internal/notifications/eligibility");
    }

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;
    @Autowired EntityManager entityManager;
    @Autowired JdbcTemplate jdbc;
    @MockitoBean Clock clock;
    private User user;

    @BeforeEach
    void setup() {
        when(clock.instant()).thenReturn(NOW);
        when(clock.getZone()).thenReturn(KST);
        user = User.builder().nickname("delayed-" + UUID.randomUUID()).tierLevel(2).build();
        entityManager.persist(user);
        entityManager.flush();
        jdbc.update("UPDATE league_tier_configs SET promotion_time=1000,relegation_time=500,deleted_at=NULL"
                + " WHERE tier_level=2");
    }

    @ParameterizedTest
    @EnumSource(value = GroupBetStatus.class, names = {"SETTLED", "VOIDED", "REFUNDED", "FORFEITED"})
    void silentFlushStopsWhenTheSessionEndsEvenBeforeItsOriginalDeadline(GroupBetStatus terminal) throws Exception {
        UUID session = session();
        evaluate("BET_SILENT_FLUSH", session, false).andExpect(jsonPath("$.eligible").value(true));
        jdbc.update("UPDATE group_challenge_bet_sessions SET status=?,settled_at=? WHERE id=?",
                terminal.name(), java.sql.Timestamp.from(NOW), session);
        entityManager.clear();
        evaluate("BET_SILENT_FLUSH", session, false).andExpect(jsonPath("$.eligible").value(false))
                .andExpect(jsonPath("$.reason").value("SESSION_CLOSED"));
    }

    @ParameterizedTest
    @ValueSource(longs = {0, 1})
    void silentFlushStopsAtTheDeadlineEvenIfSettlementIsStillPending(long afterSeconds) throws Exception {
        UUID session = session();
        evaluate("BET_SILENT_FLUSH", session, false).andExpect(jsonPath("$.eligible").value(true));
        when(clock.instant()).thenReturn(NOW.plusSeconds(600 + afterSeconds));
        evaluate("BET_SILENT_FLUSH", session, false).andExpect(jsonPath("$.eligible").value(false))
                .andExpect(jsonPath("$.reason").value("EVENT_EXPIRED"));
    }

    @Test
    void silentFlushAdminTestStillNeedsAnOpenUnexpiredSessionAndParticipation() throws Exception {
        UUID session = session();
        evaluate("BET_SILENT_FLUSH", session, true).andExpect(jsonPath("$.eligible").value(true));
        when(clock.instant()).thenReturn(NOW.plusSeconds(600));
        evaluate("BET_SILENT_FLUSH", session, true).andExpect(jsonPath("$.eligible").value(false))
                .andExpect(jsonPath("$.reason").value("EVENT_EXPIRED"));
        when(clock.instant()).thenReturn(NOW);
        jdbc.update("DELETE FROM group_challenge_bet_participants WHERE session_id=?", session);
        entityManager.clear();
        evaluate("BET_SILENT_FLUSH", session, true).andExpect(jsonPath("$.eligible").value(false))
                .andExpect(jsonPath("$.reason").value("NOT_PARTICIPANT"));
    }

    @ParameterizedTest
    @CsvSource({"LEAGUE_DEADLINE_D1,600,1000", "LEAGUE_RELEGATION_WARNING,499,500",
            "LEAGUE_RELEGATION_WARNING_EVENING,499,500"})
    void reachingTheCurrentTierThresholdSuppressesTheDelayedLeagueMessage(String kind, int initial, int safe)
            throws Exception {
        DailyFocusStat stat = stat(TODAY, initial);
        evaluate(kind, null, false).andExpect(jsonPath("$.eligible").value(true));
        stat.setTotalFocusSeconds(safe);
        entityManager.flush();
        entityManager.clear();
        evaluate(kind, null, false).andExpect(jsonPath("$.eligible").value(false))
                .andExpect(jsonPath("$.reason").value("LEAGUE_CONDITION_CHANGED"));
        evaluate(kind, null, true).andExpect(jsonPath("$.eligible").value(false));
    }

    @ParameterizedTest
    @CsvSource({"LEAGUE_DEADLINE_D1,600,5", "LEAGUE_RELEGATION_WARNING,0,1",
            "LEAGUE_RELEGATION_WARNING_EVENING,0,1"})
    void tierChangesAreReadAtDispatchInsteadOfUsingTheOriginalShortfall(String kind, int total, int tier)
            throws Exception {
        stat(TODAY, total);
        evaluate(kind, null, false).andExpect(jsonPath("$.eligible").value(true));
        jdbc.update("UPDATE users SET tier_level=? WHERE id=?", tier, user.getId());
        entityManager.clear();
        evaluate(kind, null, false).andExpect(jsonPath("$.eligible").value(false));
    }

    @Test
    void aPromotionReminderDoesNotReplaceTheHigherPriorityRelegationBranch() throws Exception {
        stat(TODAY, 499);
        evaluate("LEAGUE_DEADLINE_D1", null, false).andExpect(jsonPath("$.eligible").value(false));
        evaluate("LEAGUE_RELEGATION_WARNING", null, false).andExpect(jsonPath("$.eligible").value(true));
    }

    @Test
    void previousWeeksDoNotCountAndZeroThisWeekIsStillAWarningCandidate() throws Exception {
        stat(TODAY.minusDays(7), 100000);
        evaluate("LEAGUE_RELEGATION_WARNING", null, false).andExpect(jsonPath("$.eligible").value(true));
        evaluate("LEAGUE_RELEGATION_WARNING_EVENING", null, true).andExpect(jsonPath("$.eligible").value(true));
        jdbc.update("UPDATE users SET tier_level=1 WHERE id=?", user.getId());
        entityManager.clear();
        evaluate("LEAGUE_DEADLINE_D1", null, true).andExpect(jsonPath("$.eligible").value(true));
    }

    @Test
    void theCurrentRankingPopulationExcludesAnIncompleteOnboarding() throws Exception {
        jdbc.update("UPDATE users SET nickname='  ' WHERE id=?", user.getId());
        entityManager.clear();
        for (String kind : new String[]{"LEAGUE_DEADLINE_D1", "LEAGUE_RELEGATION_WARNING",
                "LEAGUE_RELEGATION_WARNING_EVENING"}) {
            evaluate(kind, null, false).andExpect(jsonPath("$.eligible").value(false));
        }
    }

    @Test
    void ordinaryDeadlinesKeepTheirTimeOnlyPolicyWhenTheUserIsAlreadySafe() throws Exception {
        stat(TODAY, 100000);
        for (String kind : new String[]{"LEAGUE_DEADLINE", "LEAGUE_FINAL_DEADLINE", "LEAGUE_WEEKLY_RESULT"}) {
            evaluate(kind, null, false).andExpect(jsonPath("$.eligible").value(true));
        }
    }

    @Test
    void anExpiredCrisisDoesNotBecomeFreshJustBecauseItsConditionStillHolds() throws Exception {
        when(clock.instant()).thenReturn(NOW.plusSeconds(86400));
        evaluate("LEAGUE_RELEGATION_WARNING", null, false).andExpect(jsonPath("$.eligible").value(false))
                .andExpect(jsonPath("$.reason").value("EVENT_EXPIRED"));
    }

    @Test
    void missingTierConfigurationIsAnUpstreamFailureInsteadOfPermanentSuppression() throws Exception {
        jdbc.update("UPDATE league_tier_configs SET deleted_at=? WHERE tier_level=2", java.sql.Timestamp.from(NOW));
        call("LEAGUE_RELEGATION_WARNING", null, false).andExpect(status().is5xxServerError());
    }

    private DailyFocusStat stat(LocalDate date, int seconds) {
        DailyFocusStat stat = DailyFocusStat.builder().user(user).date(date).totalFocusSeconds(seconds).build();
        entityManager.persist(stat);
        entityManager.flush();
        return stat;
    }

    private UUID session() {
        Group group = Group.builder().name("지연 silent").build();
        entityManager.persist(group);
        GroupChallenge challenge = GroupChallenge.builder().group(group)
                .category(MissionCategory.FOCUS).type(MissionType.DURATION).build();
        entityManager.persist(challenge);
        GroupChallengeBet bet = GroupChallengeBet.builder().group(group).challenge(challenge).stake(10).build();
        entityManager.persist(bet);
        GroupChallengeBetSession session = GroupChallengeBetSession.builder().bet(bet).group(group).challenge(challenge)
                .sessionDate(TODAY).stake(10).goalMinutes(60).missionCategory(MissionCategory.FOCUS)
                .missionType(MissionType.DURATION).status(GroupBetStatus.OPEN).startsAt(NOW.minusSeconds(7200))
                .joinClosesAt(NOW.minusSeconds(7200)).closesAt(NOW.minusSeconds(3000))
                .settleAfter(NOW.plusSeconds(600)).build();
        entityManager.persist(session);
        entityManager.persist(GroupChallengeBetParticipant.builder().session(session).user(user).build());
        entityManager.flush();
        entityManager.clear();
        return session.getId();
    }

    private ResultActions evaluate(String kind, UUID subject, boolean admin) throws Exception {
        return call(kind, subject, admin).andExpect(status().isOk());
    }

    private ResultActions call(String kind, UUID subject, boolean admin) throws Exception {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("userId", user.getId());
        body.put("kind", kind);
        body.put("subjectId", subject);
        body.put("params", admin ? Map.of() : Map.of("dedupAt", NOW.toString(), "shortfallSeconds", 1));
        if (admin) {
            body.put("adminTestRequestedAt", NOW.toString());
        }
        return mvc.perform(post("/internal/notifications/eligibility").header("Authorization", "Bearer " + TOKEN)
                .header("X-User-Id", user.getId().toString()).contentType("application/json")
                .content(mapper.writeValueAsString(body)));
    }
}
