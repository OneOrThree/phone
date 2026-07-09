package com.oneorthree.phone.item.api;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.oneorthree.phone.item.dto.EquipRequest;
import com.oneorthree.phone.item.dto.CharacterEquipmentResponse;
import com.oneorthree.phone.item.dto.ItemResponse;
import com.oneorthree.phone.item.domain.SlotType;
import com.oneorthree.phone.item.service.EquipmentService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Disabled;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;
import java.util.UUID;

import static org.mockito.BDDMockito.given;
import static org.mockito.BDDMockito.willDoNothing;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultHandlers.print;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc(addFilters = false)
@Disabled
public class EquipmentControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private EquipmentService equipmentService;

    private final ObjectMapper objectMapper = new ObjectMapper();

    private static final UUID USER_ID = UUID.fromString("00000000-0000-0000-0000-000000000001");
    private static final UUID ITEM_ID = UUID.fromString("00000000-0000-0000-0000-000000000001");
    private static final UUID CE_ID = UUID.fromString("00000000-0000-0000-0000-000000000001");
    private static final UUID ITEM_ID_99 = UUID.fromString("00000000-0000-0000-0000-000000000099");

    @Test
    @DisplayName("장착 상태 조회 성공")
    void getEqipmentSuccess() throws Exception {
        // given
        CharacterEquipmentResponse response = CharacterEquipmentResponse.builder()
                .id(CE_ID)
                .slotType("HAT")
                .item(ItemResponse.builder()
                        .id(ITEM_ID)
                        .name("테스트 모자")
                        .slotType("HAT")
                        .grade("COMMON")
                        .assetUrl("https://asset.example.com/hat.glb")
                        .build())
                .build();
        given(equipmentService.getEquipment(USER_ID)).willReturn(List.of(response));

        // when + then
        mockMvc.perform(get("/api/equipment/" + USER_ID))
                .andDo(print())
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].slotType").value("HAT"))
                .andExpect(jsonPath("$[0].item.name").value("테스트 모자"));
    }

    @Test
    @DisplayName("아이템 장착 성공")
    void equipSuccess() throws Exception {
        // given
        EquipRequest request = new EquipRequest(USER_ID, ITEM_ID);

        CharacterEquipmentResponse response = CharacterEquipmentResponse.builder()
                .id(CE_ID)
                .slotType("HAT")
                .item(ItemResponse.builder()
                        .id(ITEM_ID)
                        .name("테스트 모자")
                        .slotType("HAT")
                        .grade("COMMON")
                        .build())
                .build();

        given(equipmentService.equip(USER_ID, ITEM_ID)).willReturn(response);

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
        willDoNothing().given(equipmentService).unequip(USER_ID, SlotType.HAIR);

        // when & then
        mockMvc.perform(delete("/api/equipment/" + USER_ID + "/HAT"))
                .andDo(print())
                .andExpect(status().isOk());
    }

    @Test
    @DisplayName("보유하지 않은 아이템 장착 시 409 반환")
    void equipFailNotOwned() throws Exception {
        // given
        EquipRequest request = new EquipRequest(USER_ID, ITEM_ID_99);
        given(equipmentService.equip(USER_ID, ITEM_ID_99))
                .willThrow(new IllegalArgumentException("보유하지 않은 아이템입니다."));

        // when & then
        mockMvc.perform(post("/api/equipment/equip")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andDo(print())
                .andExpect(status().isConflict());
    }

}
