package com.oneorthree.phone.api;

import com.oneorthree.phone.service.ScreenTimeService;
import com.oneorthree.phone.service.dto.screentime.ScreenTimeRequest;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

@Tag(name = "ScreenTime", description = "스크린 타임 목표 달성 저장 API")
@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class ScreenTimeController {

    private final ScreenTimeService screenTimeService;

    @Operation(summary = "스크린 타임 저장", description = "매일 23:59 iOS 앱이 당일 스크린타임 달성 여부를 전송. 달성 여부는 iOS에서 계산.")
    @ApiResponses({
            @ApiResponse(responseCode = "204", description = "저장 성공"),
            @ApiResponse(responseCode = "400", description = "유효성 검사 실패 또는 잘못된 타임존"),
            @ApiResponse(responseCode = "404", description = "유저 없음")
    })
    @PostMapping("/screen-time")
    public ResponseEntity<Void> saveScreenTime(
            @Valid @RequestBody ScreenTimeRequest request,
            HttpServletRequest httpServletRequest) {
        UUID userId = (UUID) httpServletRequest.getAttribute("userId");
        screenTimeService.saveScreenTime(userId, request);
        return ResponseEntity.noContent().build();
    }
}
