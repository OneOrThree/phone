package com.oneorthree.phone.auth.api;

import com.oneorthree.phone.auth.dto.AppleLoginRequest;
import com.oneorthree.phone.auth.dto.KakaoLoginRequest;
import com.oneorthree.phone.auth.dto.LogoutRequest;
import com.oneorthree.phone.auth.dto.TokenRefreshRequest;
import com.oneorthree.phone.auth.dto.AppleLoginResponse;
import com.oneorthree.phone.auth.dto.GuestLoginResponse;
import com.oneorthree.phone.auth.dto.KakaoLoginResponse;
import com.oneorthree.phone.auth.dto.TokenRefreshResponse;
import com.oneorthree.phone.auth.service.AuthService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@Tag(name = "auth", description = "인증 관련 API")
@RestController
@RequestMapping("/api/v1/auth")
@RequiredArgsConstructor
public class AuthController {

    private final AuthService authService;

    @Operation(summary = "카카오 로그인", description = "카카오 Access Token → AT + RT 발급. 최초 로그인 시 isNewUser=true.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "로그인 성공"),
        @ApiResponse(responseCode = "401", description = "유효하지 않은 카카오 토큰")
    })
    @PostMapping("/kakao")
    public ResponseEntity<KakaoLoginResponse> kakaoLogin(@RequestBody KakaoLoginRequest request) {
        return ResponseEntity.ok(authService.kakaoLogin(request.kakaoAccessToken()));
    }

    @Operation(summary = "애플 로그인", description = "Apple Identity Token 검증 후 AT/RT 발급. 최초 로그인 시 isNewUser=true.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "로그인 성공"),
        @ApiResponse(responseCode = "401", description = "Identity Token 검증 실패")
    })
    @PostMapping("/apple")
    public ResponseEntity<AppleLoginResponse> appleLogin(@RequestBody AppleLoginRequest request) {
        return ResponseEntity.ok(authService.appleLogin(request.identityToken(), request.fullName()));
    }

    @Operation(summary = "게스트 로그인", description = "소셜 계정 없이 임시 사용자 생성. 일부 기능(그룹 생성·챌린지 참여 등) 제한 적용.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "게스트 로그인 성공")
    })
    @PostMapping("/guest")
    public ResponseEntity<GuestLoginResponse> guestLogin() {
        return ResponseEntity.ok(authService.guestLogin());
    }

    @Operation(summary = "토큰 갱신", description = "Refresh Token → 새 Access Token 발급. RT는 갱신되지 않음.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "토큰 갱신 성공"),
        @ApiResponse(responseCode = "401", description = "유효하지 않은 Refresh Token")
    })
    @PostMapping("/refresh")
    public ResponseEntity<TokenRefreshResponse> refreshToken(@RequestBody TokenRefreshRequest request) {
        return ResponseEntity.ok(authService.refreshToken(request.refreshToken()));
    }

    @Operation(summary = "로그아웃", description = "Refresh Token 무효화. 클라이언트는 로컬 토큰도 삭제해야 함.")
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "로그아웃 성공"),
        @ApiResponse(responseCode = "400", description = "유효하지 않은 Refresh Token")
    })
    @PostMapping("/logout")
    public ResponseEntity<Void> logout(@RequestBody LogoutRequest request) {
        authService.logout(request.refreshToken());
        return ResponseEntity.noContent().build();
    }
}
