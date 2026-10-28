package com.oneorthree.business.auth;

import org.springframework.core.MethodParameter;
import org.springframework.stereotype.Component;
import org.springframework.web.bind.support.WebDataBinderFactory;
import org.springframework.web.context.request.NativeWebRequest;
import org.springframework.web.method.support.HandlerMethodArgumentResolver;
import org.springframework.web.method.support.ModelAndViewContainer;

import jakarta.servlet.http.HttpServletRequest;

import java.util.UUID;

/**
 * {@link LoginUser} 파라미터를 채운다.
 *
 * <p>속성이 비어 있으면 {@link IllegalStateException} 으로 <b>부팅·배선 사고를 즉시 드러낸다</b> —
 * null 을 조용히 주입하면 인증 필터가 빠진 경로에서 「userId 가 null 인 채로 상류를 호출」하게 되고,
 * 그건 상류에서 400 이나 엉뚱한 유저로 나타나 원인을 찾기 어렵다.
 */
@Component
public class LoginUserArgumentResolver implements HandlerMethodArgumentResolver {

    @Override
    public boolean supportsParameter(MethodParameter parameter) {
        if (!parameter.hasParameterAnnotation(LoginUser.class)) {
            return false;
        }
        Class<?> type = parameter.getParameterType();
        return UUID.class.equals(type) || AccessTokenClaims.class.equals(type);
    }

    @Override
    public Object resolveArgument(MethodParameter parameter, ModelAndViewContainer mavContainer,
            NativeWebRequest webRequest, WebDataBinderFactory binderFactory) {

        HttpServletRequest request = webRequest.getNativeRequest(HttpServletRequest.class);
        Object claims = request == null ? null : request.getAttribute(AuthAttributes.CLAIMS);
        if (!(claims instanceof AccessTokenClaims verified)) {
            throw new IllegalStateException(
                    "인증 속성이 없다 — AccessTokenFilter 가 이 경로에 등록되지 않았다");
        }
        if (AccessTokenClaims.class.equals(parameter.getParameterType())) {
            return verified;
        }
        return verified.userId();
    }
}
