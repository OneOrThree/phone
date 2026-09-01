package com.oneorthree.phone.user;

import com.oneorthree.phone.common.auth.LoginUser;
import com.oneorthree.phone.user.repository.domain.Provider;
import com.oneorthree.phone.user.dto.DeviceTokenRegisterRequest;
import com.oneorthree.phone.user.dto.FocusTimeGoalUpdateRequest;
import com.oneorthree.phone.user.dto.NicknameCheckResponse;
import com.oneorthree.phone.user.dto.NotificationSettingsRequest;
import com.oneorthree.phone.user.dto.NotificationSettingsResponse;
import com.oneorthree.phone.user.dto.OccupationUpdateRequest;
import com.oneorthree.phone.user.dto.ScreenTimeGoalUpdateRequest;
import com.oneorthree.phone.user.dto.SocialLinkResponse;
import com.oneorthree.phone.user.dto.StatVisibilityUpdateRequest;
import com.oneorthree.phone.user.dto.UserProfileSetupRequest;
import com.oneorthree.phone.user.dto.UserProfileUpdateRequest;
import com.oneorthree.phone.user.service.UserService;
import com.oneorthree.phone.user.dto.UpdateScreenTimePermissionRequest;
import com.oneorthree.phone.user.dto.UserProfileResponse;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

/**
 * 유저 프로필·설정 API. Swagger 애노테이션은 {@link UserControllerDocs} 로 분리했다(GROMO-1621).
 */
@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class UserController implements UserControllerDocs {

    private final UserService userService;

    @Override
    @PostMapping("/users/me")
    public ResponseEntity<Void> setupProfile(
            @LoginUser UUID userId,
            @Valid @RequestBody UserProfileSetupRequest body) {
        userService.setupProfile(userId, body);
        return ResponseEntity.noContent().build();
    }

    @Override
    @PatchMapping("/users/me")
    public ResponseEntity<Void> updateProfile(
            @LoginUser UUID userId,
            @Valid @RequestBody UserProfileUpdateRequest body) {
        userService.updateProfile(userId, body);
        return ResponseEntity.noContent().build();
    }

    @Override
    @GetMapping("/users/nickname/check")
    public ResponseEntity<NicknameCheckResponse> checkNickname(
            @RequestParam(required = false) String nickname,
            @LoginUser UUID userId) {
        // required=false — 파라미터 누락도 "항상 200 {available:false}" 계약에 태운다(400 분기 없음)
        return ResponseEntity.ok(new NicknameCheckResponse(userService.isNicknameAvailable(userId, nickname)));
    }

    @Override
    @GetMapping("/users/me")
    public ResponseEntity<UserProfileResponse> getProfile(@LoginUser UUID userId) {
        return ResponseEntity.ok(userService.getProfile(userId));
    }

    @Override
    @DeleteMapping("/users/me")
    public ResponseEntity<Void> withdraw(@LoginUser UUID userId) {
        userService.withdraw(userId);
        return ResponseEntity.noContent().build();
    }

    @Override
    @PatchMapping("/users/me/screen-time-permission")
    public ResponseEntity<Void> updateScreenTimePermission(
            @Valid @RequestBody UpdateScreenTimePermissionRequest body,
            @LoginUser UUID userId) {
        userService.updateScreenTimePermission(userId, body);
        return ResponseEntity.noContent().build();
    }

    @Override
    @PutMapping("/users/me/device-token")
    public ResponseEntity<Void> registerDeviceToken(
            @Valid @RequestBody DeviceTokenRegisterRequest body,
            @LoginUser UUID userId) {
        userService.registerDeviceToken(userId, body.getDeviceToken());
        return ResponseEntity.noContent().build();
    }

    @Override
    @DeleteMapping("/users/me/device-token")
    public ResponseEntity<Void> clearDeviceToken(@LoginUser UUID userId) {
        userService.clearDeviceToken(userId);
        return ResponseEntity.noContent().build();
    }

    @Override
    @PutMapping("/users/me/notification-settings")
    public ResponseEntity<Void> updateNotificationSettings(
            @Valid @RequestBody NotificationSettingsRequest body,
            @LoginUser UUID userId) {
        userService.updateNotificationSettings(userId, body);
        return ResponseEntity.noContent().build();
    }

    @Override
    @GetMapping("/users/me/notification-settings")
    public ResponseEntity<NotificationSettingsResponse> getNotificationSettings(@LoginUser UUID userId) {
        return ResponseEntity.ok(userService.getNotificationSettings(userId));
    }

    @Override
    @PatchMapping("/users/me/screen-time-goal")
    public ResponseEntity<Void> updateScreenTimeGoal(
            @Valid @RequestBody ScreenTimeGoalUpdateRequest body,
            @LoginUser UUID userId) {
        userService.updateScreenTimeGoal(userId, body.getDailyScreenTimeGoalMinutes());
        return ResponseEntity.noContent().build();
    }

    @Override
    @PatchMapping("/users/me/focus-time-goal")
    public ResponseEntity<Void> updateFocusTimeGoal(
            @Valid @RequestBody FocusTimeGoalUpdateRequest body,
            @LoginUser UUID userId) {
        userService.updateFocusTimeGoal(userId, body.getDailyFocusTimeGoalMinutes());
        return ResponseEntity.noContent().build();
    }

    @Override
    @PatchMapping("/users/me/occupation")
    public ResponseEntity<Void> updateOccupation(
            @Valid @RequestBody OccupationUpdateRequest body,
            @LoginUser UUID userId) {
        userService.updateOccupation(userId, body.getOccupation());
        return ResponseEntity.noContent().build();
    }

    @Override
    @PatchMapping("/users/me/stat-visibility")
    public ResponseEntity<Void> updateStatVisibility(
            @Valid @RequestBody StatVisibilityUpdateRequest body,
            @LoginUser UUID userId) {
        userService.updateStatVisibility(userId, body.statVisibility());
        return ResponseEntity.noContent().build();
    }

    @Override
    @GetMapping("/users/me/social-links")
    public ResponseEntity<List<SocialLinkResponse>> getSocialLinks(@LoginUser UUID userId) {
        return ResponseEntity.ok(userService.getSocialLinks(userId));
    }

    @Override
    @DeleteMapping("/users/me/social-links/{provider}")
    public ResponseEntity<Void> unlinkSocialAccount(
            @PathVariable Provider provider,
            @LoginUser UUID userId) {
        userService.unlinkSocialAccount(userId, provider);
        return ResponseEntity.noContent().build();
    }
}
