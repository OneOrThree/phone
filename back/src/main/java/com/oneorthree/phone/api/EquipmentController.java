package com.oneorthree.phone.api;

import com.oneorthree.phone.api.dto.request.EquipRequest;
import com.oneorthree.phone.api.dto.response.CharacterEquipmentResponse;
import com.oneorthree.phone.domain.CharacterEquipment;
import com.oneorthree.phone.domain.SlotType;
import com.oneorthree.phone.service.EquipmentService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/equipment")
@RequiredArgsConstructor
public class EquipmentController {
    private final EquipmentService equipmentService;

    @GetMapping("/{userId}")
    public ResponseEntity<List<CharacterEquipmentResponse>> getEquipment(@PathVariable Long userId) {
        List<CharacterEquipmentResponse> response = equipmentService.getEquipment(userId)
                .stream()
                .map(CharacterEquipmentResponse::from)
                .toList();
        return ResponseEntity.ok(response);
    }

    @PostMapping("/equip")
    public ResponseEntity<CharacterEquipmentResponse> equip(@RequestBody EquipRequest request) {
        CharacterEquipment equipment = equipmentService.equip(request.getUserId(), request.getItemId());
        return ResponseEntity.ok(CharacterEquipmentResponse.from(equipment));
    }

    @DeleteMapping("/{userId}/{slotType}")
    public ResponseEntity<Void> unequip(@PathVariable Long userId,
                                        @PathVariable SlotType slotType) {
        equipmentService.unequip(userId, slotType);
        return ResponseEntity.ok().build();
    }
}
