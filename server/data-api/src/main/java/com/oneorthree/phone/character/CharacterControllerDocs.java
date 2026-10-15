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

    /**
     * 남은 생성 횟수를 돌려준다. 캐릭터 만들기 화면 진입 시 호출되며, 이 호출이
     * 유저의 trial 시작 시각을 처음으로 못 박는 부수효과를 가진다.
     *
     * @param userId 조회 대상 로그인 유저
     * @return trial 구간이면 unlimited=true(remaining·resetAt 은 null),
     *         제한 구간이면 남은 횟수와 슬롯이 다시 열리는 시각
     */
    @Operation(summary = "생성 쿼터 조회",
            description = "이 API 를 처음 호출한 시점부터 7일 무제한(trial), 이후 롤링 7일 내 3회. "
                    + "unlimited 면 remaining·resetAt 은 null.")
    @ApiResponses({
            @ApiResponse(responseCode = "200", description = "조회 성공"),
            @ApiResponse(responseCode = "404", description = "유저 없음")
    })
    ResponseEntity<CharacterQuotaResponse> getQuota(UUID userId);

    /**
     * 생성 1건을 원장에 적고 갱신된 쿼터를 돌려준다. 한도의 실제 관문은 조회가 아니라 이쪽이다.
     *
     * @param userId  기록 대상 로그인 유저
     * @param request 멱등키(clientGenerationId)를 담을 수 있는 옵션 바디 — 같은 키가 이미 있으면
     *                재기록하지 않아 재시도로 슬롯이 두 번 깎이지 않는다
     * @return 기록 후 쿼터. 이미 한도에 닿아 기록이 생략된 경우에도 200 과 현재 쿼터를 준다
     */
    @Operation(summary = "생성 1건 기록",
            description = "클라가 이미지 저장에 성공한 뒤 호출. 생성 1건을 기록하고 갱신된 쿼터를 반환. "
                    + "body 는 옵션 — clientGenerationId(멱등키)를 보내면 재시도 시 슬롯 중복 소비를 막는다.")
    @ApiResponses({
            @ApiResponse(responseCode = "200", description = "기록 성공(갱신된 쿼터 반환)"),
            @ApiResponse(responseCode = "404", description = "유저 없음")
    })
    ResponseEntity<CharacterQuotaResponse> recordGeneration(UUID userId, RecordGenerationRequest request);
}
