package com.oneorthree.business.api;

import com.oneorthree.business.support.MockUpstream;
import com.oneorthree.business.support.Tokens;
import com.oneorthree.business.support.UpstreamTestBase;
import org.junit.jupiter.api.Test;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** 공개 소식은 검증한 세션 주체로만 읽고 기간 밖 404를 그대로 돌려준다. */
class DeveloperNoticeContractTest extends UpstreamTestBase {
    private static final UUID USER = UUID.fromString("aaaaaaaa-1000-0000-0000-000000000001");
    private static final UUID SESSION = UUID.fromString("bbbbbbbb-1000-0000-0000-000000000001");
    private static final UUID ID = UUID.fromString("cccccccc-1000-0000-0000-000000000001");
    private static final String INTERNAL = "GET /internal/users/" + USER + "/developer-notices";

    @Test
    void listingUsesTheAuthenticatedSubjectAndKeepsNullableExpiry() throws Exception {
        DATA.on(INTERNAL, request -> new MockUpstream.Response(200, "{\"items\":[{\"publicationId\":\"" + ID
                + "\",\"title\":\"소식\",\"body\":\"본문\",\"startsAt\":\"2026-10-29T00:00:00Z\","
                + "\"endsAt\":null,\"publishedAt\":\"2026-10-28T00:00:00Z\"}]}"));
        mockMvc.perform(get("/me/developer-notices")
                .header("Authorization", "Bearer " + Tokens.accessWithSession(USER, 3, SESSION))
                .header("X-User-Id", UUID.randomUUID()))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.items[0].publicationId").value(ID.toString()))
                .andExpect(jsonPath("$.data.items[0].endsAt").hasJsonPath());
        assertThat(DATA.receivedFor(INTERNAL).get(0).header("X-User-Id")).isEqualTo(USER.toString());
    }

    @Test
    void missingSessionAndExpiredNoticeAreNotReadable() throws Exception {
        mockMvc.perform(get("/me/developer-notices")).andExpect(status().isUnauthorized());
        DATA.on(INTERNAL + "/" + ID, request -> new MockUpstream.Response(404,
                "{\"code\":\"NOT_FOUND\",\"message\":\"소식 없음\"}"));
        mockMvc.perform(get("/me/developer-notices/" + ID)
                .header("Authorization", "Bearer " + Tokens.accessWithSession(USER, 3, SESSION)))
                .andExpect(status().isNotFound()).andExpect(jsonPath("$.error.code").value("NOT_FOUND"));
    }
}
