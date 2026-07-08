package com.oneorthree.phone.user.api;

import com.oneorthree.phone.user.dto.PublicProfileResponse;
import com.oneorthree.phone.user.dto.UserStatsResponse;
import com.oneorthree.phone.user.service.ProfileService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;
import java.util.UUID;

/**
 * 타 유저 공개 프로필 API (GROMO-520).
 */
@Tag(name = "profile", description = "타 유저 공개 프로필 API")
@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class ProfileController {

    private final ProfileService profileService;

    @Operation(summary = "타 유저 공개 프로필 조회",
            description = "대상 유저의 닉네임·캐릭터·친구수·리그 티어·랭킹을 반환한다.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "조회 성공"),
        @ApiResponse(responseCode = "404", description = "유저 없음 또는 탈퇴 유저")
    })
    @GetMapping("/users/{userId}/profile")
    public ResponseEntity<PublicProfileResponse> getPublicProfile(@PathVariable UUID userId) {
        // callerId 는 현재 미사용: 차단·친구 여부 기반 공개 범위 제어 기능이 없어 누구나 동일 응답을 받는다.
        // 향후 차단/친구-공개 기능 추가 시 SecurityContextHolder 에서 callerId 를 추출해 서비스에 전달한다.
        return ResponseEntity.ok(profileService.getPublicProfile(userId));
    }

    @Operation(summary = "타 유저 통계 조회",
            description = "친구O/본인 → 세부 통계(today·streak·heatmap). 친구X(PENDING 포함) → streak 만 반환. "
                    + "본인 조회 시 isFriend=false 이지만 세부 통계가 채워짐.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "조회 성공"),
        @ApiResponse(responseCode = "401", description = "인증 필요"),
        @ApiResponse(responseCode = "404", description = "유저 없음 또는 탈퇴 유저")
    })
    @GetMapping("/users/{userId}/stats")
    public ResponseEntity<UserStatsResponse> getUserStats(
            @PathVariable UUID userId,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date,
            HttpServletRequest request) {
        UUID callerId = (UUID) request.getAttribute("userId");
        return ResponseEntity.ok(profileService.getUserStats(callerId, userId, date));
    }
}
