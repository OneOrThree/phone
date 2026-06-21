package com.oneorthree.phone.item.api;

import com.oneorthree.phone.item.dto.GrantItemRequest;
import com.oneorthree.phone.item.dto.UserItemResponse;
import com.oneorthree.phone.item.service.InventoryService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@Tag(name = "inventory", description = "인벤토리 관련 API (조회, 수령)")
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
    @GetMapping("/inventory/{userId}")
    public ResponseEntity<List<UserItemResponse>> getInventory(@PathVariable Long userId) {
        List<UserItemResponse> response = inventoryService.getInventory(userId);
        return ResponseEntity.ok(response);
    }

    @Operation(summary = "아이템 지급", description = "유저에게 아이템 지급")
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "지급 성공"),
        @ApiResponse(responseCode = "400", description = "유효하지 않은 요청"),
        @ApiResponse(responseCode = "404", description = "유저 또는 아이템 없음")
    })
    @PostMapping("/inventory/grant")
    public ResponseEntity<Void> grantItem(@RequestBody GrantItemRequest request) {
        inventoryService.grantItem(request.getUserId(), request.getItemId());
        return ResponseEntity.noContent().build();
    }

}
