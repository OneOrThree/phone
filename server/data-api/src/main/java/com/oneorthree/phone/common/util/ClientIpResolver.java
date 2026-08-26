package com.oneorthree.phone.common.util;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.net.InetAddress;
import java.net.UnknownHostException;
import java.util.List;

/**
 * 클라이언트 실제 IP 를 뽑는다 — prod 토폴로지(Cloudflare → nginx → app) 기준.
 *
 * <p>초대링크 클릭 어트리뷰션(GROMO-789)과 게스트 생성 레이트리밋(GROMO-1510)이 함께 쓴다.
 * 어트리뷰션은 값이 틀려도 매칭이 오염되는 정도지만, <b>레이트리밋은 키를 호출자가 고를 수 있으면
 * 제한 자체가 통째로 무력화</b>된다(요청마다 새 버킷). 그래서 아래 신뢰 규칙이 곧 보안 경계다.
 *
 * <p><b>어떤 헤더를 믿는가 — {@code X-Real-IP} 하나다</b> (PR #621 코드리뷰 P1). 인프라 레포의
 * {@code nginx.conf} 는 {@code set_real_ip_from} 에 Cloudflare 대역을 나열하고
 * {@code real_ip_header CF-Connecting-IP} 를 걸어, <b>TCP 피어가 CF 대역일 때만</b> 그 헤더를 믿어
 * {@code $remote_addr} 을 복원한 뒤 {@code proxy_set_header X-Real-IP $remote_addr} 로 넘긴다.
 * 결과적으로 CF 를 거치면 진짜 클라이언트 IP 가, 오리진에 직접 붙으면 그 접속자의 진짜 IP 가 담기고,
 * 클라이언트가 {@code X-Real-IP} 를 직접 보내도 nginx 가 덮어써서 위조가 성립하지 않는다.
 *
 * <p>반면 {@code CF-Connecting-IP} 와 {@code X-Forwarded-For} 는 nginx 가 덮어쓰지 않는다 —
 * 전자는 그대로 통과하고 후자는 뒤에 이어붙일 뿐이라 첫 토큰이 호출자 값이다. 오리진에 직접 붙어
 * 이 둘을 지어내면 매 요청 새 키를 받으므로 <b>레이트리밋 키로 써서는 안 된다.</b>
 *
 * <p><b>2차 방어선 — 신뢰 피어 게이트</b>: 전달 헤더는 원격 피어가 사설망일 때만 읽는다. prod 는
 * app 컨테이너가 포트를 열지 않아 피어가 늘 nginx(도커 브리지)라 영향이 없고, 오리진이 직접 열린
 * 환경에서는 헤더를 무시하고 remoteAddr 로 떨어진다.
 *
 * <p><b>3차 — 프로파일별 못박기</b>: dev 는 앞단 프록시가 아예 없는 구성(compose 에 app·db 뿐)인데
 * {@code 0.0.0.0:8080} 으로 열려 있어 {@code link.trusted-ip-headers} 를 비워 헤더를 통째로 무시한다.
 * 토폴로지가 바뀌어 오리진이 직접 열리면 해당 프로파일에서도 이 값을 비우면 된다.
 *
 * <p>프로퍼티 키는 이미 배포된 환경 설정과의 호환을 위해 {@code link.} 접두어를 유지한다.
 */
@Component
public class ClientIpResolver {

    private static final String UNKNOWN = "unknown";

    private final List<String> trustedHeaders;

    public ClientIpResolver(
            @Value("${link.trusted-ip-headers:X-Real-IP}") List<String> trustedHeaders) {
        this.trustedHeaders = trustedHeaders;
    }

    public String resolve(HttpServletRequest request) {
        String remoteAddr = request.getRemoteAddr();

        // 앞단 프록시를 거쳐 온 요청일 때만 전달 헤더를 믿는다. 직접 닿은 요청의 헤더는 전부 호출자가
        // 지어낸 값이라, 읽는 순간 호출자가 자기 신원을 마음대로 고르게 해주는 꼴이 된다.
        if (isTrustedPeer(remoteAddr)) {
            for (String header : trustedHeaders) {
                // XFF 는 프록시가 이어붙인 목록이라 첫 토큰이 원 클라이언트다. 단일값 헤더에도 안전한 처리다.
                String value = firstToken(request.getHeader(header.trim()));
                if (value != null) {
                    return value;
                }
            }
        }

        // 해시 입력이 null 이 되면 NPE 로 랜딩 응답까지 죽는다 — 값을 못 구해도 문자열로 떨어뜨린다.
        return hasText(remoteAddr) ? remoteAddr.trim() : UNKNOWN;
    }

    /**
     * 원격 피어가 앞단 프록시로 볼 만한 주소인가 — 사설망(RFC1918 등)·루프백만 인정한다.
     *
     * <p>CIDR 목록을 프로퍼티로 받는 대신 JDK 판정을 쓴다. prod 의 nginx 는 도커 브리지
     * 네트워크(172.16/12)에 있어 항상 사설이고, 그 밖의 토폴로지는 아직 없다. 넣을 CIDR 이
     * 생기면 그때 프로퍼티로 뺀다.
     */
    private boolean isTrustedPeer(String remoteAddr) {
        if (!hasText(remoteAddr)) {
            return false;
        }
        try {
            // 서블릿 컨테이너가 주는 remoteAddr 은 항상 IP 리터럴이라 DNS 조회로 새지 않는다.
            InetAddress peer = InetAddress.getByName(remoteAddr.trim());
            return peer.isSiteLocalAddress() || peer.isLoopbackAddress() || peer.isLinkLocalAddress();
        } catch (UnknownHostException e) {
            return false;
        }
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
