package com.oneorthree.phone.internal;

import com.oneorthree.phone.auth.service.AuthService;
import com.oneorthree.phone.auth.support.JwtProvider;
import com.oneorthree.phone.friend.service.FriendService;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.greaterThan;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 계정당 시간 한도 (GROMO-1934)를 <b>실제 배선</b>(Flyway PostgreSQL · InternalAuthFilter · JwtFilter ·
 * 실제 {@code FriendService}/{@code InternalLetterService}/리미터 빈) 위에서 검증한다. 한도만 작게(3) 덮는다.
 *
 * <p>잡는 회귀: 한도 경계 off-by-one(1..cap 중 하나가 429 이거나 cap+1 이 통과), 게스트 판정 반전(정회원이
 * 막히거나 게스트가 안 막힘), 레거시 {@code /api/v1/friends/requests} 가 한도를 우회하는 배선, 편지에
 * 게스트 분기가 생겨 정회원이 우회, 429 가 {@code RATE_LIMITED}·{@code retryAfterMs}·{@code Retry-After}
 * 없이 나감.
 *
 * <p><b>GROMO-1992 로 친구 축의 무대가 갈렸다.</b> 2.0 내부 표면에서 게스트 친구 요청은 한도에 닿기 전에
 * 403 {@code SOCIAL_LOGIN_REQUIRED} 로 막히므로, 1934 의 게스트 한도가 실제로 도는 곳은 이제
 * <b>레거시 {@code /api/v1} 표면뿐</b> 이다(동결된 1.x 앱 보존). 그 사실 자체가 회귀 대상이다 —
 * 두 표면이 다시 같아지면 둘 중 하나가 잘못 바뀐 것이다.
 */
