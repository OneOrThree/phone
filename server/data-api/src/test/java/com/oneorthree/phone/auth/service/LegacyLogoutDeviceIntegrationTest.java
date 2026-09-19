package com.oneorthree.phone.auth.service;

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
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * AT 없이 보내는 구 앱 RT 로그아웃도 이관된 기기의 삭제를 같은 DB 커밋에 남긴다.
 *
 * <p>{@code POST /api/v1/auth/logout} HTTP 경로는 GROMO-1947 에서 지웠다. {@link AuthService#logout} 은
 * 남아 있어 서비스 단위 검증만 유지한다.
 */
@SpringBootTest
class LegacyLogoutDeviceIntegrationTest {
    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
    }

    @Autowired AuthService auth;
    @Autowired JwtProvider jwt;
    @Autowired AuthSessionRepository sessions;
    @Autowired UserRepository users;
    @Autowired EventOutboxRepository outbox;
    @Autowired PlatformTransactionManager manager;

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
