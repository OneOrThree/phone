package com.oneorthree.phone.api;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.oneorthree.phone.api.dto.response.ItemResponse;
import com.oneorthree.phone.api.dto.response.UserItemResponse;
import com.oneorthree.phone.service.InventoryService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;

import static org.mockito.BDDMockito.given;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import static org.springframework.test.web.servlet.result.MockMvcResultHandlers.print;

@SpringBootTest
@AutoConfigureMockMvc(addFilters = false) //todo jwt 붙이고 withmockuser로 범위 조절하기
public class InventoryControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private InventoryService inventoryService;

    @Test
    @DisplayName("인벤토리 조회 성공")
    void getInventorySuccess() throws Exception {
        //given
        ItemResponse itemResponse = ItemResponse.builder()
                .id(1L)
                .name("테스트 모자")
                .slotType("HAT")
                .rarity("COMMON")
                .assetAddress("https://asset.example.com/hat.glb")
                .build();

        UserItemResponse userItemResponse = UserItemResponse.builder()
                .id(1L)
                .item(itemResponse)
                .build();

        given(inventoryService.getInventory(1L)).willReturn(List.of(userItemResponse));

        //when + then
        mockMvc.perform(get("/api/inventory/1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].item.name").value("테스트 모자"))
                .andExpect(jsonPath("$[0].item.slotType").value("HAT"))
                .andDo(print());
    }
}
