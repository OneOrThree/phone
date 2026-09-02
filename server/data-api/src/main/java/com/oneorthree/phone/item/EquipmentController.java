package com.oneorthree.phone.item;

import com.oneorthree.phone.common.auth.LoginUser;
import com.oneorthree.phone.item.dto.EquipRequest;
import com.oneorthree.phone.item.dto.CharacterEquipmentResponse;
import com.oneorthree.phone.item.repository.domain.SlotType;
import com.oneorthree.phone.item.service.EquipmentService;
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

/**
 * 장비 API. Swagger 애노테이션은 {@link EquipmentControllerDocs} 로 분리했다(GROMO-1621).
 */
@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class EquipmentController implements EquipmentControllerDocs {

    private final EquipmentService equipmentService;

    // 장비 API 의 대상은 항상 인증 주체다 — userId 를 경로·바디로 받지 않는다 (GROMO-363).
    // 예전에는 클라이언트가 준 userId 를 그대로 신뢰해, 로그인만 하면 남의 장비를 조회·장착·해제할 수 있었다.

    @Override
    @GetMapping("/equipment")
    public ResponseEntity<List<CharacterEquipmentResponse>> getEquipment(@LoginUser UUID userId) {
        List<CharacterEquipmentResponse> response = equipmentService.getEquipment(userId);
        return ResponseEntity.ok(response);
    }

    @Override
    @PostMapping("/equipment/equip")
    public ResponseEntity<CharacterEquipmentResponse> equip(
            @LoginUser UUID userId,
            @RequestBody EquipRequest request) {
        CharacterEquipmentResponse response = equipmentService.equip(userId, request.getItemId());
        return ResponseEntity.ok(response);
    }

    @Override
    @DeleteMapping("/equipment/{slotType}")
    public ResponseEntity<Void> unequip(@LoginUser UUID userId,
                                        @PathVariable SlotType slotType) {
        equipmentService.unequip(userId, slotType);
        return ResponseEntity.noContent().build();
    }

}
