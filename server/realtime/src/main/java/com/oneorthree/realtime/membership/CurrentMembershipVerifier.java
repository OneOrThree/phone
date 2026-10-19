package com.oneorthree.realtime.membership;

import com.oneorthree.realtime.auth.JwtValidator;
import com.oneorthree.realtime.common.exception.UpstreamRejectedCredentialException;
import com.oneorthree.realtime.membership.client.RealtimeMembershipAuthorizationClient;
import com.oneorthree.realtime.message.exception.ChatErrorCode;
import com.oneorthree.realtime.message.exception.ChatException;

import java.time.Clock;
import java.util.UUID;

/** 기존 그룹별 관문에서만 사용한다. 모든 이벤트/연결의 인가를 대신하지 않는다. */
public class CurrentMembershipVerifier {
    private final JwtValidator jwt;
    private final RealtimeMembershipAuthorizationClient client;
    private final Clock clock;
    /** null 이면 캐시 없음 — 매 요청 원격 판정. */
    private final CurrentMembershipDecisionCache cache;

    public CurrentMembershipVerifier(JwtValidator jwt, RealtimeMembershipAuthorizationClient client, Clock clock) {
        this(jwt, client, clock, null);
    }

    public CurrentMembershipVerifier(JwtValidator jwt, RealtimeMembershipAuthorizationClient client, Clock clock,
            CurrentMembershipDecisionCache cache) {
        this.jwt = jwt;
        this.client = client;
        this.clock = clock;
        this.cache = cache;
    }

    public void requireMember(UUID islandId, UUID expectedUserId, String bearer) {
        check(islandId, expectedUserId, bearer, true);
    }

    /**
     * 캐시를 읽지 않고 원격 판정만 쓴다 — 강퇴 재검사({@code ChatAccessGuard.requireMemberUncached}) 전용.
     * 섬 전체 재검사(memberUserId 없는 MEMBER_REMOVED)는 사용자별 evict 가 없으므로, 캐시된 허용으로 통과하면
     * 강퇴된 사용자의 이동 구독이 다시 살아난다(codex 게이트). 거절이면 그 사용자의 허용 항목을 지운다.
     */
    public void requireMemberUncached(UUID islandId, UUID expectedUserId, String bearer) {
        check(islandId, expectedUserId, bearer, false);
    }

    private void check(UUID islandId, UUID expectedUserId, String bearer, boolean useCache) {
        String token = bearer != null && bearer.startsWith("Bearer ") ? bearer.substring(7) : null;
        var identity = jwt.extractSessionProof(token)
                .filter(value -> value.userId().equals(expectedUserId))
                .orElseThrow(UpstreamRejectedCredentialException::new);
        boolean allowed = useCache && cache != null && cache.isAllowed(identity, islandId);
        if (!allowed) {
            long mark = cache == null ? 0 : cache.mark(identity.userId());
            allowed = client.isAllowed(identity, islandId);
            if (cache != null) {
                if (allowed) {
                    cache.remember(identity, islandId, mark); // 거절은 캐시하지 않는다
                } else if (!useCache) {
                    cache.evictUser(identity.userId()); // 재검사 거절 — 남아 있던 허용을 지워 다음 조회도 거절
                }
            }
        }
        // RPC 대기 중 만료도 차단한다. DB active 세션이 AT 수명을 연장하지 않는다.
        if (!identity.expiresAt().isAfter(clock.instant())) {
            throw new UpstreamRejectedCredentialException();
        }
        if (!allowed) {
            throw new ChatException(ChatErrorCode.NOT_A_MEMBER);
        }
    }
}
