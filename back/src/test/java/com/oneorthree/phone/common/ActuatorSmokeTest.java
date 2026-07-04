package com.oneorthree.phone.common;

import com.oneorthree.phone.common.support.IntegrationTestBase;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// GROMO-588 — 관측 수집층 스모크. 액추에이터가 기동·노출되고, cd.yml 이 쓰는 공개 /health 가 보존되는지 확인.
// (prometheus 엔드포인트는 dev 프로파일에서만 노출 — 여기 ci/local 에선 검증 대상 아님)
@AutoConfigureMockMvc
class ActuatorSmokeTest extends IntegrationTestBase {

    @Autowired
    MockMvc mockMvc;

    @Test
    @DisplayName("/actuator/health → 200 UP (액추에이터 기동)")
    void actuatorHealthUp() throws Exception {
        mockMvc.perform(get("/actuator/health"))
                .andExpect(status().isOk())
                .andExpect(content().string(org.hamcrest.Matchers.containsString("UP")));
    }

    @Test
    @DisplayName("공개 /health(커스텀 컨트롤러) 유지 — cd.yml 배포 헬스체크 호환")
    void customHealthStillWorks() throws Exception {
        mockMvc.perform(get("/health"))
                .andExpect(status().isOk())
                .andExpect(content().string("test"));
    }
}
