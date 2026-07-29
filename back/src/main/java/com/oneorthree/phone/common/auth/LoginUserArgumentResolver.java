package com.oneorthree.phone.common.auth;

import org.springframework.core.MethodParameter;
import org.springframework.stereotype.Component;
import org.springframework.web.bind.support.WebDataBinderFactory;
import org.springframework.web.context.request.NativeWebRequest;
import org.springframework.web.method.support.HandlerMethodArgumentResolver;
import org.springframework.web.method.support.ModelAndViewContainer;

import java.util.UUID;

/**
 * {@link LoginUser} 가 붙은 파라미터에 JwtFilter 가 심어 둔 userId 를 주입하는 리졸버 (GROMO-363).
 *
 * <p>Spring MVC 는 핸들러 호출 직전에 등록된 리졸버들에게 파라미터마다
 * "네가 처리할 파라미터냐"를 물어보고, 처음으로 true 를 답한 리졸버에게 값 생성을 맡긴다.
 * 등록은 {@code WebMvcConfig.addArgumentResolvers} 에서 한다.</p>
 *
 * <p>인증 자체는 여전히 {@code JwtFilter} 의 책임이다. 이 클래스는 필터가 이미 검증해
 * request 에 심어 둔 값을 꺼내 오기만 한다.</p>
 */
@Component
public class LoginUserArgumentResolver implements HandlerMethodArgumentResolver {

    // 타입 검사를 빼지 말 것 — @LoginUser String 처럼 잘못 붙였을 때 여기서 걸러야 한다.
    // 통과시키면 resolveArgument 가 UUID 를 반환하면서 핸들러 호출 시점에 터져 원인 추적이 어렵다.
    @Override
    public boolean supportsParameter(MethodParameter parameter) {
        return parameter.hasParameterAnnotation(LoginUser.class) &&
                parameter.getParameterType() == UUID.class;
    }

    // attribute 가 없으면 401 이 아니라 500 이다. @LoginUser 는 인증 필수 경로에만 붙으므로
    // 여기 도달했다는 건 JwtFilter 를 통과했다는 뜻 — null 은 클라이언트 잘못이 아니라
    // "필터를 안 타는 경로(화이트리스트 등)에 잘못 붙였다"는 서버 배선 오류다.
    // 조용히 null 을 넘기면 서비스단에서 NPE 나 전체 조회 같은 엉뚱한 동작이 된다.
    @Override
    public Object resolveArgument(MethodParameter parameter,
                           ModelAndViewContainer mavContainer,
                           NativeWebRequest webRequest,
                           WebDataBinderFactory webDataBinderFactory) {
        UUID userId = (UUID) webRequest.getAttribute(AuthAttributes.USER_ID, NativeWebRequest.SCOPE_REQUEST);
        if (userId == null) {
            throw new IllegalStateException(
                    "@LoginUser 파라미터에 주입할 userId 가 request 에 없다 — " +
                    "JwtFilter 를 타지 않는 경로(WHITELIST 등)에 붙였는지 확인. handler=" +
                    parameter.getExecutable()
            );
        }
        return userId;
    }

}
