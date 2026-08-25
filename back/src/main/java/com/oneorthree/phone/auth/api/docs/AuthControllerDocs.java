package com.oneorthree.phone.auth.api.docs;

import com.oneorthree.phone.auth.dto.rep.AppleLoginRequest;
import com.oneorthree.phone.auth.dto.rep.LogoutRequest;
import com.oneorthree.phone.auth.dto.rep.SocialLoginRequest;
import com.oneorthree.phone.auth.dto.rep.TokenRefreshRequest;
import com.oneorthree.phone.auth.dto.res.GuestLoginResponse;
import com.oneorthree.phone.auth.dto.res.SocialLoginResponse;
import com.oneorthree.phone.auth.dto.res.TokenRefreshResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;

/**
 * {@code AuthController} 의 OpenAPI 문서 면(面) — Swagger 애노테이션만 둔다(GROMO-1621).
 */
@Tag(name = "auth", description = "인증 관련 API")
public interface AuthControllerDocs {

    @Operation(summary = "구글 로그인", description = "Google id_token 검증 후 AT/RT 발급. 최초 로그인 시 isNewUser=true.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "로그인 성공"),
        @ApiResponse(responseCode = "401", description = "유효하지 않은 Google 토큰"),
        @ApiResponse(responseCode = "409",
                description = "게스트 승격 충돌 — 이미 다른 계정에 연동된 소셜 계정(SOCIAL_ACCOUNT_ALREADY_LINKED) "
                        + "또는 이미 다른 계정으로 승격된 게스트(GUEST_ALREADY_PROMOTED)")
    })
    ResponseEntity<SocialLoginResponse> googleLogin(SocialLoginRequest request, String authorization);

    @Operation(summary = "라인 로그인", description = "LINE Access Token 검증 후 AT/RT 발급. 최초 로그인 시 isNewUser=true.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "로그인 성공"),
        @ApiResponse(responseCode = "401", description = "유효하지 않은 LINE 토큰"),
        @ApiResponse(responseCode = "409",
                description = "게스트 승격 충돌 — 이미 다른 계정에 연동된 소셜 계정(SOCIAL_ACCOUNT_ALREADY_LINKED) "
                        + "또는 이미 다른 계정으로 승격된 게스트(GUEST_ALREADY_PROMOTED)")
    })
    ResponseEntity<SocialLoginResponse> lineLogin(SocialLoginRequest request, String authorization);

    @Operation(summary = "인스타그램 로그인",
            description = "Instagram Access Token 검증 후 AT/RT 발급. 최초 로그인 시 isNewUser=true.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "로그인 성공"),
        @ApiResponse(responseCode = "401", description = "유효하지 않은 Instagram 토큰"),
        @ApiResponse(responseCode = "409",
                description = "게스트 승격 충돌 — 이미 다른 계정에 연동된 소셜 계정(SOCIAL_ACCOUNT_ALREADY_LINKED) "
                        + "또는 이미 다른 계정으로 승격된 게스트(GUEST_ALREADY_PROMOTED)")
    })
    ResponseEntity<SocialLoginResponse> instagramLogin(SocialLoginRequest request, String authorization);

    @Operation(summary = "페이스북 로그인",
            description = "Facebook(Meta) Limited Login id_token 검증 후 AT/RT 발급. 최초 로그인 시 isNewUser=true.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "로그인 성공"),
        @ApiResponse(responseCode = "401", description = "유효하지 않은 Facebook 토큰"),
        @ApiResponse(responseCode = "409",
                description = "게스트 승격 충돌 — 이미 다른 계정에 연동된 소셜 계정(SOCIAL_ACCOUNT_ALREADY_LINKED) "
                        + "또는 이미 다른 계정으로 승격된 게스트(GUEST_ALREADY_PROMOTED)")
    })
    ResponseEntity<SocialLoginResponse> facebookLogin(SocialLoginRequest request, String authorization);

    @Operation(summary = "카카오 로그인", description = "카카오 Access Token → AT + RT 발급. 최초 로그인 시 isNewUser=true.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "로그인 성공"),
        @ApiResponse(responseCode = "401", description = "유효하지 않은 카카오 토큰"),
        @ApiResponse(responseCode = "409",
                description = "게스트 승격 충돌 — 이미 다른 계정에 연동된 소셜 계정(SOCIAL_ACCOUNT_ALREADY_LINKED) "
                        + "또는 이미 다른 계정으로 승격된 게스트(GUEST_ALREADY_PROMOTED)")
    })
    ResponseEntity<SocialLoginResponse> kakaoLogin(SocialLoginRequest request, String authorization);

    @Operation(summary = "애플 로그인", description = "Apple Identity Token 검증 후 AT/RT 발급. 최초 로그인 시 isNewUser=true.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "로그인 성공"),
        @ApiResponse(responseCode = "401", description = "Identity Token 검증 실패"),
        @ApiResponse(responseCode = "409",
                description = "게스트 승격 충돌 — 이미 다른 계정에 연동된 소셜 계정(SOCIAL_ACCOUNT_ALREADY_LINKED) "
                        + "또는 이미 다른 계정으로 승격된 게스트(GUEST_ALREADY_PROMOTED)")
    })
    ResponseEntity<SocialLoginResponse> appleLogin(AppleLoginRequest request, String authorization);

    @Operation(summary = "게스트 로그인",
            description = "소셜 계정 없이 임시 사용자 생성. 일부 기능(그룹 생성·챌린지 참여 등) 제한 적용.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "게스트 로그인 성공"),
        @ApiResponse(responseCode = "429",
                description = "IP 당 게스트 생성 한도 초과(GUEST_CREATION_RATE_LIMITED) — 잠시 후 재시도")
    })
    ResponseEntity<GuestLoginResponse> guestLogin(HttpServletRequest request);

    @Operation(summary = "토큰 갱신", description = "Refresh Token → 새 Access Token 발급. RT는 갱신되지 않음.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "토큰 갱신 성공"),
        @ApiResponse(responseCode = "401", description = "유효하지 않은 Refresh Token")
    })
    ResponseEntity<TokenRefreshResponse> refreshToken(TokenRefreshRequest request);

    @Operation(summary = "로그아웃", description = "Refresh Token 무효화. 클라이언트는 로컬 토큰도 삭제해야 함.")
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "로그아웃 성공"),
        @ApiResponse(responseCode = "400", description = "유효하지 않은 Refresh Token")
    })
    ResponseEntity<Void> logout(LogoutRequest request);
}
