package com.oneorthree.phone.auth.api;

import com.oneorthree.phone.auth.dto.rep.AppleLoginRequest;
import com.oneorthree.phone.auth.dto.rep.LogoutRequest;
import com.oneorthree.phone.auth.dto.rep.SocialLoginRequest;
import com.oneorthree.phone.auth.dto.rep.TokenRefreshRequest;
import com.oneorthree.phone.auth.dto.res.GuestLoginResponse;
import com.oneorthree.phone.auth.dto.res.SocialLoginResponse;
import com.oneorthree.phone.auth.dto.res.TokenRefreshResponse;
import com.oneorthree.phone.auth.service.AuthService;
import com.oneorthree.phone.user.domain.Provider;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@Tag(name = "auth", description = "인증 관련 API")
@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class AuthController {

    private final AuthService authService;

    @Operation(summary = "구글 로그인", description = "Google id_token 검증 후 AT/RT 발급. 최초 로그인 시 isNewUser=true.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "로그인 성공"),
        @ApiResponse(responseCode = "401", description = "유효하지 않은 Google 토큰")
    })
    @PostMapping("/auth/google")
    public ResponseEntity<SocialLoginResponse> googleLogin(
            @RequestBody SocialLoginRequest request,
            @RequestHeader(value = "Authorization", required = false) String authorization) {
        return ResponseEntity.ok(authService.socialLogin(Provider.GOOGLE, request.token(), authorization));
    }

    @Operation(summary = "라인 로그인", description = "LINE Access Token 검증 후 AT/RT 발급. 최초 로그인 시 isNewUser=true.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "로그인 성공"),
        @ApiResponse(responseCode = "401", description = "유효하지 않은 LINE 토큰")
    })
    @PostMapping("/auth/line")
    public ResponseEntity<SocialLoginResponse> lineLogin(
            @RequestBody SocialLoginRequest request,
            @RequestHeader(value = "Authorization", required = false) String authorization) {
        return ResponseEntity.ok(authService.socialLogin(Provider.LINE, request.token(), authorization));
    }

    @Operation(summary = "인스타그램 로그인", description = "Instagram Access Token 검증 후 AT/RT 발급. 최초 로그인 시 isNewUser=true.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "로그인 성공"),
        @ApiResponse(responseCode = "401", description = "유효하지 않은 Instagram 토큰")
    })
    @PostMapping("/auth/instagram")
    public ResponseEntity<SocialLoginResponse> instagramLogin(
            @RequestBody SocialLoginRequest request,
            @RequestHeader(value = "Authorization", required = false) String authorization) {
        return ResponseEntity.ok(authService.socialLogin(Provider.INSTAGRAM, request.token(), authorization));
    }

    @Operation(summary = "페이스북 로그인",
            description = "Facebook(Meta) Limited Login id_token 검증 후 AT/RT 발급. 최초 로그인 시 isNewUser=true.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "로그인 성공"),
        @ApiResponse(responseCode = "401", description = "유효하지 않은 Facebook 토큰")
    })
    @PostMapping("/auth/facebook")
    public ResponseEntity<SocialLoginResponse> facebookLogin(
            @RequestBody SocialLoginRequest request,
            @RequestHeader(value = "Authorization", required = false) String authorization) {
        return ResponseEntity.ok(authService.socialLogin(Provider.FACEBOOK, request.token(), authorization));
    }

    @Operation(summary = "카카오 로그인", description = "카카오 Access Token → AT + RT 발급. 최초 로그인 시 isNewUser=true.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "로그인 성공"),
        @ApiResponse(responseCode = "401", description = "유효하지 않은 카카오 토큰")
    })
    @PostMapping("/auth/kakao")
    public ResponseEntity<SocialLoginResponse> kakaoLogin(
            @RequestBody SocialLoginRequest request,
            @RequestHeader(value = "Authorization", required = false) String authorization) {
        return ResponseEntity.ok(authService.socialLogin(Provider.KAKAO, request.token(), authorization));
    }

    @Operation(summary = "애플 로그인", description = "Apple Identity Token 검증 후 AT/RT 발급. 최초 로그인 시 isNewUser=true.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "로그인 성공"),
        @ApiResponse(responseCode = "401", description = "Identity Token 검증 실패")
    })
    @PostMapping("/auth/apple")
    public ResponseEntity<SocialLoginResponse> appleLogin(
            @RequestBody AppleLoginRequest request,
            @RequestHeader(value = "Authorization", required = false) String authorization) {
        return ResponseEntity.ok(authService.socialLogin(Provider.APPLE, request.identityToken(), authorization));
    }

    @Operation(summary = "게스트 로그인", description = "소셜 계정 없이 임시 사용자 생성. 일부 기능(그룹 생성·챌린지 참여 등) 제한 적용.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "게스트 로그인 성공")
    })
    @PostMapping("/auth/guest")
    public ResponseEntity<GuestLoginResponse> guestLogin() {
        return ResponseEntity.ok(authService.guestLogin());
    }

    @Operation(summary = "토큰 갱신", description = "Refresh Token → 새 Access Token 발급. RT는 갱신되지 않음.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "토큰 갱신 성공"),
        @ApiResponse(responseCode = "401", description = "유효하지 않은 Refresh Token")
    })
    @PostMapping("/auth/refresh")
    public ResponseEntity<TokenRefreshResponse> refreshToken(@RequestBody TokenRefreshRequest request) {
        return ResponseEntity.ok(authService.refreshToken(request.refreshToken()));
    }

    @Operation(summary = "로그아웃", description = "Refresh Token 무효화. 클라이언트는 로컬 토큰도 삭제해야 함.")
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "로그아웃 성공"),
        @ApiResponse(responseCode = "400", description = "유효하지 않은 Refresh Token")
    })
    @PostMapping("/auth/logout")
    public ResponseEntity<Void> logout(@RequestBody LogoutRequest request) {
        authService.logout(request.refreshToken());
        return ResponseEntity.noContent().build();
    }
}
