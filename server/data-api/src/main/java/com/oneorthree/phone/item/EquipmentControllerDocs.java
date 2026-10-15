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

    /**
     * 캐릭터가 지금 걸치고 있는 것들을 칸별로 돌려준다.
     *
     * @param userId 조회 대상 로그인 유저
     * @return 칸별 착용 상태. 한 번이라도 착용했다 벗은 칸은 item 이 null 인 채로 남아 있고,
     *         한 번도 손대지 않은 칸은 목록에 아예 없다
     */
    @Operation(summary = "착용 장비 확인", description = "현재 장비 착용 상태를 반환합니다.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "조회 성공"),
        @ApiResponse(responseCode = "404", description = "유저 없음")
    })
    ResponseEntity<List<CharacterEquipmentResponse>> getEquipment(UUID userId);

    /**
     * 아이템 하나를 캐릭터에 입힌다.
     *
     * @param userId  착용 주체 — 남의 캐릭터를 바꿀 통로는 없다
     * @param request 입힐 아이템. 아이템이 속한 칸은 아이템 자신이 정하며, 그 칸에 이미 걸친 것이
     *                있으면 요청 없이도 자동으로 교체된다
     * @return 교체 후 그 칸의 착용 상태. 보유하지 않은 아이템이면 400, 없는 아이템이면 404
     */
    @Operation(summary = "장비 장착", description = "장비 장착 요청 처리")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "장착 성공"),
        @ApiResponse(responseCode = "400", description = "유효하지 않은 요청"),
        @ApiResponse(responseCode = "404", description = "유저 또는 아이템 없음")
    })
    ResponseEntity<CharacterEquipmentResponse> equip(UUID userId, EquipRequest request);

    /**
     * 칸 하나를 비운다.
     *
     * @param userId   해제 주체
     * @param slotType 비울 칸. 아이템이 아니라 칸을 지정하므로 그 칸에 무엇이 걸쳐 있든 벗겨진다
     * @return 본문 없는 204. 이미 빈 칸이거나 손댄 적 없는 칸이어도 오류 없이 204 다
     */
    @Operation(summary = "장비 해제", description = "장비 해제 요청 처리")
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "해제 성공"),
        @ApiResponse(responseCode = "404", description = "유저 또는 장비 없음")
    })
    ResponseEntity<Void> unequip(UUID userId, SlotType slotType);
}
