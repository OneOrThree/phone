package com.oneorthree.phone.api;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.oneorthree.phone.api.dto.request.EquipRequest;
import com.oneorthree.phone.api.dto.response.CharacterEquipmentResponse;
import com.oneorthree.phone.api.dto.response.ItemResponse;
import com.oneorthree.phone.domain.SlotType;
import com.oneorthree.phone.service.EquipmentService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;

import static org.mockito.BDDMockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import static org.springframework.test.web.servlet.result.MockMvcResultHandlers.print;


@SpringBootTest
@AutoConfigureMockMvc(addFilters = false)
public class EquipmentControllerTest {
    @Autowired
    private MockMvc mockMvc;
    @MockitoBean
    private EquipmentService equipmentService;

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Test
    @DisplayName("장착 상태 조회 성공")
    void getEqipmentSuccess() throws Exception {
        //given
        CharacterEquipmentResponse response = CharacterEquipmentResponse.builder()
                .id(1L)
                .slotType("HAT")
                .item(ItemResponse.builder()
                        .id(1L)
                        .name("테스트 모자")
                        .slotType("HAT")
                        .rarity("COMMON")
                        .assetAddress("https://asset.example.com/hat.glb")
                        .build())
                .build();
        given(equipmentService.getEquipment(1L)).willReturn(List.of(response));

        //when + then
        mockMvc.perform(get("/api/equipment/1"))
                .andDo(print())
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].slotType").value("HAT"))
                .andExpect(jsonPath("$[0].item.name").value("테스트 모자"));
    }

    @Test
    @DisplayName("아이템 장착 성공")
    void equipSuccess() throws Exception {
        // given
        EquipRequest request = new EquipRequest(1L, 1L);

        CharacterEquipmentResponse response = CharacterEquipmentResponse.builder()
                .id(1L)
                .slotType("HAT")
                .item(ItemResponse.builder()
                        .id(1L)
                        .name("테스트 모자")
                        .slotType("HAT")
                        .rarity("COMMON")
                        .build())
                .build();

        given(equipmentService.equip(1L, 1L)).willReturn(response);

        // when & then
        mockMvc.perform(post("/api/equipment/equip")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andDo(print())
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.slotType").value("HAT"))
                .andExpect(jsonPath("$.item.name").value("테스트 모자"));
    }

    @Test
    @DisplayName("아이템 해제 성공")
    void unequipSuccess() throws Exception {
        // given
        willDoNothing().given(equipmentService).unequip(1L, SlotType.HAT);

        // when & then
        mockMvc.perform(delete("/api/equipment/1/HAT"))
                .andDo(print())
                .andExpect(status().isOk());
    }

    @Test
    @DisplayName("보유하지 않은 아이템 장착 시 409 반환")
    void equipFailNotOwned() throws Exception {
        // given
        EquipRequest request = new EquipRequest(1L, 99L);
        given(equipmentService.equip(1L, 99L))
                .willThrow(new IllegalArgumentException("보유하지 않은 아이템입니다."));

        // when & then
        mockMvc.perform(post("/api/equipment/equip")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andDo(print())
                .andExpect(status().isConflict());  // 409
    }
}
