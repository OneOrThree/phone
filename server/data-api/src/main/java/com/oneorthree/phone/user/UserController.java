package com.oneorthree.phone.user;

import io.swagger.v3.oas.annotations.Parameter;
import com.oneorthree.phone.common.auth.LoginUser;
import com.oneorthree.phone.user.dto.DeviceTokenRegisterRequest;
import com.oneorthree.phone.user.dto.NicknameCheckResponse;
import com.oneorthree.phone.user.dto.OccupationUpdateRequest;
import com.oneorthree.phone.user.service.UserService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/**
 * 레거시 유저 API 잔여분. 프로필·설정·소셜 연동 경로는 2.0 의 business-api {@code GET/PATCH /me}·
 * {@code /me/settings} 로 옮겨 가 지웠다(GROMO-1947, A24④). 남은 것은 기기 토큰 2종과 2.0 매핑이
 * 결정되지 않은 닉네임 사전확인·직업 저장이다(legacy-v1-retirement §5). Swagger 애노테이션은 {@link UserControllerDocs} 로 분리했다(GROMO-1621).
 */
@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class UserController implements UserControllerDocs {

    private final UserService userService;

    @Override
    @GetMapping("/users/nickname/check")
    public ResponseEntity<NicknameCheckResponse> checkNickname(
            @Parameter(description = "검사할 닉네임(trim 전 원문). 미전달 시 available=false")
            @RequestParam(required = false) String nickname,
            @LoginUser UUID userId) {
        // required=false — 파라미터 누락도 "항상 200 {available:false}" 계약에 태운다(400 분기 없음)
        return ResponseEntity.ok(new NicknameCheckResponse(userService.isNicknameAvailable(userId, nickname)));
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
    @PatchMapping("/users/me/occupation")
    public ResponseEntity<Void> updateOccupation(
            @Valid @RequestBody OccupationUpdateRequest body,
            @LoginUser UUID userId) {
        userService.updateOccupation(userId, body.getOccupation());
        return ResponseEntity.noContent().build();
    }
}
