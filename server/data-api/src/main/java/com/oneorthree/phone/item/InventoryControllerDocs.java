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

    /**
     * 보유 아이템 전체를 돌려준다.
     *
     * @param userId 조회 대상 로그인 유저
     * @return 보유 목록(페이지네이션 없음). 착용 여부는 여기 담기지 않으니 장비 조회로 따로 봐야 한다
     */
    @Operation(summary = "인벤토리 조회", description = "유저의 보유 아이템 목록 조회")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "조회 성공"),
        @ApiResponse(responseCode = "404", description = "유저 없음")
    })
    ResponseEntity<List<UserItemResponse>> getInventory(UUID userId);

    /**
     * 지정한 유저에게 아이템을 넣어 준다. 대상 유저를 바디로 받는 운영·테스트용 통로다.
     *
     * @param request 받을 유저와 아이템
     * @return 본문 없는 204. 이미 갖고 있으면 중복으로 쌓지 않고 조용히 넘어가므로 여러 번 불러도 결과가 같다
     */
    @Operation(summary = "아이템 지급", description = "유저에게 아이템 지급")
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "지급 성공"),
        @ApiResponse(responseCode = "400", description = "유효하지 않은 요청"),
        @ApiResponse(responseCode = "404", description = "유저 또는 아이템 없음")
    })
    ResponseEntity<Void> grantItem(GrantItemRequest request);
}
