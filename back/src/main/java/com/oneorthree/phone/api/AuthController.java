package com.oneorthree.phone.api;

import com.oneorthree.phone.api.dto.request.KakaoLoginRequest;
import com.oneorthree.phone.api.dto.request.TokenRefreshRequest;
import com.oneorthree.phone.api.dto.response.KakaoLoginResponse;
import com.oneorthree.phone.api.dto.response.TokenRefreshResponse;
import com.oneorthree.phone.service.AuthService;
import io.swagger.v3.oas.annotations.Operation;
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

    @Operation(summary = "카카오 로그인", description = "카카오 Access Token → AT + RT 발급")
    @PostMapping("/kakao")
    public ResponseEntity<KakaoLoginResponse> kakaoLogin(@RequestBody KakaoLoginRequest request) {
        return ResponseEntity.ok(authService.kakaoLogin(request.kakaoAccessToken()));
    }

    @Operation(summary = "토큰 갱신", description = "Refresh Token → 새 Access Token 발급")
    @PostMapping("/refresh")
    public ResponseEntity<TokenRefreshResponse> refreshToken(@RequestBody TokenRefreshRequest request) {
        return ResponseEntity.ok(authService.refreshToken(request.refreshToken()));
    }
}
