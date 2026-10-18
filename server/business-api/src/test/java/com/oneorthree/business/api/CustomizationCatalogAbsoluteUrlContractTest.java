package com.oneorthree.business.api;

import com.oneorthree.business.support.Tokens;
import com.oneorthree.business.support.UpstreamTestBase;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.test.context.TestPropertySource;

import java.util.UUID;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** STATIC_ASSETS_BASE_URL(app.static-base-url)이 있으면 imageUrl 이 절대 URL 이다 — 끝 슬래시는 겹치지 않는다 (GROMO-2331). */
@TestPropertySource(properties = "app.static-base-url=http://192.168.0.7:8088/")
class CustomizationCatalogAbsoluteUrlContractTest extends UpstreamTestBase {

    private static final UUID USER = UUID.fromString("aaaaaaaa-1783-0000-0000-000000000001");
    private static final UUID SESSION = UUID.fromString("bbbbbbbb-1783-0000-0000-000000000001");

    @Test
    @DisplayName("base URL 을 imagePath 앞에 붙여 절대 URL 로 내린다")
    void absoluteImageUrl() throws Exception {
        DATA.on("GET /internal/customization/catalog",
                request -> new com.oneorthree.business.support.MockUpstream.Response(200,
                        CustomizationCatalogContractTest.BODY));

        mockMvc.perform(get("/customization/catalog").header("Authorization",
                        "Bearer " + Tokens.accessWithSession(USER, 3, SESSION)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data[0].imageUrl")
                        .value("http://192.168.0.7:8088/static/customization/head/duck.9572baaf.png"));
    }
}
