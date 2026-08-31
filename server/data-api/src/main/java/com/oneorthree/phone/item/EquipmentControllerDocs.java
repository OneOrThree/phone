package com.oneorthree.phone.item;

import com.oneorthree.phone.item.dto.EquipRequest;
import com.oneorthree.phone.item.dto.CharacterEquipmentResponse;
import com.oneorthree.phone.item.repository.domain.SlotType;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.ResponseEntity;

import java.util.List;
import java.util.UUID;

/**
 * {@code EquipmentController} 의 OpenAPI 문서 면(面) — Swagger 애노테이션만 둔다(GROMO-1621).
 */
@Tag(name = "equipment", description = "장비 관련 API")
public interface EquipmentControllerDocs {

    @Operation(summary = "착용 장비 확인", description = "현재 장비 착용 상태를 반환합니다.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "조회 성공"),
        @ApiResponse(responseCode = "404", description = "유저 없음")
    })
    ResponseEntity<List<CharacterEquipmentResponse>> getEquipment(UUID userId);

    @Operation(summary = "장비 장착", description = "장비 장착 요청 처리")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "장착 성공"),
        @ApiResponse(responseCode = "400", description = "유효하지 않은 요청"),
        @ApiResponse(responseCode = "404", description = "유저 또는 아이템 없음")
    })
    ResponseEntity<CharacterEquipmentResponse> equip(UUID userId, EquipRequest request);

    @Operation(summary = "장비 해제", description = "장비 해제 요청 처리")
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "해제 성공"),
        @ApiResponse(responseCode = "404", description = "유저 또는 장비 없음")
    })
    ResponseEntity<Void> unequip(UUID userId, SlotType slotType);
}
