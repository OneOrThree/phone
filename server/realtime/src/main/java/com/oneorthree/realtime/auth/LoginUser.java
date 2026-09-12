package com.oneorthree.realtime.auth;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * 컨트롤러 파라미터에 붙여 «인증된 요청자»의 userId 를 주입받는다.
 *
 * <p>요청자를 {@code @RequestParam}·{@code @PathVariable} 로 받지 않는 것이 규칙이다 — 그렇게 받으면
 * 남의 userId 를 적어 보내는 것만으로 사칭이 되고, 그 구멍은 코드만 봐서는 정상적으로 보인다.
 */
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.PARAMETER)
public @interface LoginUser {
}
