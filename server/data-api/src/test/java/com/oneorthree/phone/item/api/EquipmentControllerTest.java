package com.oneorthree.phone.item.api;

import com.oneorthree.phone.common.auth.AuthAttributes;
import com.oneorthree.phone.item.EquipmentController;
import com.oneorthree.phone.item.repository.domain.SlotType;
import com.oneorthree.phone.item.dto.CharacterEquipmentResponse;
import com.oneorthree.phone.item.dto.ItemResponse;
import com.oneorthree.phone.item.service.EquipmentService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;
import java.util.UUID;

import static org.mockito.BDDMockito.given;
import static org.mockito.BDDMockito.willDoNothing;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultHandlers.print;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 장비 API 컨트롤러 테스트 (GROMO-363 에서 부활).
 *
 * <p>장비 API 의 대상은 항상 인증 주체다. 이 테스트의 핵심은 응답 매핑이 아니라
 * "서비스에 넘어가는 userId 가 JWT 에서 온 값인가" 이므로, 스텁·검증에서 userId 를 고정한다.</p>
 */
@WebMvcTest(controllers = EquipmentController.class)
class EquipmentControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private EquipmentService equipmentService;

    /** 인증 주체(JwtFilter 가 심어주는 값). 아래 다른 UUID 들과 반드시 달라야 검증이 의미를 갖는다. */
    private static final UUID LOGIN_USER_ID = UUID.fromString("00000000-0000-0000-0000-0000000000ca");
    private static final UUID OTHER_USER_ID = UUID.fromString("00000000-0000-0000-0000-0000000000ff");
    private static final UUID ITEM_ID = UUID.fromString("00000000-0000-0000-0000-000000000011");
    private static final UUID ITEM_ID_99 = UUID.fromString("00000000-0000-0000-0000-000000000099");
    private static final UUID CE_ID = UUID.fromString("00000000-0000-0000-0000-000000000021");

    private CharacterEquipmentResponse hairEquipment() {
        return CharacterEquipmentResponse.builder()
                .id(CE_ID)
                .slotType("HAIR")
                .item(ItemResponse.builder()
                        .id(ITEM_ID)
                        .name("테스트 머리")
                        .slotType("HAIR")
                        .grade("COMMON")
                        .assetUrl("https://asset.example.com/hair.glb")
                        .build())
                .build();
    }

    @Test
    @DisplayName("착용 장비 조회 → 200, 인증 주체의 장비를 반환")
    void getEquipmentReturns200() throws Exception {
        given(equipmentService.getEquipment(LOGIN_USER_ID)).willReturn(List.of(hairEquipment()));

        mockMvc.perform(get("/api/v1/equipment")
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].slotType").value("HAIR"))
                .andExpect(jsonPath("$[0].item.name").value("테스트 머리"))
                .andDo(print());

        verify(equipmentService).getEquipment(LOGIN_USER_ID);
    }

    @Test
    @DisplayName("아이템 장착 → 200, 장착 대상은 인증 주체")
    void equipReturns200() throws Exception {
        given(equipmentService.equip(LOGIN_USER_ID, ITEM_ID)).willReturn(hairEquipment());

        mockMvc.perform(post("/api/v1/equipment/equip")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"itemId\":\"" + ITEM_ID + "\"}")
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.slotType").value("HAIR"))
                .andDo(print());

        verify(equipmentService).equip(LOGIN_USER_ID, ITEM_ID);
    }

    @Test
    @DisplayName("장착 — 바디에 남의 userId 를 끼워 넣어도 무시하고 인증 주체로 처리 (GROMO-363 사칭 차단)")
    void equipIgnoresUserIdInBody() throws Exception {
        given(equipmentService.equip(LOGIN_USER_ID, ITEM_ID)).willReturn(hairEquipment());

        mockMvc.perform(post("/api/v1/equipment/equip")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"userId\":\"" + OTHER_USER_ID + "\",\"itemId\":\"" + ITEM_ID + "\"}")
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
                .andExpect(status().isOk())
                .andDo(print());

        // 예전 계약이었다면 OTHER_USER_ID 로 불렸을 호출이다.
        verify(equipmentService).equip(LOGIN_USER_ID, ITEM_ID);
    }

    @Test
    @DisplayName("장비 해제 → 204, 해제 대상은 인증 주체")
    void unequipReturns204() throws Exception {
        willDoNothing().given(equipmentService).unequip(LOGIN_USER_ID, SlotType.HAIR);

        mockMvc.perform(delete("/api/v1/equipment/{slotType}", "HAIR")
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
                .andExpect(status().isNoContent())
                .andDo(print());

        verify(equipmentService).unequip(LOGIN_USER_ID, SlotType.HAIR);
    }

    @Test
    @DisplayName("보유하지 않은 아이템 장착 → 409")
    void equipNotOwnedReturns409() throws Exception {
        given(equipmentService.equip(LOGIN_USER_ID, ITEM_ID_99))
                .willThrow(new IllegalArgumentException("보유하지 않은 아이템입니다."));

        mockMvc.perform(post("/api/v1/equipment/equip")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"itemId\":\"" + ITEM_ID_99 + "\"}")
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
                .andExpect(status().isConflict())
                .andDo(print());
    }
}
