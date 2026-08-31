package com.oneorthree.phone.character;

import com.oneorthree.phone.character.service.dto.CharacterQuotaResponse;
import com.oneorthree.phone.character.service.dto.RecordGenerationRequest;
import com.oneorthree.phone.character.service.CharacterGenerationService;
import com.oneorthree.phone.common.auth.LoginUser;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/**
 * 누끼(캐릭터) 생성 쿼터 API.
 * Swagger 애노테이션은 {@link CharacterControllerDocs} 로 분리했다(GROMO-1621).
 */
@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class CharacterController implements CharacterControllerDocs {

    private final CharacterGenerationService characterGenerationService;

    @Override
    @GetMapping("/character/quota")
    public ResponseEntity<CharacterQuotaResponse> getQuota(@LoginUser UUID userId) {
        return ResponseEntity.ok(characterGenerationService.getQuota(userId));
    }

    @Override
    @PostMapping("/character/generation")
    public ResponseEntity<CharacterQuotaResponse> recordGeneration(
            @LoginUser UUID userId,
            @RequestBody(required = false) RecordGenerationRequest request) {
        UUID clientGenerationId = request == null ? null : request.clientGenerationId();
        return ResponseEntity.ok(characterGenerationService.recordGeneration(userId, clientGenerationId));
    }
}
