package com.oneorthree.phone.internal;

import com.oneorthree.phone.auth.dto.res.TokenRefreshResponse;
import com.oneorthree.phone.auth.service.AuthService;
import com.oneorthree.phone.auth.support.GuestLoginRateLimiter;
import com.oneorthree.phone.internal.dto.GuestSessionRequest;
import com.oneorthree.phone.internal.dto.LoginSessionResponse;
import com.oneorthree.phone.internal.dto.SessionRefreshRequest;
import com.oneorthree.phone.internal.dto.SessionRefreshResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 2.0 공개 표면이 위임하는 <b>세션 발급</b> 두 종 — AT 재발급(GROMO-2035)과 게스트 시작(GROMO-2036).
 *
 * <p>{@link InternalSessionLogoutController} 와 같은 결이다: 공개 경로는 Business 에 있고
 * ({@code POST /auth/sessions/current/refresh} · {@code POST /auth/sessions/guest}) 여기는 그 위임만
 * 받는다. {@code /internal/users/{userId}} 축이 <b>아닌</b> 이유도 같다 — {@code InternalAuthFilter}
 * 는 그 접두어를 보면 경로의 {@code userId} 와 {@code X-User-Id} 헤더의 일치를 강제하는데, 갱신·게스트
 * 시작에는 <b>헤더로 주장된 주체가 없다</b>. 주체는 RT 서명이 지목하거나(갱신) 이 요청이 만든다(게스트).
 *
 * <p>둘 다 {@code POST} 인 이유는 자격을 쿼리에 실으면 접근 로그·프록시 캐시에 남기 때문이다
 * ({@link InternalAuthController} 와 같은 판단).
 *
 * <p>응답을 {@code {"data": …}} 로 감싸지 않는다 — 그 봉투는 Business 의 {@code ApiResponseAdvice}
 * 몫이고 내부 표면은 알맹이만 돌려준다.
 */
@RestController
@RequestMapping("/internal/auth")
@RequiredArgsConstructor
public class InternalSessionIssueController {

    private final AuthService authService;
    private final GuestLoginRateLimiter guestLoginRateLimiter;

    /**
     * AT 재발급 — <b>회전 없음</b>(계정 LLD §3 미회전 호환 응답).
     *
     * <p>{@code refreshToken} 은 언제나 null 로 나간다. 그 필드를 여기서 만들지 않고 서비스가 준 값을
     * 그대로 싣는 이유는, 회전이 활성화되는 날 이 컨트롤러가 <b>거짓말을 하지 않게</b> 하기 위해서다.
     */
    @PostMapping("/sessions/refresh")
    public SessionRefreshResponse refresh(@RequestBody SessionRefreshRequest request) {
        TokenRefreshResponse refreshed = authService.refreshSessionAccessToken(request.refreshToken());
        return new SessionRefreshResponse(refreshed.accessToken(), refreshed.refreshToken());
    }

    /**
     * 게스트 시작 — 같은 기기 digest 의 복구 창 안 재시도는 <b>같은 userId</b> 를 돌려준다.
     *
     * <p>레이트리밋을 여기서 «먼저» 건다. 이 경로는 인증이 없어 호출 한 번마다 {@code users} 행이
     * 하나 생기므로(1.x {@code POST /api/v1/auth/guest} 와 같은 성질), 빼면 2.0 표면이 무제한 계정
     * 생성구가 된다. 기기 digest 유니크는 <b>대체재가 아니다</b> — 기기 식별자는 클라이언트 소유라
     * 값만 바꾸면 얼마든지 새 버킷이 된다({@link GuestLoginRateLimiter} 주석의 같은 논증).
     *
     * <p>게스트도 {@code deviceBootstrap} 을 싣는다(GROMO-2037). 게스트 계정도 푸시 기기를 등록하고,
     * 그 등록의 소유권 CAS·세션 확인은 소셜 로그인과 <b>같은</b> 자격 축 위에서 돈다 — 여기서 빼면
     * 게스트만 「자격 없이 수락」 경로로 남아 세션 전환 시 기기 정리가 성립하지 않는다.
     */
    @PostMapping("/guest-sessions")
    public LoginSessionResponse guestSession(@RequestBody GuestSessionRequest request) {
        guestLoginRateLimiter.check(request.clientIp());
        AuthService.LoginSessionResult issued = authService.guestSession(request.deviceDigest());
        return new LoginSessionResponse(issued.accessToken(), issued.refreshToken(),
                issued.userId(), issued.onboardingComplete(), issued.deviceBootstrap());
    }
}
