package com.oneorthree.phone.character;

import com.oneorthree.phone.character.dto.CharacterQuotaResponse;
import com.oneorthree.phone.character.dto.RecordGenerationRequest;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.ResponseEntity;

import java.util.UUID;

/**
 * {@code CharacterController} 의 OpenAPI 문서 면(面) — Swagger 애노테이션만 둔다(GROMO-1621).
 */
@Tag(name = "character", description = "누끼(캐릭터) 생성 쿼터 API")
public interface CharacterControllerDocs {

    @Operation(summary = "생성 쿼터 조회",
            description = "이 API 를 처음 호출한 시점부터 7일 무제한(trial), 이후 롤링 7일 내 3회. "
                    + "unlimited 면 remaining·resetAt 은 null.")
    @ApiResponses({
            @ApiResponse(responseCode = "200", description = "조회 성공"),
            @ApiResponse(responseCode = "404", description = "유저 없음")
    })
    ResponseEntity<CharacterQuotaResponse> getQuota(UUID userId);

    @Operation(summary = "생성 1건 기록",
            description = "클라가 이미지 저장에 성공한 뒤 호출. 생성 1건을 기록하고 갱신된 쿼터를 반환. "
                    + "body 는 옵션 — clientGenerationId(멱등키)를 보내면 재시도 시 슬롯 중복 소비를 막는다.")
    @ApiResponses({
            @ApiResponse(responseCode = "200", description = "기록 성공(갱신된 쿼터 반환)"),
            @ApiResponse(responseCode = "404", description = "유저 없음")
    })
    ResponseEntity<CharacterQuotaResponse> recordGeneration(UUID userId, RecordGenerationRequest request);
}
