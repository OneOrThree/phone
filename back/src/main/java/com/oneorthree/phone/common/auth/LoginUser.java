package com.oneorthree.phone.common.auth;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * 인증된 사용자의 userId 를 핸들러 파라미터로 주입받기 위한 마커 어노테이션 (GROMO-363).
 *
 * <p>붙이는 곳은 컨트롤러 핸들러 파라미터뿐이고, 실제 값 주입은
 * {@link LoginUserArgumentResolver} 가 담당한다.</p>
 */
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.PARAMETER)
public @interface LoginUser {
}
