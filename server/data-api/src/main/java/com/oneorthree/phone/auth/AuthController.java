package com.oneorthree.phone.auth;

import com.oneorthree.phone.auth.dto.req.TokenRefreshRequest;
import com.oneorthree.phone.auth.dto.res.GuestLoginResponse;
import com.oneorthree.phone.auth.dto.res.TokenRefreshResponse;
import com.oneorthree.phone.auth.service.AuthService;
import com.oneorthree.phone.auth.support.GuestLoginRateLimiter;
import com.oneorthree.phone.common.util.ClientIpResolver;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 레거시 인증 API — guest·refresh 두 경로만 남는다. 소셜 로그인·logout 은 2.0 의 business-api
 * {@code POST /auth/sessions}·{@code DELETE /auth/sessions/current} 로 옮겨 가 지웠다(GROMO-1947, A24④).
 * Swagger 애노테이션은 {@link AuthControllerDocs} 로 분리했다(GROMO-1621).
 */
@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class AuthController implements AuthControllerDocs {

    private final AuthService authService;
    private final ClientIpResolver clientIpResolver;
    private final GuestLoginRateLimiter guestLoginRateLimiter;

    @Override
    @PostMapping("/auth/guest")
    public ResponseEntity<GuestLoginResponse> guestLogin(HttpServletRequest request) {
        // 인증이 없는 유일한 계정 생성 경로라 IP 단위 생성 제한을 먼저 태운다 (GROMO-1510)
        guestLoginRateLimiter.check(clientIpResolver.resolve(request));
        return ResponseEntity.ok(authService.guestLogin());
    }

    @Override
    @PostMapping("/auth/refresh")
    public ResponseEntity<TokenRefreshResponse> refreshToken(@RequestBody TokenRefreshRequest request) {
        return ResponseEntity.ok(authService.refreshToken(request.refreshToken()));
    }
}
