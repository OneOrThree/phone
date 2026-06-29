package com.oneorthree.phone.user.api;

import com.oneorthree.phone.user.dto.DeviceTokenRegisterRequest;
import com.oneorthree.phone.user.dto.NotificationSettingsRequest;
import com.oneorthree.phone.user.dto.OccupationUpdateRequest;
import com.oneorthree.phone.user.dto.ScreenTimeGoalUpdateRequest;
import com.oneorthree.phone.user.dto.UserProfileSetupRequest;
import com.oneorthree.phone.user.dto.UserProfileUpdateRequest;
import com.oneorthree.phone.user.service.UserService;
import com.oneorthree.phone.user.dto.UpdateScreenTimePermissionRequest;
import com.oneorthree.phone.user.dto.UserProfileResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

@Tag(name = "user", description = "user 관련 API (생성, 조회, 변경)")
@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class UserController {

    private final UserService userService;

    @Operation(summary = "유저 정보 등록", description = "신규 유저 정보 등록")
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "등록 성공"),
        @ApiResponse(responseCode = "400", description = "유효성 검사 실패"),
        @ApiResponse(responseCode = "404", description = "유저 없음")
    })
    @PostMapping("/user")
    public ResponseEntity<Void> setupProfile(
            HttpServletRequest request,
            @RequestBody UserProfileSetupRequest body) {
        UUID userId = (UUID) request.getAttribute("userId");
        userService.setupProfile(userId, body);
        return ResponseEntity.noContent().build();
    }

    @Operation(summary = "유저 정보 부분 수정", description = "기존 유저 정보 부분 수정")
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "수정 성공"),
        @ApiResponse(responseCode = "400", description = "유효성 검사 실패"),
        @ApiResponse(responseCode = "404", description = "유저 없음")
    })
    @PatchMapping("/user")
    public ResponseEntity<Void> updateProfile(
            HttpServletRequest request,
            @RequestBody UserProfileUpdateRequest body) {
        UUID userId = (UUID) request.getAttribute("userId");
        userService.updateProfile(userId, body);
        return ResponseEntity.noContent().build();
    }

    @Operation(summary = "유저 정보 조회", description = "기존 유저 정보 조회")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "조회 성공"),
        @ApiResponse(responseCode = "404", description = "유저 없음")
    })
    @GetMapping("/user")
    public ResponseEntity<UserProfileResponse> getProfile(HttpServletRequest request) {
        UUID userId = (UUID) request.getAttribute("userId");
        return ResponseEntity.ok(userService.getProfile(userId));
    }

    @Operation(summary = "회원 탈퇴", description = "개인정보 파기 후 계정 삭제. 방장인 그룹은 위임 후 탈퇴 가능.")
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "탈퇴 완료"),
        @ApiResponse(responseCode = "400", description = "방장 위임 후 탈퇴 가능"),
        @ApiResponse(responseCode = "404", description = "유저 없음")
    })
    @DeleteMapping("/user")
    public ResponseEntity<Void> withdraw(HttpServletRequest request) {
        UUID userId = (UUID) request.getAttribute("userId");
        userService.withdraw(userId);
        return ResponseEntity.noContent().build();
    }

    @Operation(summary = "스크린타임 권한 동의 상태 업데이트", description = "iOS Screen Time 권한 부여/취소 시 호출. 성공 시 204 반환.")
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "업데이트 성공"),
        @ApiResponse(responseCode = "400", description = "granted 필드 누락"),
        @ApiResponse(responseCode = "404", description = "유저 없음")
    })
    @PatchMapping("/users/me/screen-time-permission")
    public ResponseEntity<Void> updateScreenTimePermission(
            @Valid @RequestBody UpdateScreenTimePermissionRequest body,
            HttpServletRequest request) {
        UUID userId = (UUID) request.getAttribute("userId");
        userService.updateScreenTimePermission(userId, body);
        return ResponseEntity.noContent().build();
    }

    @Operation(summary = "디바이스 토큰 등록", description = "앱 시작 시 APNs 디바이스 토큰을 등록/갱신. 성공 시 204 반환.")
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "등록 성공"),
        @ApiResponse(responseCode = "400", description = "deviceToken 누락"),
        @ApiResponse(responseCode = "404", description = "유저 없음")
    })
    @PutMapping("/users/me/device-token")
    public ResponseEntity<Void> registerDeviceToken(
            @Valid @RequestBody DeviceTokenRegisterRequest body,
            HttpServletRequest request) {
        UUID userId = (UUID) request.getAttribute("userId");
        userService.registerDeviceToken(userId, body.getDeviceToken());
        return ResponseEntity.noContent().build();
    }

    @Operation(summary = "알림·심야·소리 설정 저장",
            description = "유저 전역 알림/심야 모드/소리 설정 저장. 성공 시 204 반환.")
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "저장 성공"),
        @ApiResponse(responseCode = "400", description = "필수 필드 누락"),
        @ApiResponse(responseCode = "404", description = "유저 없음")
    })
    @PutMapping("/users/me/notification-settings")
    public ResponseEntity<Void> updateNotificationSettings(
            @Valid @RequestBody NotificationSettingsRequest body,
            HttpServletRequest request) {
        UUID userId = (UUID) request.getAttribute("userId");
        userService.updateNotificationSettings(userId, body);
        return ResponseEntity.noContent().build();
    }

    @Operation(summary = "스크린타임 목표 수정",
            description = "일일 스크린타임 목표(분)를 수정. 음수는 400. 성공 시 204 반환.")
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "수정 성공"),
        @ApiResponse(responseCode = "400", description = "목표값 누락/음수"),
        @ApiResponse(responseCode = "404", description = "유저 없음")
    })
    @PatchMapping("/users/me/screen-time-goal")
    public ResponseEntity<Void> updateScreenTimeGoal(
            @Valid @RequestBody ScreenTimeGoalUpdateRequest body,
            HttpServletRequest request) {
        UUID userId = (UUID) request.getAttribute("userId");
        userService.updateScreenTimeGoal(userId, body.getDailyScreenTimeGoalMinutes());
        return ResponseEntity.noContent().build();
    }

    @Operation(summary = "준비 시험 카테고리(occupation) 저장",
            description = "온보딩에서 선택한 시험 카테고리를 users.occupation 에 저장. 성공 시 204 반환.")
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "저장 성공"),
        @ApiResponse(responseCode = "400", description = "occupation 누락/유효하지 않은 값"),
        @ApiResponse(responseCode = "404", description = "유저 없음")
    })
    @PatchMapping("/users/me/occupation")
    public ResponseEntity<Void> updateOccupation(
            @Valid @RequestBody OccupationUpdateRequest body,
            HttpServletRequest request) {
        UUID userId = (UUID) request.getAttribute("userId");
        userService.updateOccupation(userId, body.getOccupation());
        return ResponseEntity.noContent().build();
    }
}
