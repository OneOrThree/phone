package com.oneorthree.phone.auth;

import com.oneorthree.phone.auth.dto.req.AppleLoginRequest;
import com.oneorthree.phone.auth.dto.req.LogoutRequest;
import com.oneorthree.phone.auth.dto.req.SocialLoginRequest;
import com.oneorthree.phone.auth.dto.req.TokenRefreshRequest;
import com.oneorthree.phone.auth.dto.res.GuestLoginResponse;
import com.oneorthree.phone.auth.dto.res.SocialLoginResponse;
import com.oneorthree.phone.auth.dto.res.TokenRefreshResponse;
import com.oneorthree.phone.auth.service.AuthService;
import com.oneorthree.phone.auth.support.GuestLoginRateLimiter;
import com.oneorthree.phone.common.util.ClientIpResolver;
import com.oneorthree.phone.user.repository.domain.Provider;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 인증 API. Swagger 애노테이션은 {@link AuthControllerDocs} 로 분리했다(GROMO-1621).
 */
@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class AuthController implements AuthControllerDocs {

    private final AuthService authService;
    private final ClientIpResolver clientIpResolver;
    private final GuestLoginRateLimiter guestLoginRateLimiter;

    @Override
    @PostMapping("/auth/google")
    public ResponseEntity<SocialLoginResponse> googleLogin(
            @RequestBody SocialLoginRequest request,
            @RequestHeader(value = "Authorization", required = false) String authorization) {
        return ResponseEntity.ok(authService.socialLogin(Provider.GOOGLE, request.token(), authorization));
    }

    @Override
    @PostMapping("/auth/line")
    public ResponseEntity<SocialLoginResponse> lineLogin(
            @RequestBody SocialLoginRequest request,
            @RequestHeader(value = "Authorization", required = false) String authorization) {
        return ResponseEntity.ok(authService.socialLogin(Provider.LINE, request.token(), authorization));
    }

    @Override
    @PostMapping("/auth/instagram")
    public ResponseEntity<SocialLoginResponse> instagramLogin(
            @RequestBody SocialLoginRequest request,
            @RequestHeader(value = "Authorization", required = false) String authorization) {
        return ResponseEntity.ok(authService.socialLogin(Provider.INSTAGRAM, request.token(), authorization));
    }

    @Override
    @PostMapping("/auth/facebook")
    public ResponseEntity<SocialLoginResponse> facebookLogin(
            @RequestBody SocialLoginRequest request,
            @RequestHeader(value = "Authorization", required = false) String authorization) {
        return ResponseEntity.ok(authService.socialLogin(Provider.FACEBOOK, request.token(), authorization));
    }

    @Override
    @PostMapping("/auth/kakao")
    public ResponseEntity<SocialLoginResponse> kakaoLogin(
            @RequestBody SocialLoginRequest request,
            @RequestHeader(value = "Authorization", required = false) String authorization) {
        return ResponseEntity.ok(authService.socialLogin(Provider.KAKAO, request.token(), authorization));
    }

    @Override
    @PostMapping("/auth/apple")
    public ResponseEntity<SocialLoginResponse> appleLogin(
            @RequestBody AppleLoginRequest request,
            @RequestHeader(value = "Authorization", required = false) String authorization) {
        return ResponseEntity.ok(authService.socialLogin(Provider.APPLE, request.identityToken(), authorization));
    }

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

    @Override
    @PostMapping("/auth/logout")
    public ResponseEntity<Void> logout(@RequestBody LogoutRequest request) {
        authService.logout(request.refreshToken());
        return ResponseEntity.noContent().build();
    }
}
