package com.oneorthree.business.common.http;

import org.springframework.http.HttpMethod;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 내부 HTTP 한 건의 «명시적» 서술. <b>임의 헤더/URL 프록시가 불가능하도록</b> 만들어 뒀다.
 *
 * <h2>왜 범용 프록시가 아닌가</h2>
 * Data API 는 {@code JwtFilter} 를 떼고 <b>서비스 토큰 + {@code X-User-Id} 를 신뢰</b>하게 된다
 * (A22 ㉸). 인바운드 헤더를 복사하는 범용 프록시는 앱이 보낸 동명 헤더를 그대로 흘려보내기 쉬운
 * 자리이고, 그러면 정상 AT 를 가진 사용자가 임의의 {@code X-User-Id} 로 <b>남의 데이터를 읽고 쓴다</b>.
 * 경로도 같다 — 호출자가 정한 URL 을 그대로 붙이면 알림 자격으로 {@code /internal/auth/*} 나 배치
 * 트리거에 닿을 수 있다(㉱). 그래서 method · path · 헤더를 <b>유스케이스가 코드에 적어 넣는</b> 것만
 * 허용한다.
 *
 * <h2>헤더 규칙</h2>
 * {@link #declaredHeaders()} 에는 <b>유스케이스가 계산한 값</b>만 넣는다 — 인바운드 요청에서 복사한
 * 값을 넣으면 이 클래스의 목적이 사라진다. {@code Authorization} 과 {@code X-User-Id} 는 여기 넣을 수
 * 없고 {@link InternalHttpClient} 가 붙인다(전자는 대상별 서비스 토큰, 후자는 검증한 AT subject).
 *
 * @param method            HTTP method
 * @param path              상류 base-url 뒤에 붙는 경로. 유스케이스가 코드에 적은 상수여야 한다
 * @param query             쿼리 파라미터
 * @param body              요청 본문. null 이면 본문 없이 보낸다
 * @param onBehalfOfUserId  사용자 위임 호출이면 그 userId(검증한 AT subject), 서비스 전용이면 null
 * @param idempotencyKey    {@code Idempotency-Key} 헤더 값. <b>재시도에서 같은 값을 유지</b>한다(㉼)
 * @param declaredHeaders   유스케이스가 명시한 그 밖의 헤더
 * @param retryable         멱등이 보장되는 호출인가. <b>opt-in 이다</b> — §4 의 재시도 대상 규칙
 */
public record InternalCall(
        HttpMethod method,
        String path,
        Map<String, String> query,
        Object body,
        java.util.UUID onBehalfOfUserId,
        String idempotencyKey,
        Map<String, String> declaredHeaders,
        boolean retryable) {

    private static final String HEADER_AUTHORIZATION = "authorization";
    private static final String HEADER_USER_ID = "x-user-id";

    public InternalCall {
        if (method == null || path == null || path.isBlank()) {
            throw new IllegalArgumentException("method·path 는 필수다");
        }
        query = query == null ? Map.of() : Map.copyOf(query);
        declaredHeaders = declaredHeaders == null ? Map.of() : Map.copyOf(declaredHeaders);
        for (String name : declaredHeaders.keySet()) {
            String lower = name.toLowerCase(java.util.Locale.ROOT);
            if (HEADER_AUTHORIZATION.equals(lower) || HEADER_USER_ID.equals(lower)) {
                // 여기서 막지 않으면 유스케이스가 실수로 인바운드 값을 실을 수 있고, 그게 곧 A22 ㉸ 위반이다.
                throw new IllegalArgumentException(
                        "Authorization·X-User-Id 는 클라이언트가 붙인다 — declaredHeaders 에 넣을 수 없다: " + name);
            }
        }
    }

    public static Builder to(HttpMethod method, String path) {
        return new Builder(method, path);
    }

    /** 읽기 쉬운 조립기. 필드가 많고 대부분 비어 있어 생성자 직접 호출은 실수가 나기 쉽다. */
    public static final class Builder {

        private final HttpMethod method;
        private final String path;
        private final Map<String, String> query = new LinkedHashMap<>();
        private final Map<String, String> headers = new LinkedHashMap<>();
        private Object body;
        private java.util.UUID userId;
        private String idempotencyKey;
        private boolean retryable;

        private Builder(HttpMethod method, String path) {
            this.method = method;
            this.path = path;
        }

        public Builder query(String name, String value) {
            if (value != null) {
                query.put(name, value);
            }
            return this;
        }

        public Builder header(String name, String value) {
            if (value != null) {
                headers.put(name, value);
            }
            return this;
        }

        public Builder body(Object value) {
            this.body = value;
            return this;
        }

        /** 사용자 위임 호출 — 검증한 AT subject 를 넘긴다. 인바운드 헤더를 넘기면 안 된다. */
        public Builder onBehalfOf(java.util.UUID value) {
            this.userId = value;
            return this;
        }

        /** 같은 키를 재시도에서 유지한다 — 응답 유실 뒤 재시도가 «중복 명령»이 되지 않게 하는 유일한 장치다. */
        public Builder idempotencyKey(String value) {
            this.idempotencyKey = value;
            return this;
        }

        /**
         * 이 호출이 <b>멱등임을 확인했다</b>고 선언한다. §4: 재시도 대상 = 멱등 GET + 멱등이 보장된 명령
         * (전체 교체 {@code PUT} · {@code DELETE /internal/devices} · {@code POST …/withdraw}).
         * GET 만 재시도하면 로그아웃의 기기 토큰 삭제가 일시 오류 한 번에 영구 실패한다.
         */
        public Builder idempotentCommand() {
            this.retryable = true;
            return this;
        }

        public InternalCall build() {
            boolean retry = retryable || HttpMethod.GET.equals(method);
            return new InternalCall(method, path, query, body, userId, idempotencyKey, headers, retry);
        }
    }
}
