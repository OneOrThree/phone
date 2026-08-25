package com.oneorthree.phone.user.api;

import com.oneorthree.phone.common.auth.LoginUser;
import com.oneorthree.phone.user.api.docs.ProfileControllerDocs;
import com.oneorthree.phone.user.dto.PublicProfileResponse;
import com.oneorthree.phone.user.dto.UserStatsResponse;
import com.oneorthree.phone.user.service.ProfileService;
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
 * Swagger 애노테이션은 {@link ProfileControllerDocs} 로 분리했다(GROMO-1621).
 */
@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class ProfileController implements ProfileControllerDocs {

    private final ProfileService profileService;

    @Override
    @GetMapping("/users/{userId}/profile")
    public ResponseEntity<PublicProfileResponse> getPublicProfile(@PathVariable UUID userId) {
        // callerId 는 현재 미사용: 차단·친구 여부 기반 공개 범위 제어 기능이 없어 누구나 동일 응답을 받는다.
        // 향후 차단/친구-공개 기능 추가 시 SecurityContextHolder 에서 callerId 를 추출해 서비스에 전달한다.
        return ResponseEntity.ok(profileService.getPublicProfile(userId));
    }

    @Override
    @GetMapping("/users/{userId}/stats")
    public ResponseEntity<UserStatsResponse> getUserStats(
            @PathVariable UUID userId,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date,
            @LoginUser UUID callerId) {
        return ResponseEntity.ok(profileService.getUserStats(callerId, userId, date));
    }
}
