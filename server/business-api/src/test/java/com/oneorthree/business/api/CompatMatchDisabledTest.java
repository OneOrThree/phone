package com.oneorthree.business.api;

import com.oneorthree.business.support.UpstreamTestBase;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.test.context.TestPropertySource;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 한시 핸들러의 <b>기본 상태는 꺼짐</b>이다 (A22 ㊫: 컷오버 후 제거).
 *
 * <p>켜진 채 배포되면 라우팅이 바뀐 뒤에도 구 경로가 남아 이중 소진 위험이 생긴다.
 */
@DisplayName("한시 match 핸들러 기본 꺼짐")
@TestPropertySource(properties = "business.compat.match-handler-enabled=false")
class CompatMatchDisabledTest extends UpstreamTestBase {

    @Test
    @DisplayName("꺼져 있으면 404 처럼 보이고 상류를 부르지 않는다")
    void 꺼짐() throws Exception {
        mockMvc.perform(post("/l/match").contentType("application/json")
                        .content("{\"os\":\"ios\",\"deviceId\":\"dev-1\"}"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("COMPAT_HANDLER_DISABLED"));

        assertThat(LINK.received()).isEmpty();
        assertThat(DATA.received()).isEmpty();
    }
}
