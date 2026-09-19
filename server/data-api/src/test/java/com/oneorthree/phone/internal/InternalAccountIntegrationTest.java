package com.oneorthree.phone.internal;

import com.oneorthree.phone.auth.dto.res.GuestLoginResponse;
import com.oneorthree.phone.auth.service.AuthService;
import com.oneorthree.phone.auth.support.JwtProvider;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.group.repository.domain.GroupMemberRole;
import com.oneorthree.phone.internal.dto.LoginAttemptLookupRequest;
import com.oneorthree.phone.internal.service.InternalAccountService;
import com.oneorthree.phone.internal.service.LoginAttemptService;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import com.oneorthree.phone.user.exception.UserErrorCode;
import com.oneorthree.phone.user.exception.UserException;
import com.oneorthree.phone.user.repository.domain.Provider;
import com.oneorthree.phone.user.repository.domain.SocialAccount;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.user.dto.UserProfileSetupRequest;
import com.oneorthree.phone.user.dto.UserProfileUpdateRequest;
import com.oneorthree.phone.user.service.UserService;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Instant;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 계정 내부 표면 3종 (GROMO-1801·1945) — 실제 Flyway·{@code ddl-auto=validate} PostgreSQL, 등록된
 * {@code InternalAuthFilter}, 생산 서비스로 검증한다. 목 seam 은 없다.
 */
@SpringBootTest
@AutoConfigureMockMvc
class InternalAccountIntegrationTest {

