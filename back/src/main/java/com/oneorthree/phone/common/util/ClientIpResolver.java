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
 *
 * <p><b>신뢰 피어 게이트(PR #621 코드리뷰 P1)</b>: 위 "배포 전제"를 코드로 강제한다. 전달 헤더는
 * <b>원격 피어가 사설망일 때만</b> 읽는다. prod 는 app 컨테이너가 포트를 열지 않고 같은 도커
 * 네트워크의 nginx 만 붙으므로 피어가 늘 사설 IP 라 종전과 동작이 같고, dev 처럼 오리진이
 * {@code 8080} 으로 직접 열린 환경에서는 피어가 공인 IP 라 헤더를 무시하고 remoteAddr 을 쓴다.
 * 레이트리밋에서 이 구분이 중요한 이유는, 어트리뷰션 오염과 달리 <b>키를 위조할 수 있으면 제한
 * 자체가 통째로 무력화</b>되기 때문이다 — 요청마다 헤더만 바꾸면 매번 새 버킷을 받는다.
 *
 * <p>사설 피어 판정만으로는 <b>같은 사설망 안에서 오리진에 직접 붙는 호출자</b>를 못 거른다.
 * 그래서 헤더 신뢰 여부를 프로파일에 못박아 이중으로 막는다 — dev 는 앞단 프록시가 아예 없는
 * 구성(app·db 뿐)인데 {@code 0.0.0.0:8080} 으로 열려 있어 {@code trusted-ip-headers} 를 비워
 * 헤더를 통째로 무시하고, prod 는 app 이 포트를 열지 않아 nginx 외에는 도달 자체가 불가능하다.
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
