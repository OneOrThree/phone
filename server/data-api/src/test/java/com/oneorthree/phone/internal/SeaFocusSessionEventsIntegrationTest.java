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
 * 바다 방 사건 {@code sea.member.updated} (GROMO-2299, 계약 §4) — 스위치 {@code focus.sea.realtime-events-enabled} 를 켠 쪽을
 * <b>실제 Flyway PostgreSQL</b> 위에서 본다. start 뒤 {@code sailing}, finish 뒤 {@code ended}(arrived 포함) 두 줄이 USER 축
 * ({@code subject_id = userId})으로 REALTIME 대상에 남는다. 꺼진 쪽은 {@code SeaFocusSessionIntegrationTest} 가 0건을 본다.
 */
@SpringBootTest
@AutoConfigureMockMvc
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class SeaFocusSessionEventsIntegrationTest {

    static final String TOKEN = "test-sea-focus-events-business";

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
        registry.add("focus.session.start-enabled", () -> true);
        registry.add("focus.sea.realtime-events-enabled", () -> true);
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
    @DisplayName("스위치가 켜져 있으면 start 뒤 sailing, finish 뒤 ended 가 USER 축 REALTIME 사건으로 남는다")
    void sailingAndEndedAreAppended() throws Exception {
        UUID island = newIsland();
        UUID user = newUser();
        int sailing = pinAndSailingMinutes(user, island);
        String sessionId = JsonPath.read(start(user, island).andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString(), "$.id");

        assertThat(count("select count(*) from event_outbox where type='sea.member.updated' and user_id=?", user))
                .isEqualTo(1);
        assertThat(param(user, "sailing", "sessionId")).isEqualTo(sessionId);
        assertThat(param(user, "sailing", "destinationIslandId")).isEqualTo(island.toString());
        assertThat(param(user, "sailing", "sailingMinutes")).isEqualTo(String.valueOf(sailing));
        assertThat(param(user, "sailing", "activeSeconds")).isEqualTo("0");

        backdate(sessionId, sailing * 60L + 30);
        call(post("/internal/users/" + user + "/focus-sessions/" + sessionId + "/finish"), user,
                "{\"expectedVersion\":1}").andExpect(status().isOk());

        assertThat(count("select count(*) from event_outbox where type='sea.member.updated' and user_id=?", user))
                .isEqualTo(2);
        assertThat(param(user, "ended", "arrived")).isEqualTo("true");
        assertThat(Long.parseLong(param(user, "ended", "activeSeconds"))).isGreaterThanOrEqualTo(sailing * 60L);
        assertThat(count("select count(*) from event_outbox where type='sea.member.updated' and user_id=? "
                + "and subject_id=? and aggregate_type='USER' and aggregate_id=?", user, user.toString(),
                user.toString())).as("USER 축 · subjectId=userId").isEqualTo(2);
        assertThat(count("select count(*) from event_outbox_deliveries d join event_outbox o on o.id=d.outbox_id "
                + "where o.type='sea.member.updated' and o.user_id=? and d.target='REALTIME'", user))
                .as("대상은 REALTIME 하나").isEqualTo(2);
        assertThat(count("select count(*) from event_outbox where type in ('focus.member.updated',"
                + "'rest.member.updated') and params->>'sessionId'=?", sessionId)).isZero();
    }

    // ---------------------------------------------------------------- 도구

    private ResultActions start(UUID user, UUID destination) throws Exception {
        return call(post("/internal/users/" + user + "/focus-sessions/sea"), user,
                "{\"destinationIslandId\":\"" + destination + "\"}");
    }

    /** 목적지를 핀으로 망원경에 넣고 그 항목의 항해 분을 돌려준다 — 소속 0 계정도 된다. */
    private int pinAndSailingMinutes(UUID user, UUID island) {
        return pins.pin(user, island, "magazine").item().sailingMinutes();
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

    private String param(UUID user, String status, String key) {
        return jdbc.queryForObject("select params->>? from event_outbox where type='sea.member.updated' "
                + "and user_id=? and params->>'status'=?", String.class, key, user, status);
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

    private long count(String sql, Object... args) {
        Long value = jdbc.queryForObject(sql, Long.class, args);
        return value == null ? 0L : value;
    }
}
