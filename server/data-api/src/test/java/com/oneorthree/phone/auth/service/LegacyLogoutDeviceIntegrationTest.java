package com.oneorthree.phone.auth.service;

import com.oneorthree.phone.auth.AuthController;
import com.oneorthree.phone.auth.dto.req.LogoutRequest;
import com.oneorthree.phone.auth.dto.res.GuestLoginResponse;
import com.oneorthree.phone.auth.dto.res.TokenRefreshResponse;
import com.oneorthree.phone.auth.repository.AuthSessionRepository;
import com.oneorthree.phone.auth.support.JwtProvider;
import com.oneorthree.phone.auth.support.TokenHasher;
import com.oneorthree.phone.outbox.repository.EventOutboxRepository;
import com.oneorthree.phone.outbox.repository.domain.EventOutbox;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import com.oneorthree.phone.user.repository.UserRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** AT 없이 보내는 구 앱 RT 로그아웃도 이관된 기기의 삭제를 같은 DB 커밋에 남긴다. */
@SpringBootTest
class LegacyLogoutDeviceIntegrationTest {
    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
    }

    @Autowired AuthService auth;
    @Autowired AuthController controller;
    @Autowired JwtProvider jwt;
    @Autowired AuthSessionRepository sessions;
    @Autowired UserRepository users;
    @Autowired EventOutboxRepository outbox;
    @Autowired PlatformTransactionManager manager;

    @Test
    void theUnmodifiedRefreshTokenOnlyHttpRequestDurablyDeletesTheLegacyDevice() throws Exception {
        GuestLoginResponse login = legacyLogin();
        UUID user = jwt.extractUserId(login.accessToken());
        var http = MockMvcBuilders.standaloneSetup(controller).build();
        String body = "{\"refreshToken\":\"" + login.refreshToken() + "\"}";
        // 기존 앱의 logout()처럼 AT와 기기 토큰을 보내지 않는다. 만료 AT DELETE 성공에 의존하지 않는다.
        http.perform(post("/api/v1/auth/logout").contentType("application/json").content(body))
                .andExpect(status().isNoContent());
        http.perform(post("/api/v1/auth/logout").contentType("application/json").content(body))
                .andExpect(status().isNoContent());
        assertThat(deletions(user)).singleElement().satisfies(event -> assertThat(event.getParams())
                .containsEntry("deviceToken", "legacy-device"));
        assertThat(users.findById(user).orElseThrow().getDeviceToken()).isNull();
        assertThat(sessions.findByRefreshTokenHash(TokenHasher.sha256Hex(login.refreshToken()))
                .orElseThrow().isActive()).isFalse();
    }

    @Test
    void promotionPreservesTheOriginalDeviceWhenAnotherSessionChangesTheUserScalar() {
        GuestLoginResponse login = legacyLogin();
        UUID user = jwt.extractUserId(login.accessToken());
        TokenRefreshResponse promoted = auth.refreshToken(login.refreshToken());
        tx().executeWithoutResult(status -> {
            var current = users.findActiveByIdForUpdate(user).orElseThrow();
            current.setDeviceToken("another-device");
            current.setRefreshTokenHash(TokenHasher.sha256Hex("another-refresh"));
        });
        auth.logout(new LogoutRequest(promoted.refreshToken()));
        assertThat(deletions(user)).singleElement().satisfies(event -> assertThat(event.getParams())
                .containsEntry("deviceToken", "legacy-device"));
        assertThat(users.findById(user).orElseThrow().getDeviceToken()).isEqualTo("another-device");
        assertThat(users.findById(user).orElseThrow().getRefreshTokenHash())
                .isEqualTo(TokenHasher.sha256Hex("another-refresh"));
        assertThat(sessions.findById(promoted.sessionId()).orElseThrow().isActive()).isFalse();
    }

    @Test
    void aModernSessionDoesNotGuessThatTheUserScalarBelongsToItsDevice() {
        GuestLoginResponse login = auth.guestLogin();
        UUID user = jwt.extractUserId(login.accessToken());
        tx().executeWithoutResult(status -> users.findActiveByIdForUpdate(user).orElseThrow()
                .setDeviceToken("some-other-legacy-device"));
        auth.logout(new LogoutRequest(login.refreshToken()));
        assertThat(deletions(user)).isEmpty();
        assertThat(users.findById(user).orElseThrow().getDeviceToken()).isEqualTo("some-other-legacy-device");
    }

    @Test
    void rollbackKeepsTheLegacyRefreshAndDeviceTogether() {
        GuestLoginResponse login = legacyLogin();
        UUID user = jwt.extractUserId(login.accessToken());
        tx().executeWithoutResult(status -> {
            auth.logout(new LogoutRequest(login.refreshToken()));
            status.setRollbackOnly();
        });
        assertThat(deletions(user)).isEmpty();
        assertThat(users.findById(user).orElseThrow().getDeviceToken()).isEqualTo("legacy-device");
        assertThat(users.findById(user).orElseThrow().getRefreshTokenHash())
                .isEqualTo(TokenHasher.sha256Hex(login.refreshToken()));
        assertThat(sessions.findByRefreshTokenHash(TokenHasher.sha256Hex(login.refreshToken()))).isEmpty();
    }

    private GuestLoginResponse legacyLogin() {
        GuestLoginResponse login = auth.guestLogin();
        UUID user = jwt.extractUserId(login.accessToken());
        tx().executeWithoutResult(status -> {
            sessions.deleteById(login.sessionId());
            users.findActiveByIdForUpdate(user).orElseThrow().setDeviceToken("legacy-device");
        });
        return login;
    }

    private List<EventOutbox> deletions(UUID user) {
        return outbox.findAll().stream().filter(event -> event.getUserId().equals(user)
                && event.getType().equals("notification.legacyDeviceToken.deleted")).toList();
    }

    private TransactionTemplate tx() {
        return new TransactionTemplate(manager);
    }
}
