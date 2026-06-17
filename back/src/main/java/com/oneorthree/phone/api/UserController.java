package com.oneorthree.phone.api;

import com.oneorthree.phone.api.dto.request.UserProfileSetupRequest;
import com.oneorthree.phone.api.dto.request.UserProfileUpdateRequest;
import com.oneorthree.phone.service.UserService;
import com.oneorthree.phone.service.dto.user.UserProfileResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@Tag(name = "user", description = "user 관련 API (생성, 조회, 변경)")
@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class UserController {

    private final UserService userService;

    @Operation(summary = "유저 정보 등록", description = "신규 유저 정보 등록")
    @PostMapping("/user")
    public ResponseEntity<Void> setupProfile(
            HttpServletRequest request,
            @RequestBody UserProfileSetupRequest body) {
        Long userId = (Long) request.getAttribute("userId");
        userService.setupProfile(userId, body);
        return ResponseEntity.ok().build();
    }

    @Operation(summary = "유저 정보 부분 수정", description = "기존 유저 정보 부분 수정")
    @PatchMapping("/user")
    public ResponseEntity<Void> updateProfile(
            HttpServletRequest request,
            @RequestBody UserProfileUpdateRequest body) {
        Long userId = (Long) request.getAttribute("userId");
        userService.updateProfile(userId, body);
        return ResponseEntity.ok().build();
    }

    @Operation(summary = "유저 정보 조회", description = "기존 유저 정보 조회")
    @GetMapping("/user")
    public ResponseEntity<UserProfileResponse> getProfile(HttpServletRequest request) {
        Long userId = (Long) request.getAttribute("userId");
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
        Long userId = (Long) request.getAttribute("userId");
        userService.withdraw(userId);
        return ResponseEntity.noContent().build();
    }

    // TODO GROMO-356: import 추가 — UpdateScreenTimePermissionRequest, @Valid
    // TODO GROMO-356: @Operation(summary = "스크린타임 권한 동의 상태 업데이트", description = "iOS Screen Time 권한 부여/취소 시 호출. 성공 시 204 반환.")
    //   @ApiResponses: 204 업데이트 성공, 404 유저 없음
    //   @PatchMapping("/users/me/screen-time-permission")
    //   public ResponseEntity<Void> updateScreenTimePermission(
    //       @Valid @RequestBody UpdateScreenTimePermissionRequest body, HttpServletRequest request)
    //   → userService.updateScreenTimePermission(userId, body); return ResponseEntity.noContent().build();
}
