package com.oneorthree.phone.item.api;

import com.oneorthree.phone.common.auth.LoginUser;
import com.oneorthree.phone.item.dto.EquipRequest;
import com.oneorthree.phone.item.dto.CharacterEquipmentResponse;
import com.oneorthree.phone.item.domain.SlotType;
import com.oneorthree.phone.item.service.EquipmentService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

@Tag(name = "equipment", description = "장비 관련 API")
@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class EquipmentController {

    private final EquipmentService equipmentService;

    // 장비 API 의 대상은 항상 인증 주체다 — userId 를 경로·바디로 받지 않는다 (GROMO-363).
    // 예전에는 클라이언트가 준 userId 를 그대로 신뢰해, 로그인만 하면 남의 장비를 조회·장착·해제할 수 있었다.

    @Operation(summary = "착용 장비 확인", description = "현재 장비 착용 상태를 반환합니다.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "조회 성공"),
        @ApiResponse(responseCode = "404", description = "유저 없음")
    })
    @GetMapping("/equipment")
    public ResponseEntity<List<CharacterEquipmentResponse>> getEquipment(@LoginUser UUID userId) {
        List<CharacterEquipmentResponse> response = equipmentService.getEquipment(userId);
        return ResponseEntity.ok(response);
    }

    @Operation(summary = "장비 장착", description = "장비 장착 요청 처리")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "장착 성공"),
        @ApiResponse(responseCode = "400", description = "유효하지 않은 요청"),
        @ApiResponse(responseCode = "404", description = "유저 또는 아이템 없음")
    })
    @PostMapping("/equipment/equip")
    public ResponseEntity<CharacterEquipmentResponse> equip(
            @LoginUser UUID userId,
            @RequestBody EquipRequest request) {
        CharacterEquipmentResponse response = equipmentService.equip(userId, request.getItemId());
        return ResponseEntity.ok(response);
    }

    @Operation(summary = "장비 해제", description = "장비 해제 요청 처리")
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "해제 성공"),
        @ApiResponse(responseCode = "404", description = "유저 또는 장비 없음")
    })
    @DeleteMapping("/equipment/{slotType}")
    public ResponseEntity<Void> unequip(@LoginUser UUID userId,
                                        @PathVariable SlotType slotType) {
        equipmentService.unequip(userId, slotType);
        return ResponseEntity.noContent().build();
    }

}
