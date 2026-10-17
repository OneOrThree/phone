package com.oneorthree.phone.internal;

import com.jayway.jsonpath.JsonPath;
import com.oneorthree.phone.auth.service.AuthService;
import com.oneorthree.phone.auth.support.JwtProvider;
import com.oneorthree.phone.internal.dto.CreateIslandCommandRequest;
import com.oneorthree.phone.internal.service.IslandMembershipService;
import com.oneorthree.phone.internal.service.TelescopePinService;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
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
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 바다 집중 세션 (GROMO-2299) — 내부 표면으로 start → current → pause 거절 → finish 를 <b>실제 Flyway PostgreSQL</b>
 * 위에서 본다. 소속이 0개인 계정이 망원경 항목으로 시작하고, 통장은 한 푼도 움직이지 않는다. 사건 스위치는 기본값(꺼짐)
 * 그대로라 outbox 에 바다 사건이 한 줄도 남지 않는다(켜진 쪽은 {@code SeaFocusSessionEventsIntegrationTest}).
 */
@SpringBootTest
@AutoConfigureMockMvc
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class SeaFocusSessionIntegrationTest {

    static final String TOKEN = "test-sea-focus-business";

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
        registry.add("focus.session.start-enabled", () -> true);
        registry.add("internal.api.enabled", () -> true);
        registry.add("internal.api.callers.business.token", () -> TOKEN);
        List<String> allow = List.of(
                "POST /internal/users/*/focus-sessions",
                "POST /internal/users/*/focus-sessions/sea",
                "GET /internal/users/*/focus-sessions/current",
                "POST /internal/users/*/focus-sessions/*/pause",
                "POST /internal/users/*/focus-sessions/*/resume",
                "POST /internal/users/*/focus-sessions/*/finish");
        for (int i = 0; i < allow.size(); i++) {
            String rule = allow.get(i);
            registry.add("internal.api.callers.business.allow[" + i + "]", () -> rule);
        }
    }

    @Autowired
    IslandMembershipService islands;
    @Autowired
    TelescopePinService pins;
    @Autowired
    AuthService auth;
    @Autowired
    JwtProvider jwt;
    @Autowired
    JdbcTemplate jdbc;
    @Autowired
    MockMvc mvc;

    @Test
    @DisplayName("소속 0 계정이 망원경 섬으로 시작 201(kind=sea, 목표=항해 분) → current → pause·resume 409 → 항해 시간 뒤 finish arrived=true")
    void voyageReachesTheDestination() throws Exception {
        UUID island = newIsland();
        UUID user = newUser();
        long walletBefore = walletBalance(island);
        long ledgerBefore = ledgerRows(island);
        int sailing = pinAndSailingMinutes(user, island);

        String started = start(user, island).andExpect(status().isCreated())
                .andExpect(jsonPath("$.kind").value("sea"))
                .andExpect(jsonPath("$.islandId").value(island.toString()))
                .andExpect(jsonPath("$.targetMinutes").value(sailing))
                .andExpect(jsonPath("$.status").value("active"))
                .andReturn().getResponse().getContentAsString();
        String sessionId = JsonPath.read(started, "$.id");
        String base = "/internal/users/" + user;

        call(get(base + "/focus-sessions/current"), user, null).andExpect(status().isOk())
                .andExpect(jsonPath("$.session.id").value(sessionId))
                .andExpect(jsonPath("$.session.kind").value("sea"));
        call(post(base + "/focus-sessions/" + sessionId + "/pause"), user, "{\"expectedVersion\":1}")
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("SEA_SESSION_NO_REST"));
        call(post(base + "/focus-sessions/" + sessionId + "/resume"), user, "{\"expectedVersion\":1}")
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("SEA_SESSION_NO_REST"));
        assertThat(detail(sessionId, "kind")).isEqualTo("SEA");
        assertThat(detail(sessionId, "membership_epoch_at_start")).isNull();
        assertThat(detail(sessionId, "sailing_minutes")).isEqualTo(sailing);
        assertThat(detail(sessionId, "arrived")).isNull();

        backdate(sessionId, sailing * 60L + 30);
        call(post(base + "/focus-sessions/" + sessionId + "/finish"), user, "{\"expectedVersion\":1}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.kind").value("sea"))
                .andExpect(jsonPath("$.arrived").value(true))
                .andExpect(jsonPath("$.seaReward").exists())
                .andExpect(jsonPath("$.earnedFish").value(0));

        assertThat(detail(sessionId, "arrived")).isEqualTo(true);
        assertThat(detail(sessionId, "lifecycle")).isEqualTo("COMPLETED");
        assertThat(walletBalance(island)).as("섬 통장 잔액 불변").isEqualTo(walletBefore);
        assertThat(ledgerRows(island)).as("원장 불변").isEqualTo(ledgerBefore);
        assertThat(count("select count(*) from event_outbox where type='sea.member.updated'"))
                .as("스위치가 꺼져 있으면 바다 사건을 적지 않는다").isZero();
        assertThat(count("select count(*) from event_outbox where type in "
                + "('focus.member.updated','rest.member.updated') and params->>'sessionId'=?", sessionId))
                .as("바다 세션은 섬 presence 사건을 내지 않는다(목적지 주민에게 보이면 안 된다)").isZero();
    }

    @Test
    @DisplayName("항해 시간 전에 끝내면 arrived=false 이고 보상 엔진은 그대로 돈다")
    void finishingBeforeTheSailingTimeDoesNotArrive() throws Exception {
        UUID island = newIsland();
        UUID user = newUser();
        int sailing = pinAndSailingMinutes(user, island);
        String sessionId = JsonPath.read(start(user, island).andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString(), "$.id");

        backdate(sessionId, (sailing - 5) * 60L);
        call(post("/internal/users/" + user + "/focus-sessions/" + sessionId + "/finish"), user,
                "{\"expectedVersion\":1}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.arrived").value(false))
                .andExpect(jsonPath("$.seaReward").exists());

        assertThat(detail(sessionId, "arrived")).isEqualTo(false);
    }

    @Test
    @DisplayName("목적지가 망원경 목록에 없으면 409 SEA_DESTINATION_UNAVAILABLE 이고 세션이 생기지 않는다")
    void destinationMustBeOnTheTelescope() throws Exception {
        UUID user = newUser();
        UUID notListed = UUID.randomUUID();

        start(user, notListed).andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("SEA_DESTINATION_UNAVAILABLE"));
        call(post("/internal/users/" + user + "/focus-sessions/sea"), user, "{}")
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("SEA_DESTINATION_UNAVAILABLE"));

        assertThat(count("select count(*) from focus_session_details where user_id=?", user)).isZero();
    }

    @Test
    @DisplayName("진행 중 세션이 있으면 바다 시작도 409 SESSION_IN_PROGRESS 다")
    void anotherProgressingSessionBlocksTheVoyage() throws Exception {
        UUID island = newIsland();
        UUID user = newUser();
        pinAndSailingMinutes(user, island);
        start(user, island).andExpect(status().isCreated());

        start(user, island).andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("SESSION_IN_PROGRESS"));
    }

    @Test
    @DisplayName("섬 세션(기존)은 kind=island, arrived=null 이고 응답 모양이 변하지 않는다")
    void islandSessionsAreUnchanged() throws Exception {
        UUID owner = newUser();
        UUID island = islands.create(owner, new CreateIslandCommandRequest("섬세션섬", null, false, null),
                UUID.randomUUID()).id();
        String base = "/internal/users/" + owner;

        String started = call(post(base + "/focus-sessions"), owner,
                "{\"islandId\":\"" + island + "\",\"subject\":\"알고리즘\",\"targetMinutes\":25}")
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.kind").value("island"))
                .andExpect(jsonPath("$.subject").value("알고리즘"))
                .andExpect(jsonPath("$.targetMinutes").value(25))
                .andReturn().getResponse().getContentAsString();
        String sessionId = JsonPath.read(started, "$.id");
        call(post(base + "/focus-sessions/" + sessionId + "/pause"), owner, "{\"expectedVersion\":1}")
                .andExpect(status().isOk()).andExpect(jsonPath("$.kind").value("island"));
        call(post(base + "/focus-sessions/" + sessionId + "/resume"), owner, "{\"expectedVersion\":2}")
                .andExpect(status().isOk());
        call(post(base + "/focus-sessions/" + sessionId + "/finish"), owner, "{\"expectedVersion\":3}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.kind").value("island"))
                .andExpect(jsonPath("$.arrived").doesNotExist())
                .andExpect(jsonPath("$.seaReward").doesNotExist());

        assertThat(detail(sessionId, "kind")).isEqualTo("ISLAND");
        assertThat(detail(sessionId, "arrived")).isNull();
    }

    // ---------------------------------------------------------------- 도구

    private ResultActions start(UUID user, UUID destination) throws Exception {
        return call(post("/internal/users/" + user + "/focus-sessions/sea"), user,
                "{\"destinationIslandId\":\"" + destination + "\"}");
    }

    /** 목적지를 핀으로 망원경에 넣고 그 항목의 항해 분을 돌려준다 — 소속 0 계정도 된다. */
    private int pinAndSailingMinutes(UUID user, UUID island) {
        return pins.pin(user, island, "magazine", null).item().sailingMinutes();
    }

    private UUID newIsland() {
        return islands.create(newUser(), new CreateIslandCommandRequest("바다섬", null, false, null),
                UUID.randomUUID()).id();
    }

    private UUID newUser() {
        return jwt.extractUserId(auth.guestLogin().accessToken());
    }

    ResultActions call(MockHttpServletRequestBuilder request, UUID user, String body) throws Exception {
        request.header("Authorization", "Bearer " + TOKEN)
                .header("X-User-Id", user.toString())
                .header("Idempotency-Key", UUID.randomUUID().toString());
        if (body != null) {
            request.contentType("application/json").content(body);
        }
        return mvc.perform(request);
    }

    private Object detail(String sessionId, String column) {
        return jdbc.queryForMap("select * from focus_session_details where session_id=?", UUID.fromString(sessionId))
                .get(column);
    }

    /** 방금 시작한 세션을 {@code seconds} 전에 시작한 것으로 옮긴다 — 실제 시계를 기다리지 않는다. */
    private void backdate(String sessionId, long seconds) {
        UUID id = UUID.fromString(sessionId);
        Timestamp at = Timestamp.from(Instant.now().minusSeconds(seconds));
        jdbc.update("update focus_sessions set started_at=? where id=?", at, id);
        jdbc.update("update focus_session_details set last_transition_at=? where session_id=?", at, id);
        jdbc.update("update focus_session_intervals set started_at=? where session_id=? and ordinal=1", at, id);
    }

    private long walletBalance(UUID island) {
        return count("select coalesce(sum(balance),0) from island_wallets where island_id=?", island);
    }

    private long ledgerRows(UUID island) {
        return count("select count(*) from island_wallet_transactions where island_id=?", island);
    }

    private long count(String sql, Object... args) {
        Long value = jdbc.queryForObject(sql, Long.class, args);
        return value == null ? 0L : value;
    }
}
