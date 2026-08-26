package com.oneorthree.phone.common.auth;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.core.MethodParameter;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.context.request.NativeWebRequest;
import org.springframework.web.context.request.ServletWebRequest;

import java.lang.reflect.Method;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * {@link LoginUserArgumentResolver} 단위 테스트 (GROMO-363).
 *
 * <p>Spring 컨텍스트 없이 리졸버만 직접 호출한다. MethodParameter 는 더미 핸들러의 시그니처를
 * 리플렉션으로 읽어 만들고, NativeWebRequest 는 MockHttpServletRequest 를 ServletWebRequest 로
 * 감싸 실제로 attribute 를 세팅/조회한다.</p>
 */
class LoginUserArgumentResolverTest {

    private final LoginUserArgumentResolver resolver = new LoginUserArgumentResolver();

    /**
     * 파라미터 조합 3종을 시그니처로만 담아 두는 더미 핸들러.
     * 본문은 실행되지 않는다 — 리플렉션으로 어노테이션과 타입만 읽는다.
     */
    static class DummyHandler {

        void loginUserUuid(@LoginUser UUID userId) {
        }

        void loginUserString(@LoginUser String userId) {
        }

        void plainUuid(UUID userId) {
        }
    }

    private MethodParameter parameterOf(String methodName, Class<?> parameterType) {
        try {
            Method method = DummyHandler.class.getDeclaredMethod(methodName, parameterType);
            return new MethodParameter(method, 0);
        } catch (NoSuchMethodException e) {
            throw new IllegalStateException("더미 핸들러 시그니처가 바뀌었다 — " + methodName, e);
        }
    }

    /** userId 가 null 이면 attribute 를 심지 않은 요청(= 필터를 안 탄 상태)을 만든다. */
    private NativeWebRequest webRequestWith(UUID userId) {
        MockHttpServletRequest request = new MockHttpServletRequest();
        if (userId != null) {
            request.setAttribute(AuthAttributes.USER_ID, userId);
        }
        return new ServletWebRequest(request);
    }

    @Test
    @DisplayName("supportsParameter — @LoginUser + UUID 면 true")
    void supportsParameter_true_whenLoginUserOnUuid() {
        assertThat(resolver.supportsParameter(parameterOf("loginUserUuid", UUID.class))).isTrue();
    }

    @Test
    @DisplayName("supportsParameter — 타입이 틀려도 @LoginUser 면 true (내장 catch-all 이 쿼리로 바인딩하는 것을 막는다)")
    void supportsParameter_true_whenLoginUserOnNonUuid() {
        // false 를 반환하면 내장 RequestParam 리졸버가 가져가 ?userId= 로 채운다.
        // 그러면 이 어노테이션이 막으려던 "클라이언트가 준 userId" 경로가 그대로 되열린다.
        assertThat(resolver.supportsParameter(parameterOf("loginUserString", String.class))).isTrue();
    }

    @Test
    @DisplayName("supportsParameter — 어노테이션 없는 UUID 는 false (내장 리졸버 영역 침범 방지)")
    void supportsParameter_false_whenAnnotationMissing() {
        assertThat(resolver.supportsParameter(parameterOf("plainUuid", UUID.class))).isFalse();
    }

    @Test
    @DisplayName("resolveArgument — JwtFilter 가 심어 둔 userId 를 그대로 반환")
    void resolveArgument_returnsAttributeValue() {
        UUID userId = UUID.randomUUID();

        Object resolved = resolver.resolveArgument(
                parameterOf("loginUserUuid", UUID.class), null, webRequestWith(userId), null);

        assertThat(resolved).isEqualTo(userId);
    }

    @Test
    @DisplayName("resolveArgument — attribute 가 없으면 LoginUserResolutionException, 메시지에 어느 핸들러인지 남긴다")
    void resolveArgument_throws_whenAttributeMissing() {
        MethodParameter parameter = parameterOf("loginUserUuid", UUID.class);

        assertThatThrownBy(() -> resolver.resolveArgument(parameter, null, webRequestWith(null), null))
                .isInstanceOf(LoginUserResolutionException.class)
                .hasMessageContaining("loginUserUuid");
    }

    @Test
    @DisplayName("resolveArgument — @LoginUser 를 UUID 아닌 타입에 붙이면 예외 (조용한 쿼리 바인딩 대신 큰 소리로 실패)")
    void resolveArgument_throws_whenParameterTypeIsNotUuid() {
        UUID userId = UUID.randomUUID();
        MethodParameter parameter = parameterOf("loginUserString", String.class);

        assertThatThrownBy(() -> resolver.resolveArgument(parameter, null, webRequestWith(userId), null))
                .isInstanceOf(LoginUserResolutionException.class)
                .hasMessageContaining("UUID")
                .hasMessageContaining("loginUserString");
    }
}
