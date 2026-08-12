package com.oneorthree.phone.item.api;

import com.oneorthree.phone.common.auth.LoginUser;
import com.oneorthree.phone.item.dto.UserItemResponse;
import com.oneorthree.phone.item.service.InventoryService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

@Tag(name = "inventory", description = "인벤토리 조회 API")
@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class InventoryController {

    private final InventoryService inventoryService;

    @Operation(summary = "인벤토리 조회", description = "유저의 보유 아이템 목록 조회")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "조회 성공"),
        @ApiResponse(responseCode = "404", description = "유저 없음")
    })
    // 조회 대상은 항상 인증 주체다 — 예전에는 경로의 userId 로 남의 인벤토리를 볼 수 있었다 (GROMO-363).
    @GetMapping("/inventory")
    public ResponseEntity<List<UserItemResponse>> getInventory(@LoginUser UUID userId) {
        List<UserItemResponse> response = inventoryService.getInventory(userId);
        return ResponseEntity.ok(response);
    }
}
