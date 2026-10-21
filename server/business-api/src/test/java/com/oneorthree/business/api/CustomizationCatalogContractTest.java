package com.oneorthree.business.api;

import com.oneorthree.business.support.MockUpstream;
import com.oneorthree.business.support.Tokens;
import com.oneorthree.business.support.UpstreamTestBase;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * GET /customization/catalog 계약 (GROMO-2331) — 상대 경로(기본)와 STATIC_ASSETS_BASE_URL 이 있을 때의 절대 URL.
 * 집중 보상 행(GROMO-2382)은 renderData 를 그대로 넘긴다.
 */
class CustomizationCatalogContractTest extends UpstreamTestBase {

    private static final UUID USER = UUID.fromString("aaaaaaaa-1783-0000-0000-000000000001");
    private static final UUID SESSION = UUID.fromString("bbbbbbbb-1783-0000-0000-000000000001");
    private static final String DATA_CATALOG = "GET /internal/customization/catalog";
    static final String BODY = "[{\"productId\":\"cust.head.duck\",\"kind\":\"head\",\"slot\":\"head\","
            + "\"title\":\"오리 모자\",\"imagePath\":\"/static/customization/head/duck.9572baaf.png\","
            + "\"width\":1254,\"height\":1254,\"anchorX\":0.5,\"anchorY\":0.1,\"sortOrder\":1,\"retiredAt\":null}]";

    @Test
    @DisplayName("기본값(빈 base URL)에서는 imagePath 를 상대 경로 그대로 imageUrl 로 내린다")
    void relativeImageUrlByDefault() throws Exception {
        DATA.on(DATA_CATALOG, request -> ok(BODY));

        mockMvc.perform(auth(get("/customization/catalog")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data[0].productId").value("cust.head.duck"))
                .andExpect(jsonPath("$.data[0].imageUrl").value("/static/customization/head/duck.9572baaf.png"))
                .andExpect(jsonPath("$.data[0].slot").value("head"))
                .andExpect(jsonPath("$.data[0].anchorY").value(0.1))
                .andExpect(jsonPath("$.data[0].retiredAt").doesNotExist())
                .andExpect(jsonPath("$.data[0].renderData").doesNotExist());

        MockUpstream.RecordedRequest forwarded = DATA.receivedFor(DATA_CATALOG).get(0);
        assertThat(forwarded.header("X-User-Id")).isEqualTo(USER.toString());
    }

    @Test
    @DisplayName("집중 보상 행은 크기·앵커 없이 renderData 를 원문 그대로 내린다 (GROMO-2382)")
    void rewardRowPassesRenderDataThrough() throws Exception {
        DATA.on(DATA_CATALOG, request -> ok("[{\"productId\":\"cust.head.mandarin\",\"kind\":\"head\","
                + "\"slot\":\"head\",\"title\":\"귤 한 알\","
                + "\"imagePath\":\"/static/customization/head/mandarin.cfb06049.png\",\"width\":null,"
                + "\"height\":null,\"anchorX\":null,\"anchorY\":null,\"sortOrder\":0,\"retiredAt\":null,"
                + "\"renderData\":{\"format\":\"cat-fit-v1\",\"drawWidth\":64,"
                + "\"contactFrames\":{\"walk-0\":{\"x\":277,\"y\":182,\"angleDegrees\":-20.6}}}}]"));

        mockMvc.perform(auth(get("/customization/catalog")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data[0].title").value("귤 한 알"))
                .andExpect(jsonPath("$.data[0].imageUrl").value("/static/customization/head/mandarin.cfb06049.png"))
                .andExpect(jsonPath("$.data[0].width").doesNotExist())
                .andExpect(jsonPath("$.data[0].renderData.format").value("cat-fit-v1"))
                .andExpect(jsonPath("$.data[0].renderData.drawWidth").value(64))
                .andExpect(jsonPath("$.data[0].renderData.contactFrames['walk-0'].angleDegrees").value(-20.6));
    }

    @Test
    @DisplayName("무인증 요청은 401 이고 상류를 부르지 않는다")
    void requiresSession() throws Exception {
        mockMvc.perform(get("/customization/catalog")).andExpect(status().isUnauthorized());
        assertThat(DATA.received()).isEmpty();
    }

    private static MockUpstream.Response ok(String body) {
        return new MockUpstream.Response(200, body);
    }

    private MockHttpServletRequestBuilder auth(MockHttpServletRequestBuilder request) {
        return request.header("Authorization", "Bearer " + Tokens.accessWithSession(USER, 3, SESSION));
    }
}
