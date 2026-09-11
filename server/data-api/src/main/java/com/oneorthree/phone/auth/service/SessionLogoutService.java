package com.oneorthree.phone.auth.service;

import com.oneorthree.phone.auth.exception.AccessCredentialException;
import com.oneorthree.phone.auth.exception.InvalidTokenErrorCode;
import com.oneorthree.phone.auth.exception.InvalidTokenException;
import com.oneorthree.phone.auth.repository.domain.AuthSession;
import com.oneorthree.phone.auth.support.JwtProvider;
import com.oneorthree.phone.auth.support.JwtProvider.LogoutToken;
import com.oneorthree.phone.auth.support.TokenHasher;
import com.oneorthree.phone.user.repository.UserQueryService;
import com.oneorthree.phone.user.repository.domain.User;
import io.jsonwebtoken.JwtException;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.util.Objects;

/** RT로 직접 주체를 증명하는 신규 종료. 기존 AuthService.logout의 호환 동작과 분리한다. */
@Service
@RequiredArgsConstructor
@Slf4j
public class SessionLogoutService {
    private final JwtProvider jwt;
    private final UserQueryService users;
    private final AuthSessionService sessions;
    private final Clock clock;

    /** users → session → aggregate 순서로 종료 증거와 내구 폐기를 한 번 확정한다. */
    @Transactional
    public void logout(String refreshToken, String accessToken) {
        LogoutToken refresh = verify(refreshToken, false);
        LogoutToken access = accessToken == null ? null : verify(accessToken, true);
        User user = users.getCallerForUpdate(refresh.userId());
        String hash = TokenHasher.sha256Hex(refreshToken);
        AuthSession session = sessions.findLogoutSessionForUpdate(hash).orElse(null);
        validateRefresh(refresh, user, session, hash);
        validateAccess(access, refresh, user);
        if (session != null && !session.isActive()) {
            if (!"LOGOUT".equals(session.getRevokeReason())
                    || !refresh.expiresAt().equals(session.getLogoutRefreshExpiresAt())) {
                throw invalidRefresh();
            }
            log.info("session_logout outcome=replayed");
            return;
        }
        if (session == null) {
            session = sessions.createLegacyLogoutSession(user.getId(), hash);
        }
        // 늦게 도착한 A의 종료는 B의 최신 users RT 해시를 지우지 않는다.
        if (hash.equals(user.getRefreshTokenHash())) {
            user.setRefreshTokenHash(null);
        }
        sessions.completeLogout(session, refresh.expiresAt());
        log.info("session_logout outcome=completed");
    }

    private LogoutToken verify(String token, boolean access) {
        try {
            if (token == null || token.isBlank() || token.length() > 8192) {
                throw new IllegalArgumentException("종료 자격이 필요합니다.");
            }
            return jwt.verifyLogoutToken(token, access ? JwtProvider.TYPE_ACCESS : JwtProvider.TYPE_REFRESH);
        } catch (JwtException | IllegalArgumentException e) {
            if (access) {
                throw new AccessCredentialException();
            }
            throw invalidRefresh();
        }
    }

    private void validateRefresh(LogoutToken refresh, User user, AuthSession session, String hash) {
        // 락 대기 중 만료되거나 회전한 자격도 최초 파싱 성공만으로 통과시키지 않는다.
        if (!clock.instant().isBefore(refresh.expiresAt())
                || (refresh.generation() != null && refresh.generation() != user.getAuthGeneration())) {
            throw invalidRefresh();
        }
        if (session == null) {
            if (refresh.sessionId() != null || !hash.equals(user.getRefreshTokenHash())) {
                throw invalidRefresh();
            }
        } else if (!session.getUserId().equals(user.getId())
                || !hash.equals(session.getRefreshTokenHash())
                || (refresh.sessionId() != null && !refresh.sessionId().equals(session.getId()))) {
            throw invalidRefresh();
        }
    }

    private void validateAccess(LogoutToken access, LogoutToken refresh, User user) {
        if (access != null && (!clock.instant().isBefore(access.expiresAt())
                || !access.userId().equals(refresh.userId())
                || !Objects.equals(access.sessionId(), refresh.sessionId())
                || (access.generation() != null && access.generation() != user.getAuthGeneration()))) {
            throw new AccessCredentialException();
        }
    }

    private static InvalidTokenException invalidRefresh() {
        return new InvalidTokenException(InvalidTokenErrorCode.REFRESH_TOKEN);
    }
}
