package com.oneorthree.phone.auth;

import com.oneorthree.phone.auth.dto.req.AppleLoginRequest;
import com.oneorthree.phone.auth.dto.req.LogoutRequest;
import com.oneorthree.phone.auth.dto.req.SocialLoginRequest;
import com.oneorthree.phone.auth.dto.req.TokenRefreshRequest;
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

    /**
     * 구글 로그인 — 미인증 공개 엔드포인트다({@code JwtFilter} 화이트리스트). 그래서 게스트 승격 판정에
     * 쓸 자체 AT 를 인증 컨텍스트에서 못 받고 {@code authorization} 파라미터로 직접 받는다.
     *
     * @param request 구글이 발급한 id_token 을 담은 요청 본문
     * @param authorization 게스트 승격 판정용 <b>우리 서비스</b>의 access 토큰({@code Bearer …}).
     *                      유효한 게스트 토큰이면 그 계정을 이 소셜 계정으로 승격시키고,
     *                      없거나 무효면 조용히 신규 가입으로 흐른다 — 인증 실패로 400/401 을 내지 않는다
     * @return 200 = AT·RT 와 {@code isNewUser}(최초 가입 여부).
     *         401 = 제공자 토큰 검증 실패, 409 = 승격 충돌(이미 남에게 연동된 소셜 계정이거나 이미 승격된 게스트)
     */
    @Operation(summary = "구글 로그인", description = "Google id_token 검증 후 AT/RT 발급. 최초 로그인 시 isNewUser=true.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "로그인 성공"),
        @ApiResponse(responseCode = "401", description = "유효하지 않은 Google 토큰"),
        @ApiResponse(responseCode = "409",
                description = "게스트 승격 충돌 — 이미 다른 계정에 연동된 소셜 계정(SOCIAL_ACCOUNT_ALREADY_LINKED) "
                        + "또는 이미 다른 계정으로 승격된 게스트(GUEST_ALREADY_PROMOTED)")
    })
    ResponseEntity<SocialLoginResponse> googleLogin(SocialLoginRequest request, String authorization);

    /**
     * 라인 로그인 — 미인증 공개 엔드포인트다({@code JwtFilter} 화이트리스트). 그래서 게스트 승격 판정에
     * 쓸 자체 AT 를 인증 컨텍스트에서 못 받고 {@code authorization} 파라미터로 직접 받는다.
     *
     * @param request LINE 액세스 토큰을 담은 요청 본문
     * @param authorization 게스트 승격 판정용 <b>우리 서비스</b>의 access 토큰({@code Bearer …}).
     *                      유효한 게스트 토큰이면 그 계정을 이 소셜 계정으로 승격시키고,
     *                      없거나 무효면 조용히 신규 가입으로 흐른다 — 인증 실패로 400/401 을 내지 않는다
     * @return 200 = AT·RT 와 {@code isNewUser}(최초 가입 여부).
     *         401 = 제공자 토큰 검증 실패, 409 = 승격 충돌(이미 남에게 연동된 소셜 계정이거나 이미 승격된 게스트)
     */
    @Operation(summary = "라인 로그인", description = "LINE Access Token 검증 후 AT/RT 발급. 최초 로그인 시 isNewUser=true.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "로그인 성공"),
        @ApiResponse(responseCode = "401", description = "유효하지 않은 LINE 토큰"),
        @ApiResponse(responseCode = "409",
                description = "게스트 승격 충돌 — 이미 다른 계정에 연동된 소셜 계정(SOCIAL_ACCOUNT_ALREADY_LINKED) "
                        + "또는 이미 다른 계정으로 승격된 게스트(GUEST_ALREADY_PROMOTED)")
    })
    ResponseEntity<SocialLoginResponse> lineLogin(SocialLoginRequest request, String authorization);

    /**
     * 인스타그램 로그인 — 미인증 공개 엔드포인트다({@code JwtFilter} 화이트리스트). 그래서 게스트 승격 판정에
     * 쓸 자체 AT 를 인증 컨텍스트에서 못 받고 {@code authorization} 파라미터로 직접 받는다.
     *
     * @param request 인스타그램 액세스 토큰을 담은 요청 본문
     * @param authorization 게스트 승격 판정용 <b>우리 서비스</b>의 access 토큰({@code Bearer …}).
     *                      유효한 게스트 토큰이면 그 계정을 이 소셜 계정으로 승격시키고,
     *                      없거나 무효면 조용히 신규 가입으로 흐른다 — 인증 실패로 400/401 을 내지 않는다
     * @return 200 = AT·RT 와 {@code isNewUser}(최초 가입 여부).
     *         401 = 제공자 토큰 검증 실패, 409 = 승격 충돌(이미 남에게 연동된 소셜 계정이거나 이미 승격된 게스트)
     */
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

    /**
     * 페이스북 로그인 — 미인증 공개 엔드포인트다({@code JwtFilter} 화이트리스트). 그래서 게스트 승격 판정에
     * 쓸 자체 AT 를 인증 컨텍스트에서 못 받고 {@code authorization} 파라미터로 직접 받는다.
     *
     * @param request Facebook Limited Login id_token 을 담은 요청 본문
     * @param authorization 게스트 승격 판정용 <b>우리 서비스</b>의 access 토큰({@code Bearer …}).
     *                      유효한 게스트 토큰이면 그 계정을 이 소셜 계정으로 승격시키고,
     *                      없거나 무효면 조용히 신규 가입으로 흐른다 — 인증 실패로 400/401 을 내지 않는다
     * @return 200 = AT·RT 와 {@code isNewUser}(최초 가입 여부).
     *         401 = 제공자 토큰 검증 실패, 409 = 승격 충돌(이미 남에게 연동된 소셜 계정이거나 이미 승격된 게스트)
     */
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

    /**
     * 카카오 로그인 — 미인증 공개 엔드포인트다({@code JwtFilter} 화이트리스트). 그래서 게스트 승격 판정에
     * 쓸 자체 AT 를 인증 컨텍스트에서 못 받고 {@code authorization} 파라미터로 직접 받는다.
     *
     * @param request 카카오 액세스 토큰을 담은 요청 본문
     * @param authorization 게스트 승격 판정용 <b>우리 서비스</b>의 access 토큰({@code Bearer …}).
     *                      유효한 게스트 토큰이면 그 계정을 이 소셜 계정으로 승격시키고,
     *                      없거나 무효면 조용히 신규 가입으로 흐른다 — 인증 실패로 400/401 을 내지 않는다
     * @return 200 = AT·RT 와 {@code isNewUser}(최초 가입 여부).
     *         401 = 제공자 토큰 검증 실패, 409 = 승격 충돌(이미 남에게 연동된 소셜 계정이거나 이미 승격된 게스트)
     */
    @Operation(summary = "카카오 로그인", description = "카카오 Access Token → AT + RT 발급. 최초 로그인 시 isNewUser=true.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "로그인 성공"),
        @ApiResponse(responseCode = "401", description = "유효하지 않은 카카오 토큰"),
        @ApiResponse(responseCode = "409",
                description = "게스트 승격 충돌 — 이미 다른 계정에 연동된 소셜 계정(SOCIAL_ACCOUNT_ALREADY_LINKED) "
                        + "또는 이미 다른 계정으로 승격된 게스트(GUEST_ALREADY_PROMOTED)")
    })
    ResponseEntity<SocialLoginResponse> kakaoLogin(SocialLoginRequest request, String authorization);

    /**
     * 애플 로그인 — 미인증 공개 엔드포인트다({@code JwtFilter} 화이트리스트). 그래서 게스트 승격 판정에
     * 쓸 자체 AT 를 인증 컨텍스트에서 못 받고 {@code authorization} 파라미터로 직접 받는다.
     *
     * @param request Apple identityToken·authorizationCode·fullName 을 담은 요청 본문. fullName 은 애플이 최초 1회만 주지만 닉네임으로 쓰지 않는다
     * @param authorization 게스트 승격 판정용 <b>우리 서비스</b>의 access 토큰({@code Bearer …}).
     *                      유효한 게스트 토큰이면 그 계정을 이 소셜 계정으로 승격시키고,
     *                      없거나 무효면 조용히 신규 가입으로 흐른다 — 인증 실패로 400/401 을 내지 않는다
     * @return 200 = AT·RT 와 {@code isNewUser}(최초 가입 여부).
     *         401 = 제공자 토큰 검증 실패, 409 = 승격 충돌(이미 남에게 연동된 소셜 계정이거나 이미 승격된 게스트)
     */
    @Operation(summary = "애플 로그인", description = "Apple Identity Token 검증 후 AT/RT 발급. 최초 로그인 시 isNewUser=true.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "로그인 성공"),
        @ApiResponse(responseCode = "401", description = "Identity Token 검증 실패"),
        @ApiResponse(responseCode = "409",
                description = "게스트 승격 충돌 — 이미 다른 계정에 연동된 소셜 계정(SOCIAL_ACCOUNT_ALREADY_LINKED) "
                        + "또는 이미 다른 계정으로 승격된 게스트(GUEST_ALREADY_PROMOTED)")
    })
    ResponseEntity<SocialLoginResponse> appleLogin(AppleLoginRequest request, String authorization);

    /**
     * 게스트 로그인 — 소셜 계정 없이 <b>매 호출마다 새 User 를 만든다</b>. 인증이 필요 없는 만큼
     * 계정 양산으로 리그 랭킹·그룹 베팅을 흔들 수 있어 IP 당 생성 한도가 걸려 있다.
     *
     * @param request 요청 객체를 통째로 받는 건 rate limit 키로 쓸 클라이언트 IP 를
     *                프록시 헤더까지 보고 뽑아내야 하기 때문이다 — 본문에서 읽는 값은 없다
     * @return 200 = 새로 만든 게스트의 AT·RT({@code isNewUser} 는 항상 true).
     *         429 = IP 당 게스트 생성 한도 초과({@code GUEST_CREATION_RATE_LIMITED})
     */
    @Operation(summary = "게스트 로그인",
            description = "소셜 계정 없이 임시 사용자 생성. 일부 기능(그룹 생성·챌린지 참여 등) 제한 적용.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "게스트 로그인 성공"),
        @ApiResponse(responseCode = "429",
                description = "IP 당 게스트 생성 한도 초과(GUEST_CREATION_RATE_LIMITED) — 잠시 후 재시도")
    })
    ResponseEntity<GuestLoginResponse> guestLogin(HttpServletRequest request);

    /**
     * 토큰 갱신 — refresh 토큰을 정상 입력으로 받아들이는 유일한 엔드포인트다.
     * 그 밖의 {@code /api/*} 는 {@code JwtFilter} 의 타입 가드가 refresh 토큰을 거부한다.
     *
     * @param request 클라이언트가 보관 중인 refresh 토큰
     * @return 200 = 새 access 토큰. 응답의 {@code refreshToken} 은 <b>회전이 일어났을 때만</b>
     *         (남은 수명이 발급 수명의 절반 미만일 때) 채워지고 그 밖에는 {@code null} 이다 —
     *         클라이언트는 값이 있을 때만 저장소를 갱신해야 한다.
     *         401 = 서명·만료 무효, refresh 가 아닌 타입, 저장된 해시와 불일치({@code REFRESH_TOKEN})
     */
    @Operation(summary = "토큰 갱신",
            description = "Refresh Token → 새 Access Token 발급. RT 는 남은 수명이 절반 미만일 때만 "
                    + "함께 회전하며(GROMO-1509), 회전했을 때만 응답의 refreshToken 이 채워진다.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "토큰 갱신 성공"),
        @ApiResponse(responseCode = "401", description = "유효하지 않은 Refresh Token")
    })
    ResponseEntity<TokenRefreshResponse> refreshToken(TokenRefreshRequest request);

    /**
     * 로그아웃 — 서버가 지우는 건 저장된 refresh 토큰 해시뿐이다.
     * <b>이미 발급된 access 토큰은 만료까지 그대로 유효하다</b>(무상태 JWT 라 회수 수단이 없다).
     * 즉시 차단이 필요한 건 탈퇴 경로이고, 그쪽은 {@code JwtFilter} 의 소프트딜리트 조회가 막는다.
     *
     * @param request 무효화할 refresh 토큰. access 토큰으로 남의 세션을 끊지 못하도록
     *                갱신과 같은 refresh 타입 가드를 적용한다
     * @return 204 = 무효화 완료(클라이언트는 로컬에 남은 AT·RT 도 반드시 지워야 한다).
     *         무효한 토큰이면 {@code InvalidTokenException(REFRESH_TOKEN)} 이라 실제 응답은 401 이다
     *         — 아래 {@code @ApiResponse} 의 400 표기와 어긋난다
     */
    @Operation(summary = "로그아웃", description = "Refresh Token 무효화. 클라이언트는 로컬 토큰도 삭제해야 함.")
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "로그아웃 성공"),
        @ApiResponse(responseCode = "401", description = "유효하지 않은 Refresh Token")
    })
    ResponseEntity<Void> logout(LogoutRequest request);
}
