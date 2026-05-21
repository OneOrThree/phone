package com.oneorthree.phone.api;

import com.oneorthree.phone.api.dto.request.EquipRequest;
import com.oneorthree.phone.api.dto.response.CharacterEquipmentResponse;
import com.oneorthree.phone.domain.SlotType;
import com.oneorthree.phone.service.EquipmentService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@Tag(name="equipment", description = "장비 관련 API")
@RestController
@RequestMapping("/api/equipment")
@RequiredArgsConstructor
public class EquipmentController {
    private final EquipmentService equipmentService;

    @Operation(summary = "착용 장비 확인", description = "현재 장비 착용 상태를 반환합니다.")
    @GetMapping("/{userId}")
    public ResponseEntity<List<CharacterEquipmentResponse>> getEquipment(@PathVariable Long userId) {
        List<CharacterEquipmentResponse> response = equipmentService.getEquipment(userId);
        return ResponseEntity.ok(response);
    }

    @Operation(summary = "장비 장착", description = "장비 장착 요청 처리")
    @PostMapping("/equip")
    public ResponseEntity<CharacterEquipmentResponse> equip(@RequestBody EquipRequest request) {
        CharacterEquipmentResponse respone = equipmentService.equip(request.getUserId(), request.getItemId());
        return ResponseEntity.ok(respone);
    }

    @Operation(summary = "장비 해제", description = "장비 해제 요청 처리")
    @DeleteMapping("/{userId}/{slotType}")
    public ResponseEntity<Void> unequip(@PathVariable Long userId,
                                        @PathVariable SlotType slotType) {
        equipmentService.unequip(userId, slotType);
        return ResponseEntity.ok().build();
    }
}
