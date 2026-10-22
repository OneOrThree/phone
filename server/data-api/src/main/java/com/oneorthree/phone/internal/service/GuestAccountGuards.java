package com.oneorthree.phone.internal.service;

import com.oneorthree.phone.common.exception.SocialLoginRequiredException;
import com.oneorthree.phone.user.repository.UserQueryService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.util.UUID;

/**
 * 친구 요청 생성·편지 발송·상점 구매에 소셜 연동을 요구하는 공통 가드.
 *
 * <p>해당 내부 컨트롤러가 명령 실행 전에 호출한다. 계정 상태는 토큰 발급 당시의 클레임 대신
 * 현재 사용자 행으로 판정하며, 목록 조회와 정리 작업에는 적용하지 않는다.
 */
@Component
@RequiredArgsConstructor
public class GuestAccountGuards {

    private final UserQueryService userQueryService;

    /**
     * 회원(소셜 연동 완료) 계정만 통과시킨다.
     *
     * <p>판정 근거는 AT 의 {@code guest} 클레임이 아니라 <b>{@code users.is_guest} 현재 값</b> 이다.
     * 클레임은 발급 시점 상태라({@code JwtProvider} 주석) 다른 기기에서 승격한 직후의 회원이
     * 토큰 수명 동안 회원 전용 작업에서 튕긴다.
     *
     * @param userId {@code InternalAuthFilter} 가 서비스 자격과 함께 검증한 주체
     * @throws SocialLoginRequiredException 403 {@code SOCIAL_LOGIN_REQUIRED} — 앱은 이 코드에만
     *                                      「소셜 로그인하고 계속하기」를 띄운다
     */
    public void requireMember(UUID userId) {
        // getCaller: 부재·탈퇴 주체는 404 USER_NOT_FOUND 가 먼저다(오류 계약 §4 의 caller 축).
        if (userQueryService.getCaller(userId).isGuest()) {
            throw new SocialLoginRequiredException();
        }
    }
}
