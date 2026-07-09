package com.oneorthree.phone.item.api;

import com.oneorthree.phone.item.dto.ItemResponse;
import com.oneorthree.phone.item.dto.UserItemResponse;
import com.oneorthree.phone.item.service.InventoryService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Disabled;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;
import java.util.UUID;

import static org.mockito.BDDMockito.given;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultHandlers.print;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc(addFilters = false)
@Disabled
public class InventoryControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private InventoryService inventoryService;

    private static final UUID USER_ID = UUID.fromString("00000000-0000-0000-0000-000000000001");
    private static final UUID ITEM_ID = UUID.fromString("00000000-0000-0000-0000-000000000001");
    private static final UUID UI_ID = UUID.fromString("00000000-0000-0000-0000-000000000001");

    @Test
    @DisplayName("인벤토리 조회 성공")
    void getInventorySuccess() throws Exception {
        // given
        ItemResponse itemResponse = ItemResponse.builder()
                .id(ITEM_ID)
                .name("테스트 모자")
                .slotType("HAT")
                .grade("COMMON")
                .assetUrl("https://asset.example.com/hat.glb")
                .build();

        UserItemResponse userItemResponse = UserItemResponse.builder()
                .id(UI_ID)
                .item(itemResponse)
                .build();

        given(inventoryService.getInventory(USER_ID)).willReturn(List.of(userItemResponse));

        // when + then
        mockMvc.perform(get("/api/inventory/" + USER_ID))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].item.name").value("테스트 모자"))
                .andExpect(jsonPath("$[0].item.slotType").value("HAT"))
                .andDo(print());
    }

}
