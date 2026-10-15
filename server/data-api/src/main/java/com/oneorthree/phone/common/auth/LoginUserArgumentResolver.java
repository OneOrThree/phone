package com.oneorthree.phone.common.auth;

import org.springframework.core.MethodParameter;
import org.springframework.stereotype.Component;
import org.springframework.web.bind.support.WebDataBinderFactory;
import org.springframework.web.context.request.NativeWebRequest;
import org.springframework.web.method.support.HandlerMethodArgumentResolver;
import org.springframework.web.method.support.ModelAndViewContainer;

import java.util.UUID;
import com.oneorthree.phone.common.exception.LoginUserResolutionException;

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

    /**
     * 타입은 여기서 보지 않는다 — @LoginUser 가 붙은 파라미터는 타입이 틀렸더라도 일단 이 리졸버가 맡는다.
     * false 를 반환하면 내장 catch-all 리졸버가 가져가 ?userId= 쿼리 파라미터로 바인딩해버리기 때문이다.
     * 즉 잘못 붙인 타입 하나가 이 어노테이션이 막으려던 "클라이언트가 준 userId" 경로를 그대로 되연다.
     * 타입 검증은 resolveArgument 에서 예외로 처리해 조용한 바인딩 대신 큰 소리로 실패하게 한다.
     */
    @Override
    public boolean supportsParameter(MethodParameter parameter) {
        return parameter.hasParameterAnnotation(LoginUser.class);
    }

    /**
     * 여기서 실패하는 두 경우는 모두 401 이 아니라 500 이다. @LoginUser 는 인증 필수 경로에만 붙으므로
     * 여기 도달했다는 건 JwtFilter 를 통과했다는 뜻 — 클라이언트 잘못이 아니라 서버 배선 오류다.
     * 조용히 null 을 넘기면 서비스단에서 NPE 나 전체 조회 같은 엉뚱한 동작이 된다.
     */
    @Override
    public Object resolveArgument(MethodParameter parameter,
                           ModelAndViewContainer mavContainer,
                           NativeWebRequest webRequest,
                           WebDataBinderFactory webDataBinderFactory) {
        if (parameter.getParameterType() != UUID.class) {
            throw new LoginUserResolutionException(
                    "@LoginUser 는 UUID 파라미터에만 붙일 수 있다 — 선언된 타입="
                            + parameter.getParameterType().getName()
                            + ", handler=" + parameter.getExecutable());
        }
        UUID userId = (UUID) webRequest.getAttribute(AuthAttributes.USER_ID, NativeWebRequest.SCOPE_REQUEST);
        if (userId == null) {
            throw new LoginUserResolutionException(
                    "@LoginUser 파라미터에 주입할 userId 가 request 에 없다 — "
                            + "JwtFilter 를 타지 않는 경로(WHITELIST 등)에 붙였는지 확인. handler="
                            + parameter.getExecutable());
        }
        return userId;
    }

}
