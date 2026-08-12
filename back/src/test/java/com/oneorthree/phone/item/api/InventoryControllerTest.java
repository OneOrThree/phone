package com.oneorthree.phone.item.api;

import com.oneorthree.phone.common.auth.AuthAttributes;
import com.oneorthree.phone.item.dto.ItemResponse;
import com.oneorthree.phone.item.dto.UserItemResponse;
import com.oneorthree.phone.item.service.InventoryService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;
import java.util.UUID;

import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultHandlers.print;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 인벤토리 API 컨트롤러 테스트 (GROMO-363 에서 부활).
 * 조회 대상이 경로가 아니라 인증 주체에서 오는지를 확인한다.
 */
@WebMvcTest(controllers = InventoryController.class)
class InventoryControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private InventoryService inventoryService;

    private static final UUID LOGIN_USER_ID = UUID.fromString("00000000-0000-0000-0000-0000000000ca");
    private static final UUID ITEM_ID = UUID.fromString("00000000-0000-0000-0000-000000000011");
    private static final UUID USER_ITEM_ID = UUID.fromString("00000000-0000-0000-0000-000000000031");

    @Test
    @DisplayName("인벤토리 조회 → 200, 인증 주체의 보유 아이템을 반환")
    void getInventoryReturns200() throws Exception {
        UserItemResponse userItem = UserItemResponse.builder()
                .id(USER_ITEM_ID)
                .item(ItemResponse.builder()
                        .id(ITEM_ID)
                        .name("테스트 머리")
                        .slotType("HAIR")
                        .grade("COMMON")
                        .assetUrl("https://asset.example.com/hair.glb")
                        .build())
                .build();
        given(inventoryService.getInventory(LOGIN_USER_ID)).willReturn(List.of(userItem));

        mockMvc.perform(get("/api/v1/inventory")
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].item.name").value("테스트 머리"))
                .andExpect(jsonPath("$[0].item.slotType").value("HAIR"))
                .andDo(print());

        verify(inventoryService).getInventory(LOGIN_USER_ID);
    }

    @Test
    @DisplayName("테스트용 아이템 지급 공개 경로 → 404, 서비스 호출 없음")
    void grantItemRouteIsNotPublic() throws Exception {
        mockMvc.perform(post("/api/v1/inventory/grant")
                        .contentType("application/json")
                        .content("""
                                {
                                  "userId": "00000000-0000-0000-0000-0000000000ca",
                                  "itemId": "00000000-0000-0000-0000-000000000011"
                                }
                                """))
                .andExpect(status().isNotFound());

        verifyNoInteractions(inventoryService);
    }
}
