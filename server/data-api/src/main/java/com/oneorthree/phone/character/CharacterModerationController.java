package com.oneorthree.phone.character;

import com.oneorthree.phone.character.dto.ImageModerationRequest;
import com.oneorthree.phone.character.dto.ImageModerationResponse;
import com.oneorthree.phone.character.service.CharacterModerationService;
import com.oneorthree.phone.common.auth.LoginUser;
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
@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class CharacterModerationController implements CharacterModerationControllerDocs {

    private final CharacterModerationService characterModerationService;

    /**
     * 이미지 한 장의 유해성을 검사한다.
     *
     * @param userId  요청자 — 판정 자체에는 쓰이지 않고, 검사 실패 로그의 추적 키로만 남는다
     * @param request 검사할 base64 PNG. 10MiB 를 넘으면 검사 전에 400/413 으로 잘린다
     * @return 항상 200. 통과·유해 판정·검사 불가가 모두 본문의 allowed·unavailable 조합으로 구분되며,
     *         외부 검사가 실패해도 오류 응답이 아니라 차단(allowed=false, unavailable=true)으로 내려간다
     */
    @PostMapping("/character/moderation")
    public ResponseEntity<ImageModerationResponse> moderate(
            @LoginUser UUID userId,
            @Valid @RequestBody ImageModerationRequest request) {
        ImageModerationResponse response = characterModerationService.moderate(userId, request);
        return ResponseEntity.ok(response);
    }
}
