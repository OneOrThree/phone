package com.oneorthree.realtime.auth;

import org.springframework.core.MethodParameter;
import org.springframework.stereotype.Component;
import org.springframework.web.bind.support.WebDataBinderFactory;
import org.springframework.web.context.request.NativeWebRequest;
import org.springframework.web.context.request.RequestAttributes;
import org.springframework.web.method.support.HandlerMethodArgumentResolver;
import org.springframework.web.method.support.ModelAndViewContainer;

import java.util.UUID;

/**
 * {@link LoginUser} 가 붙은 {@code UUID} 파라미터에 {@code JwtFilter} 가 심어 둔 userId 를 꽂는다.
 */
@Component
public class LoginUserArgumentResolver implements HandlerMethodArgumentResolver {

    @Override
    public boolean supportsParameter(MethodParameter parameter) {
        return parameter.hasParameterAnnotation(LoginUser.class)
                && UUID.class.equals(parameter.getParameterType());
    }

    /**
     * <p>속성이 비어 있으면 {@code null} 을 흘리지 않고 즉시 터뜨린다. 이 리졸버가 도는 시점은 필터를
     * 통과한 뒤라 값은 «항상» 있어야 한다 — 없다면 그건 요청의 문제가 아니라 필터 배선이 깨졌다는
     * 뜻이고, null 로 흘리면 그 아래 전부가 «요청자 미상»으로 조용히 돌아간다.
     */
    @Override
    public Object resolveArgument(MethodParameter parameter, ModelAndViewContainer mavContainer,
            NativeWebRequest webRequest, WebDataBinderFactory binderFactory) {
        Object userId = webRequest.getAttribute(AuthAttributes.USER_ID, RequestAttributes.SCOPE_REQUEST);
        if (userId == null) {
            throw new IllegalStateException("인증 통과 후인데 userId 속성이 없다 — JwtFilter 배선 확인");
        }
        return userId;
    }
}
