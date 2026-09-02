package com.oneorthree.phone.user;

import com.oneorthree.phone.user.dto.PublicProfileResponse;
import com.oneorthree.phone.user.dto.UserStatsResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.ResponseEntity;

import java.time.LocalDate;
import java.util.UUID;

/**
 * {@code ProfileController} 의 OpenAPI 문서 면(面) — Swagger 애노테이션만 둔다(GROMO-1621).
 */
@Tag(name = "profile", description = "타 유저 공개 프로필 API")
public interface ProfileControllerDocs {

    /**
     * @param userId   조회 <b>대상</b> 유저. 탈퇴 유저면 404
     * @param callerId 인증 토큰에서 주입되는 호출자 — relation·isPinned 가 이 사람 기준으로 계산된다
     * @return 공개 프로필(200). 본인을 조회하면 relation=NONE·isPinned=false 로 내려간다
     */
    @Operation(summary = "타 유저 공개 프로필 조회",
            description = "대상 유저의 닉네임·캐릭터·친구수·리그 티어·랭킹과 호출자 기준 relation(NONE|PENDING|FRIEND, "
                    + "PENDING 은 방향 무구분)·isPinned 를 반환한다. 본인 조회 시 relation=NONE·isPinned=false (GROMO-1631).")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "조회 성공"),
        @ApiResponse(responseCode = "401", description = "인증 필요"),
        @ApiResponse(responseCode = "404", description = "유저 없음 또는 탈퇴 유저")
    })
    ResponseEntity<PublicProfileResponse> getPublicProfile(UUID userId, UUID callerId);

    /**
     * @param userId   조회 대상 유저. 탈퇴 유저면 404
     * @param date     '오늘'로 삼을 날짜(KST 기준). 스트릭 만료 반영과 히트맵 끝 날짜가 이 값에 걸린다
     * @param callerId 인증 토큰에서 주입되는 호출자 — 친구·공개 게이트 판정 기준
     * @return 통계(200). 요약(streak·today)은 항상 채워지고 <b>heatmap 만 게이트</b>다 —
     *         본인·친구이거나 대상이 전체공개일 때만 값이 있고 그 외엔 null 이다
     */
    @Operation(summary = "타 유저 통계 조회",
            description = "프로필 요약(streak·today)은 친구 여부/공개설정과 무관하게 항상 반환(GROMO-746). "
                    + "세부 차트(heatmap)만 공개 게이트 — 친구O·본인, 또는 대상 PUBLIC 이면 반환, 그 외 null. "
                    + "본인 조회 시 isFriend=false 이지만 heatmap 이 채워짐.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "조회 성공"),
        @ApiResponse(responseCode = "401", description = "인증 필요"),
        @ApiResponse(responseCode = "404", description = "유저 없음 또는 탈퇴 유저")
    })
    ResponseEntity<UserStatsResponse> getUserStats(UUID userId, LocalDate date, UUID callerId);
}
