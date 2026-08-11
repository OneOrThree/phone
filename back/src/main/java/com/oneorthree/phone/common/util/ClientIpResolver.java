package com.oneorthree.phone.common.util;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.util.List;

/**
 * 클라이언트 실제 IP 를 뽑는다 — prod 토폴로지(Cloudflare → nginx → app) 기준.
 *
 * <p>신뢰 순서가 곧 정확도이자 보안 경계다. {@code CF-Connecting-IP} 는 Cloudflare 가 매 요청
 * 덮어쓰므로 가장 믿을 만하고, 그다음이 {@code X-Forwarded-For} 첫 토큰, 마지막이 remoteAddr 다.
 * remoteAddr 만 쓰면 모든 클릭이 nginx IP 하나로 뭉쳐 서로 매치돼버린다.
 *
 * <p><b>배포 전제</b>: 헤더 신뢰는 "오리진에 프록시를 거치지 않고는 도달할 수 없다"가 참일 때만
 * 안전하다. 오리진이 직접 열려 있거나 nginx 가 클라이언트가 보낸 {@code CF-Connecting-IP} 를
 * 덮어쓰지 않으면, 공격자가 헤더를 위조해 특정 fingerprint 의 클릭을 골라 소진시킬 수 있다
 * (앱이 초대 시트 확인을 강제하므로 피해는 제한적이지만 어트리뷰션은 오염된다).
 * 그래서 신뢰할 헤더 목록을 프로퍼티({@code link.trusted-ip-headers})로 뺐다 — 그 전제가 깨진
 * 환경에서는 목록을 비워 remoteAddr 만 쓰게 만들 수 있다.
 *
 * <p>초대링크 클릭 기록에 이어 게스트 생성 레이트리밋(GROMO-1510)도 쓰게 되어 {@code common/util}
 * 로 옮겼다. 프로퍼티 키는 이미 배포된 환경 설정과의 호환을 위해 {@code link.} 접두어를 유지한다.
 */
@Component
public class ClientIpResolver {

    private static final String UNKNOWN = "unknown";

    private final List<String> trustedHeaders;

    public ClientIpResolver(
            @Value("${link.trusted-ip-headers:CF-Connecting-IP,X-Forwarded-For}") List<String> trustedHeaders) {
        this.trustedHeaders = trustedHeaders;
    }

    public String resolve(HttpServletRequest request) {
        for (String header : trustedHeaders) {
            // XFF 는 프록시가 이어붙인 목록이라 첫 토큰이 원 클라이언트다. 단일값 헤더에도 안전한 처리다.
            String value = firstToken(request.getHeader(header.trim()));
            if (value != null) {
                return value;
            }
        }

        String remoteAddr = request.getRemoteAddr();
        // 해시 입력이 null 이 되면 NPE 로 랜딩 응답까지 죽는다 — 값을 못 구해도 문자열로 떨어뜨린다.
        return hasText(remoteAddr) ? remoteAddr.trim() : UNKNOWN;
    }

    private String firstToken(String headerValue) {
        if (!hasText(headerValue)) {
            return null;
        }
        String first = headerValue.split(",")[0].trim();
        return first.isEmpty() ? null : first;
    }

    private boolean hasText(String value) {
        return value != null && !value.isBlank();
    }
}