    private static final String TOKEN = "test-account-business-to-data";

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
        registry.add("internal.api.enabled", () -> true);
        registry.add("internal.api.callers.business.token", () -> TOKEN);
        registry.add("internal.api.callers.business.allow[0]", () -> "GET /internal/users/*");
        registry.add("internal.api.callers.business.allow[1]", () -> "PATCH /internal/users/*");
        registry.add("internal.api.callers.business.allow[2]", () -> "DELETE /internal/users/*");
    }

    @Autowired
    MockMvc mvc;
    @Autowired
    AuthService auth;
    @Autowired
    JwtProvider jwt;
    @Autowired
    LoginAttemptService loginAttempts;
    @Autowired
    JdbcTemplate jdbc;
    @Autowired
    PlatformTransactionManager transactions;
    @Autowired
    InternalAccountService accountService;
    @Autowired
    UserService userService;
    @PersistenceContext
    EntityManager em;

    @Test
    @DisplayName("GET — 연동 provider 는 활성만 소문자·중복 제거·정렬, 온보딩은 이름과 고양이 색을 모두 가져야 완료")
    void meShape() throws Exception {
        Actor guest = actor();
        me(guest).andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(guest.userId().toString()))
                .andExpect(jsonPath("$.name").doesNotExist())
                .andExpect(jsonPath("$.catColor").value(nullValue()))
                .andExpect(jsonPath("$.linkedProviders").isEmpty())
                .andExpect(jsonPath("$.onboardingComplete").value(false))
                .andExpect(jsonPath("$.data").doesNotExist());

        Actor linked = actor();
        tx().executeWithoutResult(status -> {
            User user = em.find(User.class, linked.userId());
            em.persist(SocialAccount.builder().user(user).provider(Provider.KAKAO).providerId("k-" + user.getId())
                    .build());
            em.persist(SocialAccount.builder().user(user).provider(Provider.APPLE).providerId("a-" + user.getId())
                    .build());
            SocialAccount unlinked = SocialAccount.builder().user(user).provider(Provider.GOOGLE)
                    .providerId("g-" + user.getId()).build();
            em.persist(unlinked);
            unlinked.setDeletedAt(Instant.now());
        });
        rename(linked, UUID.randomUUID(), "{\"name\":\"" + uniqueName() + "\"}").andExpect(status().isOk());
        // 이름만으로는 완료가 아니다(Q04)
        me(linked).andExpect(jsonPath("$.catColor").value(nullValue()))
                .andExpect(jsonPath("$.onboardingComplete").value(false));
        rename(linked, UUID.randomUUID(), "{\"catColor\":\"calico\"}").andExpect(status().isOk());
        me(linked).andExpect(status().isOk())
                .andExpect(jsonPath("$.catColor").value("calico"))
                .andExpect(jsonPath("$.linkedProviders.length()").value(2))
                .andExpect(jsonPath("$.linkedProviders[0]").value("apple"))
                .andExpect(jsonPath("$.linkedProviders[1]").value("kakao"))
                .andExpect(jsonPath("$.onboardingComplete").value(true));
    }

    @Test
    @DisplayName("PATCH — 3필드 응답, 같은 키·본문은 최초 결과 재생, 다른 본문은 409, 중복·형식은 기존 닉네임 코드")
    void patchNameContract() throws Exception {
        Actor actor = actor();
        Actor other = actor();
        String name = uniqueName();
        UUID key = UUID.randomUUID();
        rename(actor, key, "{\"name\":\"  " + name + " \"}").andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(actor.userId().toString()))
                .andExpect(jsonPath("$.name").value(name))
                .andExpect(jsonPath("$.catColor").value(nullValue()))
                .andExpect(jsonPath("$.onboardingComplete").doesNotExist());

        // 다른 키로 이름을 바꾼 뒤에도 같은 키·본문은 최초 결과를 재생한다
        String later = uniqueName();
        rename(actor, UUID.randomUUID(), "{\"name\":\"" + later + "\"}").andExpect(status().isOk());
        rename(actor, key, "{\"name\":\"  " + name + " \"}").andExpect(status().isOk())
                .andExpect(jsonPath("$.name").value(name));
        assertThat(nickname(actor)).isEqualTo(later);
        rename(actor, key, "{\"name\":\"" + uniqueName() + "\"}").andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("IDEMPOTENCY_KEY_CONFLICT"));

        rename(other, UUID.randomUUID(), "{\"name\":\"" + later + "\"}").andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("NICKNAME_DUPLICATE"));
        rename(other, UUID.randomUUID(), "{\"name\":\" a \"}").andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("NICKNAME_INVALID"));
        assertThat(nickname(other)).isNull();
    }

    @Test
    @DisplayName("PATCH 스위치가 닫히면 receipt·이름 변경 전에 503 PROFILE_UPDATE_UNAVAILABLE — GET 은 그대로")
    void patchIsClosedBySwitch() throws Exception {
        Actor actor = actor();
        ReflectionTestUtils.setField(accountService, "profileUpdateEnabled", false);
        try {
            rename(actor, UUID.randomUUID(), "{\"name\":\"" + uniqueName() + "\"}")
                    .andExpect(status().isServiceUnavailable())
                    .andExpect(jsonPath("$.code").value("PROFILE_UPDATE_UNAVAILABLE"));
            me(actor).andExpect(status().isOk());
        } finally {
            ReflectionTestUtils.setField(accountService, "profileUpdateEnabled", true);
        }
        assertThat(nickname(actor)).isNull();
        assertThat(jdbc.queryForObject("select count(*) from command_idempotency where user_id=?", Long.class,
                actor.userId())).isZero();
    }

    @ParameterizedTest
    @ValueSource(strings = {"{}", "{\"name\":null}", "{\"name\":1}", "{\"name\":\"수빈\",\"extra\":1}",
            "{\"catColor\":null}", "{\"catColor\":1}", "{\"catColor\":\"purple\"}", "{\"catColor\":\"Black\"}",
            "null"})
    @DisplayName("PATCH — 빈 객체·명시 null·타입 오류·미지 필드는 저장 전에 400")
    void patchRejectsMalformedBody(String body) throws Exception {
        Actor actor = actor();
        rename(actor, UUID.randomUUID(), body).andExpect(status().isBadRequest());
        assertThat(nickname(actor)).isNull();
        assertThat(catColor(actor)).isNull();
        assertThat(jdbc.queryForObject("select count(*) from command_idempotency where user_id=?", Long.class,
                actor.userId())).isZero();
    }

    @Test
    @DisplayName("PATCH — 이름·색이 모두 갖춰지는 순간 같은 TX 에 user.onboarded 가 정확히 한 번, 재생·true→true 는 새 사건 없음")
    void onboardingTransitionRecordsOneEvent() throws Exception {
        Actor actor = actor();
        rename(actor, UUID.randomUUID(), "{\"catColor\":\"gray\"}").andExpect(status().isOk())
                .andExpect(jsonPath("$.catColor").value("gray"));
        assertThat(onboardedEvents(actor)).isZero();

        UUID key = UUID.randomUUID();
        String body = "{\"name\":\"" + uniqueName() + "\"}";
        rename(actor, key, body).andExpect(status().isOk());
        assertThat(onboardedEvents(actor)).isEqualTo(1L);
        assertThat(jdbc.queryForList("select d.target from event_outbox_deliveries d join event_outbox o"
                + " on o.id = d.outbox_id where o.event_id = ?", String.class, "user.onboarded:" + actor.userId()))
                .containsExactly("SCORE");
        // receipt events 에 같은 봉투가 실린다
        assertThat(jdbc.queryForObject("select count(*) from command_idempotency where user_id=?"
                + " and response_body::text like '%user.onboarded%'", Long.class, actor.userId())).isEqualTo(1L);

        rename(actor, key, body).andExpect(status().isOk());
        rename(actor, UUID.randomUUID(), "{\"catColor\":\"white\",\"name\":\"" + uniqueName() + "\"}")
                .andExpect(status().isOk());
        assertThat(onboardedEvents(actor)).isEqualTo(1L);
        me(actor).andExpect(jsonPath("$.onboardingComplete").value(true))
                .andExpect(jsonPath("$.catColor").value("white"));
    }

    @Test
    @DisplayName("완료 전이 뒤 TX 가 롤백되면 프로필·사건 모두 남지 않는다 · 이름 거절이면 함께 온 색도 저장되지 않는다")
    void rollbackLeavesNoEvent() throws Exception {
        Actor actor = actor();
        tx().executeWithoutResult(status -> {
            var change = userService.updatePublicProfile(actor.userId(), uniqueName(), "cream");
            assertThat(change.events()).hasSize(1);
            status.setRollbackOnly();
        });
        assertThat(nickname(actor)).isNull();
        assertThat(catColor(actor)).isNull();
        assertThat(onboardedEvents(actor)).isZero();

        Actor other = actor();
        String taken = uniqueName();
        rename(other, UUID.randomUUID(), "{\"name\":\"" + taken + "\"}").andExpect(status().isOk());
        rename(actor, UUID.randomUUID(), "{\"name\":\"" + taken + "\",\"catColor\":\"cream\"}")
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("NICKNAME_DUPLICATE"));
        assertThat(catColor(actor)).isNull();
        assertThat(onboardedEvents(actor)).isZero();
    }

    @Test
    @DisplayName("legacy POST/PATCH /api/v1/users/me writer 도 같은 전이 경계로 user.onboarded 를 한 번 낸다")
    void legacyWritersShareTheTransition() throws Exception {
        Actor setup = actor();
        rename(setup, UUID.randomUUID(), "{\"catColor\":\"black\"}").andExpect(status().isOk());
        userService.setupProfile(setup.userId(), new UserProfileSetupRequest(uniqueName(), null, 0, 0, null));
        assertThat(onboardedEvents(setup)).isEqualTo(1L);
        userService.setupProfile(setup.userId(), new UserProfileSetupRequest(uniqueName(), null, 0, 0, null));
        assertThat(onboardedEvents(setup)).isEqualTo(1L);

        Actor update = actor();
        userService.updateProfile(update.userId(),
                new UserProfileUpdateRequest(uniqueName(), null, null, null, null));
        assertThat(onboardedEvents(update)).as("색이 없으면 legacy 이름 저장만으로는 완료가 아니다").isZero();
        rename(update, UUID.randomUUID(), "{\"catColor\":\"ginger\"}").andExpect(status().isOk());
        assertThat(onboardedEvents(update)).isEqualTo(1L);
        userService.updateProfile(update.userId(),
                new UserProfileUpdateRequest(uniqueName(), null, null, null, null));
        assertThat(onboardedEvents(update)).isEqualTo(1L);
    }

    @Test
    @DisplayName("세션 폐기·세대 불일치·타 세션은 403 SESSION_NOT_ACTIVE — Business 가 401 로 옮긴다")
    void revokedSessionIsRejectedBeforeReadOrWrite() throws Exception {
        Actor actor = actor();
        Actor other = actor();
        mvc.perform(internal(get(path(actor)), actor.userId(), other.sessionId(), 0))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("SESSION_NOT_ACTIVE"));
        mvc.perform(internal(get(path(actor)), actor.userId(), actor.sessionId(), 1))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("SESSION_NOT_ACTIVE"));
        auth.logout(new com.oneorthree.phone.auth.dto.req.LogoutRequest(actor.login().refreshToken()));
        me(actor).andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("SESSION_NOT_ACTIVE"));
        rename(actor, UUID.randomUUID(), "{\"name\":\"" + uniqueName() + "\"}").andExpect(status().isForbidden());
        withdraw(actor).andExpect(status().isForbidden());
        assertThat(deleted(actor)).isFalse();
    }

    @Test
    @DisplayName("DELETE — 200 deleted, 뒤이은 GET·재시도·옛 PATCH 키 재생은 404 USER_NOT_FOUND, 옛 AT·RT 는 401")
    void withdrawThenEverythingIsGone() throws Exception {
        Actor actor = actor();
        UUID patchKey = UUID.randomUUID();
        String name = uniqueName();
        rename(actor, patchKey, "{\"name\":\"" + name + "\"}").andExpect(status().isOk());

        withdraw(actor).andExpect(status().isOk()).andExpect(jsonPath("$.deleted").value(true));

        assertThat(deleted(actor)).isTrue();
        me(actor).andExpect(status().isNotFound()).andExpect(jsonPath("$.code").value("USER_NOT_FOUND"));
        withdraw(actor).andExpect(status().isNotFound()).andExpect(jsonPath("$.code").value("USER_NOT_FOUND"));
        rename(actor, patchKey, "{\"name\":\"" + name + "\"}").andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("USER_NOT_FOUND"));
        // 개인 응답(이름)이 든 공개 receipt 는 탈퇴 TX 가 지웠다
        assertThat(jdbc.queryForObject("select count(*) from command_idempotency where user_id=?"
                + " and command_type like 'public:v1:%'", Long.class, actor.userId())).isZero();

        // 옛 자격은 legacy 경로에서도 통하지 않는다
        mvc.perform(get("/api/v1/users/me").header("Authorization", "Bearer " + actor.login().accessToken()))
                .andExpect(status().isUnauthorized());
        mvc.perform(post("/api/v1/auth/refresh").contentType("application/json")
                        .content("{\"refreshToken\":\"" + actor.login().refreshToken() + "\"}"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("DELETE — 다른 주민이 있는 섬의 방장은 400 HOST_WITHDRAW 이고 아무것도 바뀌지 않는다")
    void hostOfPopulatedIslandCannotWithdraw() throws Exception {
        Actor host = actor();
        Actor resident = actor();
        tx().executeWithoutResult(status -> {
            Group group = Group.builder().name("섬" + UUID.randomUUID().toString().substring(0, 6)).maxMembers(10)
                    .build();
            em.persist(group);
            em.persist(GroupMember.builder().group(group).user(em.find(User.class, host.userId()))
                    .role(GroupMemberRole.OWNER).build());
            em.persist(GroupMember.builder().group(group).user(em.find(User.class, resident.userId()))
                    .role(GroupMemberRole.MEMBER).build());
        });

        withdraw(host).andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("HOST_WITHDRAW"));

        assertThat(deleted(host)).isFalse();
        me(host).andExpect(status().isOk());
        assertThat(jdbc.queryForObject("select count(*) from auth_sessions where user_id=? and revoked_at is null",
                Long.class, host.userId())).isEqualTo(1L);
    }

    @Test
    @DisplayName("탈퇴 뒤 로그인 시도 재생은 digest 대조 전에 404 USER_NOT_FOUND 다 (계정 LLD §1·§3)")
    void loginAttemptReplayAfterWithdrawalIsUserNotFound() throws Exception {
        Actor actor = actor();
        UUID attemptId = UUID.randomUUID();
        Instant now = Instant.now();
        jdbc.update("insert into login_attempts (attempt_id, status, digest_key_id, credential_digest, provider,"
                        + " credential_kind, terms_version, user_id, session_id, onboarding_complete,"
                        + " claimed_at, completed_at, recovery_expires_at) values"
                        + " (?, 'COMPLETED', 'k1', 'digest', 'APPLE', 'id_token', 't1', ?, ?, false, ?, ?, ?)",
                attemptId, actor.userId(), actor.sessionId(), java.sql.Timestamp.from(now),
                java.sql.Timestamp.from(now), java.sql.Timestamp.from(now.plusSeconds(300)));

        withdraw(actor).andExpect(status().isOk());

        assertThat(jdbc.queryForMap("select status, digest_key_id, credential_digest from login_attempts"
                + " where attempt_id=?", attemptId))
                .containsEntry("status", "INVALIDATED").containsEntry("digest_key_id", null)
                .containsEntry("credential_digest", null);
        assertThatThrownBy(() -> loginAttempts.lookup(new LoginAttemptLookupRequest(attemptId, "k1", "digest")))
                .isInstanceOfSatisfying(UserException.class,
                        e -> assertThat(e.getErrorCode()).isEqualTo(UserErrorCode.USER_NOT_FOUND));
    }

    // ---------------------------------------------------------------- 도구

    private Actor actor() {
        GuestLoginResponse login = auth.guestLogin();
        return new Actor(jwt.extractUserId(login.accessToken()), login.sessionId(), login);
    }

    private ResultActions me(Actor actor) throws Exception {
        return mvc.perform(internal(get(path(actor)), actor.userId(), actor.sessionId(), 0));
    }

    private ResultActions rename(Actor actor, UUID key, String body) throws Exception {
        return mvc.perform(internal(patch(path(actor)), actor.userId(), actor.sessionId(), 0)
                .header("Idempotency-Key", key).contentType("application/json").content(body));
    }

    private ResultActions withdraw(Actor actor) throws Exception {
        return mvc.perform(internal(delete(path(actor)), actor.userId(), actor.sessionId(), 0));
    }

    private static MockHttpServletRequestBuilder internal(MockHttpServletRequestBuilder request, UUID userId,
                                                          UUID sessionId, long generation) {
        return request.header("Authorization", "Bearer " + TOKEN).header("X-User-Id", userId)
                .header("X-Session-Id", sessionId).header("X-Auth-Generation", generation);
    }

    private static String path(Actor actor) {
        return "/internal/users/" + actor.userId();
    }

    private String nickname(Actor actor) {
        return jdbc.queryForObject("select nickname from users where id=?", String.class, actor.userId());
    }

    private String catColor(Actor actor) {
        return jdbc.queryForObject("select cat_color from users where id=?", String.class, actor.userId());
    }

    private long onboardedEvents(Actor actor) {
        return jdbc.queryForObject("select count(*) from event_outbox where type = 'user.onboarded' and user_id = ?",
                Long.class, actor.userId());
    }

    private boolean deleted(Actor actor) {
        return Boolean.TRUE.equals(jdbc.queryForObject("select is_deleted from users where id=?", Boolean.class,
                actor.userId()));
    }

    /** 닉네임 2~10자 — 공유 DB 의 다른 테스트와 겹치지 않게 무작위 접미를 붙인다. */
    private static String uniqueName() {
        return "고양" + UUID.randomUUID().toString().substring(0, 6);
    }

    private TransactionTemplate tx() {
        return new TransactionTemplate(transactions);
    }

    private record Actor(UUID userId, UUID sessionId, GuestLoginResponse login) {
    }
}
