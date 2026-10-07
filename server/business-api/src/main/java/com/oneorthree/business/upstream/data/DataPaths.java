package com.oneorthree.business.upstream.data;

import com.oneorthree.business.common.http.InternalCall;
import org.springframework.http.HttpMethod;

import java.util.UUID;

/**
 * 도메인별 Data 클라이언트가 공유하는 경로 확장·세션 헤더 도우미.
 *
 * <p>경로 상수가 각 클라이언트 안에만 있으므로 임의 URL 프록시는 여전히 불가능하다 — 여기 있는 것은
 * {@code {userId}} 같은 자리표시자 치환과 {@code X-Session-Id}/{@code X-Auth-Generation} 헤더 부착뿐이다.
 */
final class DataPaths {

    static final String HEADER_SESSION = "X-Session-Id";
    static final String HEADER_GENERATION = "X-Auth-Generation";

    private DataPaths() {
    }

    static String userPath(String template, UUID userId) {
        return template.replace("{userId}", userId.toString());
    }

    static String islandPath(String template, UUID islandId) {
        return template.replace("{islandId}", islandId.toString());
    }

    static String noticePath(String template, UUID islandId, UUID noticeId) {
        return islandPath(template, islandId).replace("{noticeId}", noticeId.toString());
    }

    static String commentPath(String template, UUID islandId, UUID noticeId, UUID commentId) {
        return noticePath(template, islandId, noticeId).replace("{commentId}", commentId.toString());
    }

    static String resultPath(String template, UUID userId, UUID sessionId) {
        return userPath(template, userId).replace("{sessionId}", sessionId.toString());
    }

    /** 서명된 AT 의 {@code sid}·{@code gen} 을 헤더로 싣는 사용자 축 호출의 공통 골격 (B26). */
    static InternalCall.Builder sessionScoped(HttpMethod method, String path, UUID userId, UUID sessionId,
            long generation) {
        return InternalCall.to(method, path)
                .onBehalfOf(userId)
                .header(HEADER_SESSION, sessionId.toString())
                .header(HEADER_GENERATION, Long.toString(generation));
    }
}
