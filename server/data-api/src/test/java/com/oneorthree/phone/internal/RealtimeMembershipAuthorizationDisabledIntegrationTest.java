package com.oneorthree.phone.internal;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

import java.util.UUID;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** 서비스 자격/허용목록만 있어도 신규 인가 표면은 기본 비활성이다. */
@SpringBootTest
@AutoConfigureMockMvc
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class RealtimeMembershipAuthorizationDisabledIntegrationTest {
    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        RealtimeMembershipAuthorizationIntegrationTest.database(registry);
        // internal.realtime.authorization.enabled를 지정하지 않아 기본값 자체를 검증한다.
    }

    @Autowired
    MockMvc mvc;

    @Test
    void absentFeatureSettingDoesNotExposeRoute() throws Exception {
        mvc.perform(post(RealtimeMembershipAuthorizationIntegrationTest.PATH)
                        .header("Authorization",
                                "Bearer " + RealtimeMembershipAuthorizationIntegrationTest.REALTIME_TOKEN)
                        .header("X-User-Id", UUID.randomUUID()).contentType("application/json")
                        .content("{\"sessionId\":\"" + UUID.randomUUID() + "\",\"islandId\":\""
                                + UUID.randomUUID() + "\",\"authGeneration\":0}"))
                .andExpect(status().isNotFound());
    }
}
