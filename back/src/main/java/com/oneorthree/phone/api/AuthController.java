package com.oneorthree.phone.api;

import com.oneorthree.phone.api.dto.request.KakaoLoginRequest;
import com.oneorthree.phone.api.dto.request.TokenRefreshRequest;
import com.oneorthree.phone.api.dto.response.KakaoLoginResponse;
import com.oneorthree.phone.api.dto.response.TokenRefreshResponse;
import com.oneorthree.phone.service.AuthService;
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

    @PostMapping("/kakao")
    public ResponseEntity<KakaoLoginResponse> kakaoLogin(@RequestBody KakaoLoginRequest request) {
        KakaoLoginResponse response = authService.kakaoLogin(request.kakaoAccessToken());
        return ResponseEntity.ok(response);
    }

    @PostMapping("/refresh")
    public ResponseEntity<TokenRefreshResponse> refreshToken(@RequestBody TokenRefreshRequest request) {
        TokenRefreshResponse response = authService.refreshToken(request.refreshToken());
        return ResponseEntity.ok(response);
    }
}
