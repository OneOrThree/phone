package com.oneorthree.phone.internal.service;

import com.oneorthree.phone.common.exception.SocialLoginRequiredException;
import com.oneorthree.phone.user.repository.UserQueryService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.util.UUID;

/**
 * 게스트 계정에 닫혀 있는 2.0 작업의 공통 가드 (GROMO-1992 · 정책 「인증·게스트 계정」).
 *
 * <p>정책은 「친구 추가·편지 보내기·상점 구매를 처음 시도할 때 소셜 로그인을 요청한다」이다.
 * 같은 판정을 서비스마다 다시 쓰면 한쪽만 고쳐져 다른 쪽으로 우회가 열린다 —
 * {@link IslandMovementGuards} 와 같은 이유로 판정을 여기 하나로 모은다.
 *
 * <h2>왜 2.0 내부 표면에만 거는가</h2>
 * 친구 요청은 <b>표면이 둘</b>이다. 레거시 {@code POST /api/v1/friends/requests}(동결된 1.x 앱)와
 * 2.0 {@code POST /internal/users/{userId}/friend-requests} 가 같은 {@code FriendService.createRequest}
 * 를 부른다. 공유 서비스에 가드를 넣으면 <b>스토어에 나가 있는 1.x 의 게스트 친구 요청이 그날로
 * 막힌다</b> — {@code InternalFriendController} 의 「레거시는 그대로 두고 동작도 바꾸지 않는다」와
 * GROMO-1934 가 게스트 친구 요청에 «차단이 아니라 시간당 한도» 를 붙인 결정을 함께 뒤집는 일이다.
 * 정책은 fishcat(2.0) 정책이므로 2.0 표면에서 강제한다.
 * <p>⚠️ 그 대가로 <b>구멍이 하나 남는다</b>: 2.0 게스트 AT 로 레거시 {@code /api/v1} 경로를 직접
 * 부르면 이 가드를 지나지 않는다. 막으려면 레거시 표면을 닫아야 하고 그건 1.x 종료와 묶인 별도 결정이다.
 *
 * <h2>상점 구매는 표면이 하나다</h2>
 * {@code shop} 도메인에는 컨트롤러가 없고 {@code InternalShopController} 가 유일한 호출자라,
 * 여기서 막는 것이 곧 전부 막는 것이다.
 *
 * <h2>편지 발송</h2>
 * 정책의 세 명령 중 「편지 보내기」다 — {@code InternalLetterController.send} 가
 * {@code InternalLetterService.send} 앞에서 이 가드를 부른다. 계정 상태 gate 는 2.0 컨트롤러
 * 경계에 있고 서비스에는 게스트 분기가 없다. 목록·상세·닫기는 읽기·정리 표면이라 정책의
 * 「처음 시도」가 가리키는 명령이 아니므로 걸지 않는다.
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
