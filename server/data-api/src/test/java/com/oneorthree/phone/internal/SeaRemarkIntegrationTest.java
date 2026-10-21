package com.oneorthree.phone.internal;

import com.oneorthree.phone.auth.service.AuthService;
import com.oneorthree.phone.auth.support.JwtProvider;
import com.oneorthree.phone.internal.dto.CreateIslandCommandRequest;
import com.oneorthree.phone.internal.service.IslandMembershipService;
import com.oneorthree.phone.internal.service.TelescopePinService;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import com.oneorthree.phone.focus.service.SeaRemarkService;
import com.oneorthree.phone.withdrawal.service.AccountWithdrawalService;
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

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 바다 한마디 · 바다 상태 · 친구 id (GROMO-2299)를 <b>실제 Flyway PostgreSQL</b> 위에서 내부 표면으로 본다. 사건 스위치는
 * 켠 상태다 — 한마디 변경이 {@code sea.member.updated(remark)} 를 USER 축으로 남기는지도 함께 본다.
 */
@SpringBootTest
@AutoConfigureMockMvc
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class SeaRemarkIntegrationTest {

    static final String BUSINESS = "test-sea-remark-business";
    static final String REALTIME = "test-sea-remark-realtime";

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
        registry.add("focus.session.start-enabled", () -> true);
        registry.add("focus.sea.realtime-events-enabled", () -> true);
        registry.add("internal.api.enabled", () -> true);
        registry.add("internal.api.callers.business.token", () -> BUSINESS);
        registry.add("internal.api.callers.realtime.token", () -> REALTIME);
        List<String> business = List.of("PUT /internal/users/*/sea-remark",
                "POST /internal/users/*/focus-sessions/sea", "POST /internal/users/*/friend-requests");
        for (int i = 0; i < business.size(); i++) {
            String rule = business.get(i);
            registry.add("internal.api.callers.business.allow[" + i + "]", () -> rule);
        }
        List<String> realtime = List.of("GET /internal/users/*/sea-state", "GET /internal/users/*/friends/ids");
        for (int i = 0; i < realtime.size(); i++) {
            String rule = realtime.get(i);
            registry.add("internal.api.callers.realtime.allow[" + i + "]", () -> rule);
        }
    }

    @Autowired
    IslandMembershipService islands;
    @Autowired
    TelescopePinService pins;
    @Autowired
    SeaRemarkService remarks;
    @Autowired
    AccountWithdrawalService withdrawal;
    @Autowired
    AuthService auth;
    @Autowired
    JwtProvider jwt;
    @Autowired
    JdbcTemplate jdbc;
    @Autowired
    MockMvc mvc;

    @Test
    @DisplayName("20자는 저장되고 응답에 lockedUntil=changedAt+5분이 실리며 sea.member.updated(remark) 가 남는다")
    void twentyCharactersAreSavedAndAnnounced() throws Exception {
        UUID user = newMember();

        putRemark(user, "가".repeat(20)).andExpect(status().isOk())
                .andExpect(jsonPath("$.remark").value("가".repeat(20)))
                .andExpect(jsonPath("$.changedAt").exists())
                .andExpect(jsonPath("$.lockedUntil").exists());

        assertThat(jdbc.queryForObject("select remark from sea_remarks where user_id=?", String.class, user))
                .isEqualTo("가".repeat(20));
        assertThat(jdbc.queryForObject("select extract(epoch from (changed_at + interval '5 minutes')) "
                + "- extract(epoch from changed_at) from sea_remarks where user_id=?", Long.class, user))
                .isEqualTo(300L);
        assertThat(count("select count(*) from event_outbox where type='sea.member.updated' and user_id=? "
                + "and subject_id=? and params->>'status'='remark' and params->>'remark'=?", user, user.toString(),
                "가".repeat(20))).isEqualTo(1);
    }

    @Test
    @DisplayName("21자는 400 이고 저장되지 않는다")
    void twentyOneCharactersAreRejected() throws Exception {
        UUID user = newMember();

        putRemark(user, "가".repeat(21)).andExpect(status().isBadRequest());

        assertThat(count("select count(*) from sea_remarks where user_id=?", user)).isZero();
    }

    @Test
    @DisplayName("금칙어 한마디는 방명록과 같은 400 BANNED_WORD 로 거절되고 저장·잠금·사건이 남지 않는다")
    void bannedWordsAreRejected() throws Exception {
        UUID user = newMember();

        putRemark(user, "너 씨발").andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("BANNED_WORD"));

        assertThat(count("select count(*) from sea_remarks where user_id=?", user)).isZero();
        assertThat(count("select count(*) from event_outbox where type='sea.member.updated' and user_id=?", user))
                .isZero();
        putRemark(user, "같이 집중해요").andExpect(status().isOk());
    }

    @Test
    @DisplayName("직전 변경 뒤 5분 안에 다시 바꾸면 409 SEA_REMARK_LOCKED, 5분이 지나면 바뀐다")
    void secondChangeWithinFiveMinutesIsLocked() throws Exception {
        UUID user = newMember();
        putRemark(user, "첫 번째").andExpect(status().isOk());

        putRemark(user, "두 번째").andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("SEA_REMARK_LOCKED"));
        assertThat(jdbc.queryForObject("select remark from sea_remarks where user_id=?", String.class, user))
                .isEqualTo("첫 번째");

        jdbc.update("update sea_remarks set changed_at = now() - interval '6 minutes' where user_id=?", user);
        putRemark(user, "두 번째").andExpect(status().isOk()).andExpect(jsonPath("$.remark").value("두 번째"));
    }

    @Test
    @DisplayName("게스트는 403 SOCIAL_LOGIN_REQUIRED 이고 사건도 남지 않는다")
    void guestsAreForbidden() throws Exception {
        UUID guest = newGuest();

        putRemark(guest, "안녕").andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("SOCIAL_LOGIN_REQUIRED"));

        assertThat(count("select count(*) from sea_remarks where user_id=?", guest)).isZero();
        assertThat(count("select count(*) from event_outbox where type='sea.member.updated' and user_id=?", guest))
                .isZero();
    }

    @Test
    @DisplayName("빈 문자열은 한마디를 지운다 — 응답·조회는 null 이고, 지운 것도 변경이라 5분 잠금이 걸린다")
    void emptyStringClearsTheRemark() throws Exception {
        UUID user = newMember();
        putRemark(user, "안녕하세요").andExpect(status().isOk());
        jdbc.update("update sea_remarks set changed_at = now() - interval '6 minutes' where user_id=?", user);

        putRemark(user, "").andExpect(status().isOk()).andExpect(jsonPath("$.remark").doesNotExist());
        getState(user).andExpect(status().isOk()).andExpect(jsonPath("$.remark").doesNotExist())
                .andExpect(jsonPath("$.remarkChangedAt").exists());
        putRemark(user, "다시").andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("SEA_REMARK_LOCKED"));
        assertThat(count("select count(*) from event_outbox where type='sea.member.updated' and user_id=? "
                + "and params->>'status'='remark' and params->>'remark' = ''", user)).isEqualTo(1);
        // 키가 사라지거나 null 이 되지 않고 JSON 으로도 "remark":"" 로 직렬화된다 — realtime 은 키 부재를 불량으로 무시한다.
        assertThat(jdbc.queryForObject("select params::text from event_outbox where type='sea.member.updated' "
                + "and user_id=? and params->>'status'='remark' and params->>'remark' = ''", String.class, user))
                .containsPattern("\"remark\":\\s*\"\"");
    }

    @Test
    @DisplayName("sea-state: name·catColor 를 돌려주고, 털색을 안 골랐으면 catColor 는 null 이다")
    void seaStateCarriesNameAndCatColor() throws Exception {
        UUID picked = newMember();
        UUID unpicked = newMember();
        jdbc.update("update users set nickname = ?, cat_color = 'ginger' where id = ?", "고등어" + picked, picked);
        jdbc.update("update users set nickname = ?, cat_color = null where id = ?", "무색" + unpicked, unpicked);

        getState(picked).andExpect(status().isOk())
                .andExpect(jsonPath("$.name").value("고등어" + picked))
                .andExpect(jsonPath("$.catColor").value("ginger"))
                // 착용 외양(GROMO-2389) — 행이 없으면 기본 외양, head·neck 은 미착용(null)
                .andExpect(jsonPath("$.appearance.hull").value("raft"))
                .andExpect(jsonPath("$.appearance.head").doesNotExist())
                .andExpect(jsonPath("$.appearance.neck").doesNotExist());
        getState(unpicked).andExpect(status().isOk())
                .andExpect(jsonPath("$.name").value("무색" + unpicked))
                .andExpect(jsonPath("$.catColor").doesNotExist());
    }

    @Test
    @DisplayName("sea-state: 한마디와 진행 중인 바다 세션을 돌려주고, 세션이 없으면 session=null 이다")
    void seaStateShowsTheRemarkAndTheLiveVoyage() throws Exception {
        UUID user = newMember();
        UUID island = islands.create(newGuest(), new CreateIslandCommandRequest("상태섬", null, false, null),
                UUID.randomUUID()).id();
        getState(user).andExpect(status().isOk()).andExpect(jsonPath("$.remark").doesNotExist())
                .andExpect(jsonPath("$.session").doesNotExist());

        putRemark(user, "항해 중").andExpect(status().isOk());
        int sailing = pins.pin(user, island, "magazine", null).item().sailingMinutes();
        call(post("/internal/users/" + user + "/focus-sessions/sea"), BUSINESS, user,
                "{\"destinationIslandId\":\"" + island + "\"}").andExpect(status().isCreated());

        getState(user).andExpect(status().isOk())
                .andExpect(jsonPath("$.remark").value("항해 중"))
                .andExpect(jsonPath("$.session.destinationIslandId").value(island.toString()))
                .andExpect(jsonPath("$.session.sailingMinutes").value(sailing))
                .andExpect(jsonPath("$.session.activeSeconds").isNumber())
                .andExpect(jsonPath("$.session.serverNow").exists())
                .andExpect(jsonPath("$.session.startedAt").exists())
                .andExpect(jsonPath("$.session.sessionId").exists());
    }

    @Test
    @DisplayName("friends/ids: 수락된 친구의 id 만 돌려준다")
    void friendIdsListAcceptedFriendsOnly() throws Exception {
        UUID me = newMember();
        UUID friend = newMember();
        UUID stranger = newMember();
        UUID pending = newMember();
        jdbc.update("insert into friendships (id, from_user_id, to_user_id, status, created_at, updated_at) "
                + "values (?, ?, ?, 'ACCEPTED', now(), now())", UUID.randomUUID(), me, friend);
        jdbc.update("insert into friendships (id, from_user_id, to_user_id, status, created_at, updated_at) "
                + "values (?, ?, ?, 'PENDING', now(), now())", UUID.randomUUID(), me, pending);

        call(get("/internal/users/" + me + "/friends/ids"), REALTIME, me, null).andExpect(status().isOk())
                .andExpect(jsonPath("$.ids.length()").value(1))
                .andExpect(jsonPath("$.ids[0]").value(friend.toString()));
        assertThat(stranger).isNotNull();
    }

    @Test
    @DisplayName("탈퇴하면 그 사용자의 한마디 행이 지워지고 남의 행은 그대로다")
    void withdrawalErasesTheRemark() throws Exception {
        UUID leaver = newMember();
        UUID bystander = newMember();
        putRemark(leaver, "떠날게요").andExpect(status().isOk());
        putRemark(bystander, "남을게요").andExpect(status().isOk());

        withdrawal.withdraw(leaver);

        assertThat(count("select count(*) from sea_remarks where user_id=?", leaver)).isZero();
        assertThat(count("select count(*) from sea_remarks where user_id=?", bystander)).isEqualTo(1);
        assertThat(remarks).isNotNull();
        // 변경 사건 봉투 속 자유 입력 원문 사본도 지운다 — 키는 남기고 값만 null, 남의 봉투는 그대로.
        assertThat(count("select count(*) from event_outbox where type='sea.member.updated' and user_id=? "
                + "and jsonb_exists(params, 'remark') and params->>'remark' is null", leaver)).isEqualTo(1);
        assertThat(count("select count(*) from event_outbox where type='sea.member.updated' and user_id=? "
                + "and params->>'remark'=?", bystander, "남을게요")).isEqualTo(1);
    }

    // ---------------------------------------------------------------- 도구

    private ResultActions putRemark(UUID user, String remark) throws Exception {
        return call(put("/internal/users/" + user + "/sea-remark"), BUSINESS, user,
                "{\"remark\":\"" + remark + "\"}");
    }

    private ResultActions getState(UUID user) throws Exception {
        return call(get("/internal/users/" + user + "/sea-state"), REALTIME, user, null);
    }

    private ResultActions call(MockHttpServletRequestBuilder request, String token, UUID user, String body)
            throws Exception {
        request.header("Authorization", "Bearer " + token)
                .header("X-User-Id", user.toString())
                .header("Idempotency-Key", UUID.randomUUID().toString());
        if (body != null) {
            request.contentType("application/json").content(body);
        }
        return mvc.perform(request);
    }

    /** 회원 — 게스트로 만든 뒤 {@code is_guest} 만 내린다. */
    private UUID newMember() {
        UUID id = newGuest();
        jdbc.update("update users set is_guest = false where id = ?", id);
        return id;
    }

    private UUID newGuest() {
        return jwt.extractUserId(auth.guestLogin().accessToken());
    }

    private long count(String sql, Object... args) {
        Long value = jdbc.queryForObject(sql, Long.class, args);
        return value == null ? 0L : value;
    }
}
