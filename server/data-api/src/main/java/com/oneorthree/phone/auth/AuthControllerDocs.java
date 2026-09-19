package com.oneorthree.phone.auth;

import com.oneorthree.phone.auth.dto.req.TokenRefreshRequest;
import com.oneorthree.phone.auth.dto.res.GuestLoginResponse;
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
}
