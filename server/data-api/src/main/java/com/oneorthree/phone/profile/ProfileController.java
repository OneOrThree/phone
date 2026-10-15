package com.oneorthree.phone.profile;

import com.oneorthree.phone.common.auth.LoginUser;
import com.oneorthree.phone.profile.dto.PublicProfileResponse;
import com.oneorthree.phone.profile.dto.UserStatsResponse;
import com.oneorthree.phone.profile.service.ProfileService;
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
    public ResponseEntity<PublicProfileResponse> getPublicProfile(
            @PathVariable UUID userId,
            @LoginUser UUID callerId) {
        // callerId 는 relation(친구 관계)·isPinned(핀 여부) 판정에 쓴다 (GROMO-1631).
        // 이 경로는 JwtFilter WHITELIST 에 없어 인증 필수 — @LoginUser 주입이 항상 성립한다.
        return ResponseEntity.ok(profileService.getPublicProfile(callerId, userId));
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
