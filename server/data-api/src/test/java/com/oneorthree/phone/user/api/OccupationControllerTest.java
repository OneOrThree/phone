package com.oneorthree.phone.user.api;

import com.oneorthree.phone.user.dto.OccupationResponse;
import com.oneorthree.phone.user.service.OccupationService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;

import static org.mockito.BDDMockito.given;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultHandlers.print;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(controllers = OccupationController.class)
class OccupationControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private OccupationService occupationService;

    @Test
    @DisplayName("occupation 목록 조회 → 200, code 순 code/displayName 노출")
    void getOccupationsReturns200() throws Exception {
        given(occupationService.getOccupations()).willReturn(List.of(
                new OccupationResponse("MIDDLE_SCHOOL", "중학생"),
                new OccupationResponse("UNIVERSITY", "대학생"),
                new OccupationResponse("CIVIL_SERVANT", "공무원")));

        mockMvc.perform(get("/api/v1/occupations"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].code").value("MIDDLE_SCHOOL"))
                .andExpect(jsonPath("$[0].displayName").value("중학생"))
                .andExpect(jsonPath("$[1].code").value("UNIVERSITY"))
                .andExpect(jsonPath("$[2].displayName").value("공무원"))
                .andDo(print());
    }
}