@SpringBootTest
@AutoConfigureMockMvc
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class PerUserRateLimitIntegrationTest {

    private static final String TOKEN = "test-rate-limit-business";
    private static final int CAP = 3;

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
        registry.add("internal.api.enabled", () -> true);
        registry.add("internal.api.callers.business.token", () -> TOKEN);
        registry.add("internal.api.callers.business.allow[0]", () -> "POST /internal/users/*/friend-requests");
        registry.add("internal.api.callers.business.allow[1]", () -> "POST /internal/users/*/letters");
        registry.add("friend.request.rate-limit.guest-max-per-hour", () -> CAP);
        registry.add("letter.send.rate-limit.max-per-hour", () -> CAP);
    }

    @Autowired
    MockMvc mvc;
    @Autowired
    AuthService auth;
    @Autowired
    JwtProvider jwt;
    @Autowired
    FriendService friendService;
    @Autowired
    JdbcTemplate jdbc;

    // ---------------------------------------------------------------- 친구 요청 (게스트만)

    @Test
    @DisplayName("게스트 친구 요청(내부 표면) — 한도 이전에 403 SOCIAL_LOGIN_REQUIRED 로 막힌다 (GROMO-1992)")
    void guestFriendRequestsAreRejectedOnInternalSurface() throws Exception {
        UUID guest = newUser();
        assertThat(isGuest(guest)).isTrue();

        // 정책 「친구 추가…를 처음 시도할 때 소셜 로그인을 요청한다」 — 2.0 표면에서는 «첫 번째» 요청부터
        // 막힌다. GROMO-1934 의 시간당 한도는 이 표면에서 도달 불가능해졌고 레거시 축에만 남는다.
        internalFriendRequest(guest, newUser())
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("SOCIAL_LOGIN_REQUIRED"));
    }

    @Test
    @DisplayName("정회원 친구 요청 — cap+1 번을 보내도 429 가 없다")
    void nonGuestFriendRequestsAreNeverCapped() throws Exception {
        UUID member = newMember();

        for (int i = 0; i < CAP + 1; i++) {
            internalFriendRequest(member, newUser()).andExpect(status().isCreated());
        }
    }

    @Test
    @DisplayName("레거시 /api/v1/friends/requests 는 게스트에게 열려 있고 같은 한도에 걸린다 — 동결된 1.x 동작 보존")
    void legacyFriendRequestSurfaceIsCappedForGuests() throws Exception {
        String accessToken = auth.guestLogin().accessToken();

        for (int i = 0; i < CAP; i++) {
            legacyFriendRequest(accessToken, newUser()).andExpect(status().isCreated());
        }
        expectRateLimited(legacyFriendRequest(accessToken, newUser()));
    }

    @Test
    @DisplayName("값싼 거절(자기 자신·중복 요청)은 카운트를 먹지 않는다 — 거절 cap+1 번 뒤에도 정상 요청 cap 번이 통과한다")
    void rejectedFriendRequestsDoNotConsumeTheCap() throws Exception {
        // 게스트 한도만 세므로 게스트가 필요하고, 게스트가 친구 요청을 보낼 수 있는 표면은 이제 레거시뿐이다.
        String accessToken = auth.guestLogin().accessToken();
        UUID guest = jwt.extractUserId(accessToken);
        UUID first = newUser();
        legacyFriendRequest(accessToken, first).andExpect(status().isCreated());

        for (int i = 0; i < CAP + 1; i++) {
            legacyFriendRequest(accessToken, guest).andExpect(status().isBadRequest());
            legacyFriendRequest(accessToken, first).andExpect(status().isConflict());
        }
        for (int i = 1; i < CAP; i++) {
            legacyFriendRequest(accessToken, newUser()).andExpect(status().isCreated());
        }
        expectRateLimited(legacyFriendRequest(accessToken, newUser()));
    }

    // ---------------------------------------------------------------- 편지 (전 계정)

    @Test
    @DisplayName("정회원 편지 발송 — 1..cap 은 201, cap+1 번째만 429 RATE_LIMITED (게스트 분기 없음)")
    void nonGuestLettersAreCapped() throws Exception {
        UUID sender = newUser();
        jdbc.update("update users set is_guest = false where id = ?", sender);
        UUID receiver = newUser();
        // 수신자 쪽에서 요청해 친구로 만든다 — 발신자의 친구 요청 한도를 건드리지 않게.
        friendService.acceptRequest(sender, friendService.createRequest(receiver, sender));

        for (int i = 0; i < CAP; i++) {
            sendLetter(sender, receiver).andExpect(status().isCreated());
        }
        expectRateLimited(sendLetter(sender, receiver));
        assertThat(jdbc.queryForObject("select count(*) from letters where sender_id = ?", Integer.class, sender))
                .as("막힌 요청은 쓰지 않는다").isEqualTo(CAP);
    }

    @Test
    @DisplayName("친구 아닌 수신자에게 보낸 거절(404)은 편지 한도를 먹지 않는다")
    void rejectedLettersDoNotConsumeTheCap() throws Exception {
        UUID sender = newUser();
        UUID stranger = newUser();
        UUID receiver = newUser();
        friendService.acceptRequest(sender, friendService.createRequest(receiver, sender));

        for (int i = 0; i < CAP + 1; i++) {
            sendLetter(sender, stranger).andExpect(status().isNotFound());
        }
        for (int i = 0; i < CAP; i++) {
            sendLetter(sender, receiver).andExpect(status().isCreated());
        }
        expectRateLimited(sendLetter(sender, receiver));
    }

    // ---------------------------------------------------------------- 도구

    private static void expectRateLimited(ResultActions result) throws Exception {
        result.andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.code").value("RATE_LIMITED"))
                .andExpect(jsonPath("$.retryAfterMs").value(greaterThan(0)))
                .andExpect(header().exists("Retry-After"));
    }

    private UUID newUser() {
        return jwt.extractUserId(auth.guestLogin().accessToken());
    }

    /** 게스트로 만든 뒤 회원으로 승격시킨다 — 소셜 어댑터 없이 {@code is_guest} 만 필요한 테스트용. */
    private UUID newMember() {
        UUID id = newUser();
        jdbc.update("update users set is_guest = false where id = ?", id);
        return id;
    }

    private boolean isGuest(UUID userId) {
        return Boolean.TRUE.equals(jdbc.queryForObject("select is_guest from users where id = ?", Boolean.class, userId));
    }

    private ResultActions internalFriendRequest(UUID actor, UUID target) throws Exception {
        return mvc.perform(post("/internal/users/" + actor + "/friend-requests")
                .header("Authorization", "Bearer " + TOKEN)
                .header("X-User-Id", actor.toString())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"targetUserId\":\"" + target + "\"}"));
    }

    private ResultActions legacyFriendRequest(String accessToken, UUID target) throws Exception {
        return mvc.perform(post("/api/v1/friends/requests")
                .header("Authorization", "Bearer " + accessToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"targetUserId\":\"" + target + "\"}"));
    }

    private ResultActions sendLetter(UUID from, UUID to) throws Exception {
        return mvc.perform(post("/internal/users/" + from + "/letters")
                .header("Authorization", "Bearer " + TOKEN)
                .header("X-User-Id", from.toString())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"receiverId\":\"" + to + "\",\"content\":\"안녕\"}"));
    }
}
