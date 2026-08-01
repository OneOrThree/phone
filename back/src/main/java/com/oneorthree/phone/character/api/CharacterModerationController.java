package com.oneorthree.phone.character.api;

import com.oneorthree.phone.character.dto.ImageModerationRequest;
import com.oneorthree.phone.character.dto.ImageModerationResponse;
import com.oneorthree.phone.character.service.ImageModerationService;
import com.oneorthree.phone.common.auth.LoginUser;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

@Tag(name = "character", description = "캐릭터 커스터마이징 API")
@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class CharacterModerationController {

    private final ImageModerationService imageModerationService;

    @Operation(summary = "누끼 이미지 유해성 검사",
            description = "누끼 저장 직전 이미지를 OpenAI omni-moderation 으로 검사합니다. 이미지는 저장하지 않고 "
                    + "검사만 합니다. allowed=false 면 유해로 판정된 것이며, 검사 실패 시 안전하게 차단합니다.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "검사 완료 — allowed 로 통과/거부 구분"),
        @ApiResponse(responseCode = "400", description = "image 누락 또는 크기 초과"),
        @ApiResponse(responseCode = "401", description = "인증 없음")
    })
    @PostMapping("/character/moderation")
    public ResponseEntity<ImageModerationResponse> moderate(
            @LoginUser UUID userId,
            @Valid @RequestBody ImageModerationRequest request) {
        ImageModerationResponse response = imageModerationService.moderate(userId, request);
        return ResponseEntity.ok(response);
    }
}
