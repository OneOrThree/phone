package com.oneorthree.business.common.http;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.net.InetAddress;
import java.net.UnknownHostException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.List;

/**
 * 클라이언트 실제 IP 를 뽑는다 — <b>전용 헤더 + 공유 비밀</b>만 믿는다.
 *
 * <h2>왜 이 규칙이 보안 경계인가</h2>
 * 이 값이 틀리면 매치가 오염되는 정도지만, <b>호출자가 키를 고를 수 있으면 매치를 조작</b>할 수 있다 —
 * 남의 클릭을 자기 기기에 배정받는 길이 된다. 그래서 신뢰 규칙을 느슨하게 두지 않는다.
 *
 * <h2>어떤 헤더를 믿는가 — {@code X-Link-Client-IP} 하나다</h2>
 * 정본 보정(2026-09-11, coordinator): Vercel 의 공식 request-headers 문서가
 * <b>{@code X-Forwarded-For} 를 덮어쓴다고 명시</b>하므로, nginx → Vercel 경로에서 원본 IP 를 XFF 로
 * 나르면 값이 사라진다. 그래서 링크 경로 전체가 전용 헤더
 * {@code X-Link-Client-IP} + {@code X-Link-Proxy-Secret} 로 원본 IP 를 전달한다. Business 의 호환 match
 * 도 <b>같은 전용 헤더 계약</b>을 쓴다(양쪽이 다른 헤더를 보면 정지 창에 매치가 갈라진다).
 *
 * <p><b>{@code X-Forwarded-For} · {@code CF-Connecting-IP} · {@code X-Real-IP} 는 믿지 않는다.</b>
 * 앞의 둘은 프록시가 덮어쓰지 않아(전자는 이어붙이고 후자는 그대로 통과) 오리진에 직접 붙은 호출자가
 * 첫 토큰을 지어낼 수 있고, {@code X-Real-IP} 는 이 경로의 프록시가 더 이상 세팅하지 않는다. 신뢰
 * 목록을 늘리는 것은 곧 위조 통로를 늘리는 것이다(A22 ㊾ 가 같은 이유를 CF 쪽에서 말한다).
 *
 * <h2>2차: 신뢰 피어 게이트 · 3차: 공유 비밀</h2>
 * 전달 헤더는 원격 피어가 사설망·루프백일 때만 읽는다. 그 위에 {@code link.proxy-secret} 이 설정돼
 * 있으면 <b>헤더로 온 비밀이 일치할 때만</b> 전달 헤더를 믿는다 — 컨테이너 네트워크 안의 다른 워크로드가
 * 사설 피어 자격만으로 IP 를 고르는 길을 닫는다. 비교는 <b>상수 시간</b>으로 한다.
 *
 * <p><b>직접 Vercel 경로는 이 클래스의 관심이 아니다</b> — 링크 서버가 {@code x-vercel-forwarded-for}
 * 만 믿는다. Business 는 legacy nginx 뒤에만 서므로 전용 헤더 한 가지로 끝낸다.
 */
@Component
public class ClientIpResolver {

    private static final String UNKNOWN = "unknown";

    /** legacy nginx 가 실어 보내는 공유 비밀 헤더 이름. 링크 서버와 <b>같은 이름</b>이어야 한다. */
    public static final String HEADER_PROXY_SECRET = "X-Link-Proxy-Secret";

    /** 원본 IP 전용 헤더. XFF 를 쓰지 않는 이유는 클래스 주석에 있다. */
    public static final String HEADER_CLIENT_IP = "X-Link-Client-IP";

    private final List<String> trustedHeaders;
    private final String proxySecret;

    /**
     * @param trustedHeaders {@code link.trusted-ip-headers} — 기본값은 {@code X-Link-Client-IP} 하나다.
     *                       <b>{@code X-Forwarded-For} 를 여기 넣으면 안 된다</b>: Vercel 이 그 헤더를
     *                       덮어쓰므로 값이 살아 오지 않고, 오리진에 직접 붙은 호출자는 첫 토큰을
     *                       지어낼 수 있다. 프록시가 없는 배포에서는 빈 값으로 둔다
     * @param proxySecret    {@code link.proxy-secret}. 비어 있으면 이 겹을 적용하지 않는다 —
     *                       기존 배포가 아직 이 헤더를 안 보내는 동안의 호환을 위한 것이고,
     *                       <b>정지 창 진입 전에 반드시 채워야 한다</b>
     */
    public ClientIpResolver(
            @Value("${link.trusted-ip-headers:X-Link-Client-IP}") List<String> trustedHeaders,
            @Value("${link.proxy-secret:}") String proxySecret) {
        this.trustedHeaders = List.copyOf(trustedHeaders);
        this.proxySecret = proxySecret;
    }

    /**
     * @return 클라이언트 주소 문자열. 값을 구하지 못해도 {@code "unknown"} 을 돌려주고 <b>null 을
     *         반환하지 않는다</b> — 호출부(해시)가 null 을 만나 응답까지 죽는 일을 막는 계약이다.
     *         단 {@code "unknown"} 은 모든 미상 호출자가 공유하는 한 버킷이 되므로, 그 상태가 흔해지면
     *         서로의 매치 후보가 된다
     */
    public String resolve(HttpServletRequest request) {
        String remoteAddr = request.getRemoteAddr();

        if (isTrustedPeer(remoteAddr) && hasValidProxySecret(request)) {
            for (String header : trustedHeaders) {
                // 전용 헤더는 단일값이지만 첫 토큰만 취한다 — 누군가 목록을 실어 보내도 뒤쪽 값이
                // 조용히 쓰이지 않게 한다.
                String value = firstToken(request.getHeader(header.trim()));
                if (value != null) {
                    return value;
                }
            }
        }

        return hasText(remoteAddr) ? remoteAddr.trim() : UNKNOWN;
    }

    /** 공유 비밀이 설정돼 있지 않으면 이 겹을 건너뛴다. 설정돼 있으면 <b>일치할 때만</b> 헤더를 믿는다. */
    private boolean hasValidProxySecret(HttpServletRequest request) {
        if (!hasText(proxySecret)) {
            return true;
        }
        String presented = request.getHeader(HEADER_PROXY_SECRET);
        if (!hasText(presented)) {
            return false;
        }
        // 상수 시간 비교 — 길이·내용 차이로 비밀을 한 바이트씩 알아내는 길을 닫는다.
        return MessageDigest.isEqual(
                presented.getBytes(StandardCharsets.UTF_8), proxySecret.getBytes(StandardCharsets.UTF_8));
    }

    /**
     * 원격 피어가 앞단 프록시로 볼 만한 주소인가 — 사설망(RFC1918 등)·루프백만 인정한다.
     *
     * <p>직접 닿은 요청의 헤더는 전부 호출자가 지어낸 값이라, 읽는 순간 호출자가 자기 신원을 고르게
     * 해 주는 셈이 된다.
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
