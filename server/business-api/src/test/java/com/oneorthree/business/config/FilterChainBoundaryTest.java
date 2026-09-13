package com.oneorthree.business.config;

import com.oneorthree.business.support.UpstreamTestBase;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.test.context.TestPropertySource;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 두 필터의 <b>순서와 적용 범위</b> 계약.
 *
 * <p>인증 필터가 {@code /api/*} 가 아니라 {@code /*} 에 등록되면서 새로 생긴 경합을 본다 — 「전부 막고
 * 열거한 것만 연다」로 바꾼 뒤 <b>공개 경로가 실제로 열려 있는가</b>, 그리고 인증보다 앞에 둔 봉투 필터가
 * <b>그 공개 경로에도 적용되는가</b>. 둘 중 하나만 어긋나도 증상이 조용하다: 전자는 컨테이너가 영영
 * unhealthy 로 남고, 후자는 무인증 진입점이 본문 상한 없이 열린다.
 *
 * <p>{@code /l/match} 가 무인증이라는 사실 자체는 {@code CompatMatchContractTest} 가 이미 지킨다.
 * 여기서는 그 경로에 «봉투»가 붙는지만 본다.
 */
@DisplayName("필터 체인 경계 — 공개 경로와 요청 봉투")
@TestPropertySource(properties = "business.compat.match-handler-enabled=true")
class FilterChainBoundaryTest extends UpstreamTestBase {

    /** 256KiB 상한을 넘기는 본문. 상한은 선언된 Content-Length 에서 먼저 걸린다. */
    private static final String OVERSIZE_BODY = "x".repeat(300_000);

    @Test
    @DisplayName("/health 는 무인증으로 도달한다 — 막히면 컨테이너가 영영 unhealthy 다")
    void 헬스체크는공개() throws Exception {
        mockMvc.perform(get("/health"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("UP"));
    }

    @Test
    @DisplayName("공개 경로 응답에도 X-Request-Id 와 no-store 가 붙는다 — 봉투 필터가 인증보다 앞이다")
    void 공개경로에도봉투가붙는다() throws Exception {
        mockMvc.perform(get("/health"))
                .andExpect(header().exists("X-Request-Id"))
                .andExpect(header().string("Cache-Control", "no-store"));
    }

    @Test
    @DisplayName("무인증 공개 경로에도 본문 상한이 걸린다 — 상한을 인증 뒤에 두면 여기가 무제한이 된다")
    void 공개경로본문상한() throws Exception {
        mockMvc.perform(post("/l/match").contentType("application/json").content(OVERSIZE_BODY))
                .andExpect(status().isPayloadTooLarge())
                .andExpect(jsonPath("$.code").value("REQUEST_TOO_LARGE"));
    }

    @Test
    @DisplayName("인증 경로의 거절에도 봉투가 붙는다 — 401 도 추적 가능해야 한다")
    void 거절응답에도봉투가붙는다() throws Exception {
        mockMvc.perform(get("/api/v1/users/me/notification-settings"))
                .andExpect(status().isUnauthorized())
                .andExpect(header().exists("X-Request-Id"))
                .andExpect(header().string("Cache-Control", "no-store"));
    }

    @Test
    @DisplayName("허용목록에 없는 경로는 무인증이면 401 — 열거하지 않은 것은 전부 막힌다")
    void 열거되지않은경로는막힌다() throws Exception {
        mockMvc.perform(get("/l/anything-else"))
                .andExpect(status().isUnauthorized());
    }
}
