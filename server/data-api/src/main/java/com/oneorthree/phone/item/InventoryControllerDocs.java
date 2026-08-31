package com.oneorthree.phone.item;

import com.oneorthree.phone.item.dto.GrantItemRequest;
import com.oneorthree.phone.item.dto.UserItemResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.ResponseEntity;

import java.util.List;
import java.util.UUID;

/**
 * {@code InventoryController} 의 OpenAPI 문서 면(面) — Swagger 애노테이션만 둔다(GROMO-1621).
 */
@Tag(name = "inventory", description = "인벤토리 관련 API (조회, 수령)")
public interface InventoryControllerDocs {

    @Operation(summary = "인벤토리 조회", description = "유저의 보유 아이템 목록 조회")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "조회 성공"),
        @ApiResponse(responseCode = "404", description = "유저 없음")
    })
    ResponseEntity<List<UserItemResponse>> getInventory(UUID userId);

    @Operation(summary = "아이템 지급", description = "유저에게 아이템 지급")
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "지급 성공"),
        @ApiResponse(responseCode = "400", description = "유효하지 않은 요청"),
        @ApiResponse(responseCode = "404", description = "유저 또는 아이템 없음")
    })
    ResponseEntity<Void> grantItem(GrantItemRequest request);
}
