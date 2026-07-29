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
    @DisplayName("supportsParameter — @LoginUser 라도 타입이 UUID 가 아니면 false (호출 시점 캐스팅 사고 차단)")
    void supportsParameter_false_whenLoginUserOnNonUuid() {
        assertThat(resolver.supportsParameter(parameterOf("loginUserString", String.class))).isFalse();
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
    @DisplayName("resolveArgument — attribute 가 없으면 IllegalStateException, 메시지에 어느 핸들러인지 남긴다")
    void resolveArgument_throws_whenAttributeMissing() {
        MethodParameter parameter = parameterOf("loginUserUuid", UUID.class);

        assertThatThrownBy(() -> resolver.resolveArgument(parameter, null, webRequestWith(null), null))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("loginUserUuid");
    }
}
