package com.oneorthree.realtime.membership;

import com.oneorthree.realtime.auth.JwtValidator;
import com.oneorthree.realtime.common.exception.UpstreamRejectedCredentialException;
import com.oneorthree.realtime.membership.client.RealtimeMembershipAuthorizationClient;
import com.oneorthree.realtime.message.exception.ChatErrorCode;
import com.oneorthree.realtime.message.exception.ChatException;
import lombok.RequiredArgsConstructor;

import java.time.Clock;
import java.util.UUID;

/** 기존 그룹별 관문에서만 사용한다. 모든 이벤트/연결의 인가를 대신하지 않는다. */
@RequiredArgsConstructor
public class CurrentMembershipVerifier {
    private final JwtValidator jwt;
    private final RealtimeMembershipAuthorizationClient client;
    private final Clock clock;

    public void requireMember(UUID islandId, UUID expectedUserId, String bearer) {
        String token = bearer != null && bearer.startsWith("Bearer ") ? bearer.substring(7) : null;
        var identity = jwt.extractSessionProof(token)
                .filter(value -> value.userId().equals(expectedUserId))
                .orElseThrow(UpstreamRejectedCredentialException::new);
        boolean allowed = client.isAllowed(identity, islandId);
        // RPC 대기 중 만료도 차단한다. DB active 세션이 AT 수명을 연장하지 않는다.
        if (!identity.expiresAt().isAfter(clock.instant())) {
            throw new UpstreamRejectedCredentialException();
        }
        if (!allowed) {
            throw new ChatException(ChatErrorCode.NOT_A_MEMBER);
        }
    }
}
