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
import java.util.UUID;

/** RT로 직접 주체를 증명하고 해당 로그인 세션을 종료한다. */
@Service
@RequiredArgsConstructor
@Slf4j
public class SessionLogoutService {
    private final JwtProvider jwt;
    private final UserQueryService users;
    private final AuthSessionService sessions;
    private final Clock clock;

    /** users → session → aggregate 순서로 종료 증거와 내구 폐기를 한 번 확정하고, 폐기한 세션 id 를 돌려준다. */
    @Transactional
    public UUID logout(String refreshToken, String accessToken) {
        LogoutToken refresh = verify(refreshToken, false);
        LogoutToken access = accessToken == null ? null : verify(accessToken, true);
        User user = users.getCallerForUpdate(refresh.userId());
        String hash = TokenHasher.sha256Hex(refreshToken);
        AuthSession session = sessions.findLogoutSessionForUpdate(hash)
                .orElseThrow(SessionLogoutService::invalidRefresh);
        validateRefresh(refresh, user, session, hash);
        validateAccess(access, refresh, user, session);
        if (!session.isActive()) {
            if (!"LOGOUT".equals(session.getRevokeReason())
                    || !refresh.expiresAt().equals(session.getLogoutRefreshExpiresAt())) {
                throw invalidRefresh();
            }
            log.info("session_logout outcome=replayed");
            return session.getId();
        }
        sessions.completeLogout(session, refresh.expiresAt());
        log.info("session_logout outcome=completed");
        return session.getId();
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
        if (!session.getUserId().equals(user.getId())
                || !hash.equals(session.getRefreshTokenHash())
                || (refresh.sessionId() != null && !refresh.sessionId().equals(session.getId()))) {
            throw invalidRefresh();
        }
    }

    private void validateAccess(LogoutToken access, LogoutToken refresh, User user, AuthSession session) {
        if (access != null && (!clock.instant().isBefore(access.expiresAt())
                || !access.userId().equals(refresh.userId())
                || !sameSession(access, session)
                || (access.generation() != null && access.generation() != user.getAuthGeneration()))) {
            throw new AccessCredentialException();
        }
    }

    /** 현재 발급 AT의 sid가 RT 해시로 찾은 세션과 일치해야 한다. */
    private static boolean sameSession(LogoutToken access, AuthSession session) {
        return access.sessionId() != null && access.sessionId().equals(session.getId());
    }

    private static InvalidTokenException invalidRefresh() {
        return new InvalidTokenException(InvalidTokenErrorCode.REFRESH_TOKEN);
    }
}
