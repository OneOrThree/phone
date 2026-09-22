package com.oneorthree.business.config;

import com.jayway.jsonpath.JsonPath;
import com.oneorthree.business.support.UpstreamTestBase;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * OpenAPI 문서 엔드포인트의 노출 경계 (GROMO-2069).
 *
 * <p>{@code /v0/api-docs/public} 만 AccessTokenFilter 가 열어 둔다 — CI 가 이 경로로
 * business-api.openapi.json 을 만든다. 기본 그룹 {@code /v0/api-docs} 는 열지 않는다.
 * 실제 필터 체인으로 검증하려고 {@link UpstreamTestBase} 를 쓴다(필터를 스텁으로 갈아 끼우면
 * 검증 대상이 빠진다 — AccessTokenBoundaryTest 와 같은 이유).
 */
@DisplayName("OpenAPI 문서 노출 경계")
class OpenApiDocsContractTest extends UpstreamTestBase {

    @Test
    @DisplayName("public 그룹 스펙은 무인증으로 열리고, 공개 경로만 담는다")
    void publicSpecIsOpenAndContainsOnlyPublicPaths() throws Exception {
        String body = mockMvc.perform(get("/v0/api-docs/public"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        Map<String, Object> paths = JsonPath.read(body, "$.paths");
        assertThat(paths).isNotEmpty();
        assertThat(paths.keySet())
                .as("공개 스펙에 내부·운영 경로가 샜다")
                .allMatch(p -> !p.startsWith("/internal")
                        && !p.startsWith("/actuator") && !p.equals("/health"));
        assertThat(paths).containsKey("/friends");
    }

    @Test
    @DisplayName("기본 /v0/api-docs 는 열지 않는다 — 허용은 public 그룹 경로 하나다")
    void defaultDocsPathStaysClosed() throws Exception {
        mockMvc.perform(get("/v0/api-docs"))
                .andExpect(status().isUnauthorized());
    }
}
