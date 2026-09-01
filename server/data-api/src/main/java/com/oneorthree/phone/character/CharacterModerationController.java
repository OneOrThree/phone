package com.oneorthree.phone.character;

import com.oneorthree.phone.character.dto.ImageModerationRequest;
import com.oneorthree.phone.character.dto.ImageModerationResponse;
import com.oneorthree.phone.character.service.CharacterModerationService;
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

/**
 * 누끼 이미지를 저장 직전에 검사하는 창구. 이미지를 서버에 남기지 않고 판정만 돌려준다.
 * 판정 규칙과 검사 실패 시의 fail-closed 정책은 {@link CharacterModerationService} 가 쥔다.
 */
@Tag(name = "character", description = "캐릭터 커스터마이징 API")
@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class CharacterModerationController {

    private final CharacterModerationService characterModerationService;

    /**
     * 이미지 한 장의 유해성을 검사한다.
     *
     * @param userId  요청자 — 판정 자체에는 쓰이지 않고, 검사 실패 로그의 추적 키로만 남는다
     * @param request 검사할 base64 PNG. 10MiB 를 넘으면 검사 전에 400/413 으로 잘린다
     * @return 항상 200. 통과·유해 판정·검사 불가가 모두 본문의 allowed·unavailable 조합으로 구분되며,
     *         외부 검사가 실패해도 오류 응답이 아니라 차단(allowed=false, unavailable=true)으로 내려간다
     */
    @Operation(summary = "누끼 이미지 유해성 검사",
            description = "누끼 저장 직전 이미지를 OpenAI omni-moderation 으로 검사합니다. 이미지는 저장하지 않고 "
                    + "검사만 합니다. allowed=false 면 유해로 판정된 것이며, 검사 실패 시 안전하게 차단합니다.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "검사 완료 — allowed 로 통과/거부 구분"),
        @ApiResponse(responseCode = "400", description = "image 누락, 또는 base64 크기가 @Size(10MiB) 초과(전송방식 무관)"),
        @ApiResponse(responseCode = "401", description = "인증 없음"),
        @ApiResponse(responseCode = "413", description = "요청 본문(Content-Length)이 한도 초과 — 역직렬화 전 차단")
    })
    @PostMapping("/character/moderation")
    public ResponseEntity<ImageModerationResponse> moderate(
            @LoginUser UUID userId,
            @Valid @RequestBody ImageModerationRequest request) {
        ImageModerationResponse response = characterModerationService.moderate(userId, request);
        return ResponseEntity.ok(response);
    }
}
