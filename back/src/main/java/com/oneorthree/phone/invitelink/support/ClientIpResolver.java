package com.oneorthree.phone.invitelink.support;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.stereotype.Component;

/**
 * 클라이언트 실제 IP 를 뽑는다 — prod 토폴로지(Cloudflare → nginx → app) 기준.
 *
 * <p>신뢰 순서가 곧 정확도다. {@code CF-Connecting-IP} 는 Cloudflare 가 매 요청 덮어쓰므로
 * 가장 믿을 만하고, 그다음이 {@code X-Forwarded-For} 첫 토큰(원 클라이언트), 마지막이 remoteAddr 다.
 * remoteAddr 만 쓰면 모든 클릭이 nginx IP 하나로 뭉쳐 서로 매치돼버린다.
 */
@Component
public class ClientIpResolver {

    private static final String CF_CONNECTING_IP = "CF-Connecting-IP";
    private static final String X_FORWARDED_FOR = "X-Forwarded-For";
    private static final String UNKNOWN = "unknown";

    public String resolve(HttpServletRequest request) {
        String cloudflareIp = request.getHeader(CF_CONNECTING_IP);
        if (hasText(cloudflareIp)) {
            return cloudflareIp.trim();
        }

        String forwardedFor = request.getHeader(X_FORWARDED_FOR);
        if (hasText(forwardedFor)) {
            String first = forwardedFor.split(",")[0].trim();
            if (!first.isEmpty()) {
                return first;
            }
        }

        String remoteAddr = request.getRemoteAddr();
        // 해시 입력이 null 이 되면 NPE 로 랜딩 응답까지 죽는다 — 값을 못 구해도 문자열로 떨어뜨린다.
        return hasText(remoteAddr) ? remoteAddr.trim() : UNKNOWN;
    }

    private boolean hasText(String value) {
        return value != null && !value.isBlank();
    }
}
