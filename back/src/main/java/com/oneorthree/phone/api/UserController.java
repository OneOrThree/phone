package com.oneorthree.phone.api;

import com.oneorthree.phone.api.dto.request.UserProfileSetupRequest;
import com.oneorthree.phone.service.UserService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@Tag(name = "user", description = "user 관련 API (생성, 조회, 변경)")
@RestController
@RequestMapping("/api/v1/user")
@RequiredArgsConstructor
public class UserController {

    private final UserService userService;

    @Operation(summary = "유저 정보 등록", description = "신규 유저 정보 등록")
    @PostMapping("")
    public ResponseEntity<?> setupProfile(
            HttpServletRequest request,
            @RequestBody UserProfileSetupRequest body) {
        Long userId = (Long) request.getAttribute("userId");
        userService.setupProfile(userId, body);
        return ResponseEntity.ok().build();
    }
}
