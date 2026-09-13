package com.oneorthree.business.config;

import com.oneorthree.business.common.http.InternalCall;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * <b>임의 헤더·URL 프록시가 구조적으로 불가능</b>한지 본다.
 *
 * <p>{@code Authorization} 과 {@code X-User-Id} 를 유스케이스가 실을 수 있으면, 누군가 인바운드 값을
 * 복사하는 순간 A22 ㉸ 가 깨진다 — 정상 AT 를 가진 사용자가 임의의 id 로 남의 데이터를 읽고 쓴다.
 * 그래서 그 두 헤더는 «클라이언트만» 붙인다.
 */
@DisplayName("헤더 주입 방어")
class HeaderInjectionGuardTest {

    @Test
    @DisplayName("declaredHeaders 에 X-User-Id 를 넣으면 만들 때 터진다")
    void 유저헤더금지() {
        assertThatThrownBy(() -> InternalCall.to(HttpMethod.POST, "/internal/x")
                .header("X-User-Id", "11111111-1111-1111-1111-111111111111")
                .build())
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("X-User-Id");
    }

    @Test
    @DisplayName("대소문자를 바꿔도 막힌다 — HTTP 헤더는 대소문자를 구분하지 않는다")
    void 대소문자우회금지() {
        assertThatThrownBy(() -> InternalCall.to(HttpMethod.GET, "/internal/x")
                .header("x-user-id", "spoof")
                .build())
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    @DisplayName("Authorization 도 막힌다 — 대상별 서비스 토큰만 실려야 한다")
    void 자격헤더금지() {
        assertThatThrownBy(() -> InternalCall.to(HttpMethod.GET, "/internal/x")
                .header("Authorization", "Bearer stolen")
                .build())
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("Authorization");
    }

    @Test
    @DisplayName("GET 은 기본 재시도, 그 밖의 method 는 명시적 opt-in 이다 (§4)")
    void 재시도는optIn() {
        assertThat(InternalCall.to(HttpMethod.GET, "/internal/x").build().retryable()).isTrue();
        assertThat(InternalCall.to(HttpMethod.POST, "/internal/x").build().retryable()).isFalse();
        assertThat(InternalCall.to(HttpMethod.POST, "/internal/x")
                .idempotentCommand().build().retryable()).isTrue();
        // DELETE 도 opt-in 이어야 재시도된다 — §4 가 DELETE /internal/devices 를 명시적 대상으로 지정했다.
        assertThat(InternalCall.to(HttpMethod.DELETE, "/internal/x").build().retryable()).isFalse();
    }

    @Test
    @DisplayName("path 가 비면 만들 수 없다 — 경로는 유스케이스가 코드에 적은 상수여야 한다")
    void 빈경로금지() {
        assertThatThrownBy(() -> InternalCall.to(HttpMethod.GET, "  ").build())
                .isInstanceOf(IllegalArgumentException.class);
    }
}
