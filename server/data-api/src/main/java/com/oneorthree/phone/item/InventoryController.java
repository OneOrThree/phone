package com.oneorthree.phone.item;

import com.oneorthree.phone.common.auth.LoginUser;
import com.oneorthree.phone.item.dto.GrantItemRequest;
import com.oneorthree.phone.item.dto.UserItemResponse;
import com.oneorthree.phone.item.service.InventoryService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

/**
 * 인벤토리 API. Swagger 애노테이션은 {@link InventoryControllerDocs} 로 분리했다(GROMO-1621).
 */
@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class InventoryController implements InventoryControllerDocs {

    private final InventoryService inventoryService;

    /**
     * 조회 대상은 항상 인증 주체다 — 예전에는 경로의 userId 로 남의 인벤토리를 볼 수 있었다 (GROMO-363).
     */
    @Override
    @GetMapping("/inventory")
    public ResponseEntity<List<UserItemResponse>> getInventory(@LoginUser UUID userId) {
        List<UserItemResponse> response = inventoryService.getInventory(userId);
        return ResponseEntity.ok(response);
    }

    /**
     * 지급 대상을 요청이 지정한다 — 관리자/시스템 용도라 @LoginUser 로 바꾸면 기능이 사라진다.
     * 호출 권한 설계는 GROMO-363 스코프 밖(별도 티켓)이다.
     */
    @Override
    @PostMapping("/inventory/grant")
    public ResponseEntity<Void> grantItem(@RequestBody GrantItemRequest request) {
        inventoryService.grantItem(request.getUserId(), request.getItemId());
        return ResponseEntity.noContent().build();
    }

}
