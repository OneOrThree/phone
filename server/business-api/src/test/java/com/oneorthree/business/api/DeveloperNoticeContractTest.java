package com.oneorthree.business.api;

import com.oneorthree.business.support.MockUpstream;
import com.oneorthree.business.support.Tokens;
import com.oneorthree.business.support.UpstreamTestBase;
import org.junit.jupiter.api.Test;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
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
        assertThat(DATA.receivedFor(INTERNAL).get(0).header("Authorization")).isEqualTo("Bearer ci-token-data");
    }

    @Test
    void missingSessionAndExpiredNoticeAreNotReadable() throws Exception {
        mockMvc.perform(get("/me/developer-notices")).andExpect(status().isUnauthorized());
        assertThat(DATA.receivedFor(INTERNAL)).isEmpty();
        DATA.on(INTERNAL + "/" + ID, request -> new MockUpstream.Response(404,
                "{\"code\":\"NOT_FOUND\",\"message\":\"소식 없음\"}"));
        mockMvc.perform(get("/me/developer-notices/" + ID)
                .header("Authorization", "Bearer " + Tokens.accessWithSession(USER, 3, SESSION)))
                .andExpect(status().isNotFound()).andExpect(jsonPath("$.error.code").value("NOT_FOUND"));
    }

    @Test
    void detailUsesVerifiedUserAndRejectsMalformedPublicationIdsBeforeUpstream() throws Exception {
        DATA.on(INTERNAL + "/" + ID, request -> new MockUpstream.Response(200,
                "{\"publicationId\":\"" + ID + "\",\"title\":\"소식\",\"body\":\"본문\","
                        + "\"startsAt\":\"2026-10-29T00:00:00Z\",\"endsAt\":null,"
                        + "\"publishedAt\":\"2026-10-28T00:00:00Z\"}"));
        String authorization = "Bearer " + Tokens.accessWithSession(USER, 3, SESSION);
        mockMvc.perform(get("/me/developer-notices/" + ID).header("Authorization", authorization)
                        .header("X-User-Id", UUID.randomUUID()))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.publicationId").value(ID.toString()));
        assertThat(DATA.receivedFor(INTERNAL + "/" + ID)).hasSize(1);
        assertThat(DATA.receivedFor(INTERNAL + "/" + ID).get(0).header("X-User-Id")).isEqualTo(USER.toString());
        mockMvc.perform(get("/me/developer-notices/not-a-uuid").header("Authorization", authorization))
                .andExpect(status().isBadRequest());
        assertThat(DATA.receivedFor(INTERNAL + "/not-a-uuid")).isEmpty();
    }

    private static final String REQ = "GET /internal/developer-notices/app-requirements";
    private static final String BODY = "{\"minVersion\":\"2.1.0\",\"title\":\"업데이트\",\"body\":\"본문\","
            + "\"publicationId\":\"" + ID + "\",\"publishedAt\":\"2026-10-28T00:00:00Z\"}";

    @Test
    void appRequirementsIsPublicForAnyTokenAndCachesOnlySuccess() throws Exception {
        DATA.on(REQ, request -> new MockUpstream.Response(200, BODY));
        var tokens = new String[]{null, "Bearer " + Tokens.expired(USER), "Bearer forged.token.value",
                "Bearer " + Tokens.signedWithOtherKey(USER)};
        for (String token : tokens) {
            var builder = get("/auth/sessions/app-requirements?platform=ios");
            if (token != null) {
                builder.header("Authorization", token);
            }
            mockMvc.perform(builder).andExpect(status().isOk())
                    .andExpect(header().stringValues("Cache-Control", "public, max-age=60"))
                    .andExpect(jsonPath("$.data.minVersion").value("2.1.0"))
                    .andExpect(jsonPath("$.data.publicationId").value(ID.toString()))
                    .andExpect(jsonPath("$.data.publishedAt").value("2026-10-28T00:00:00Z"));
        }
        var call = DATA.receivedFor(REQ).get(0);
        assertThat(call.header("X-User-Id")).isNull();
        assertThat(call.header("Authorization")).isEqualTo("Bearer ci-token-data");
    }

    @Test
    void appRequirementsWithoutNoticeKeepsEveryKeyAsNull() throws Exception {
        DATA.on(REQ, request -> new MockUpstream.Response(200, "{\"minVersion\":null,\"title\":null,"
                + "\"body\":null,\"publicationId\":null,\"publishedAt\":null}"));
        mockMvc.perform(get("/auth/sessions/app-requirements?platform=android"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.minVersion").value(org.hamcrest.Matchers.nullValue()))
                .andExpect(jsonPath("$.data.title").hasJsonPath())
                .andExpect(jsonPath("$.data.publishedAt").hasJsonPath());
    }

    @Test
    void appRequirementsRejectsBadPlatformBeforeUpstreamWithNoStore() throws Exception {
        for (String query : new String[]{"", "?platform=web", "?platform=", "?platform=ios&platform=android",
                "?platform=iOS"}) {
            mockMvc.perform(get("/auth/sessions/app-requirements" + query)).andExpect(status().isBadRequest())
                    .andExpect(header().string("Cache-Control", org.hamcrest.Matchers.containsString("no-store")));
        }
        assertThat(DATA.receivedFor(REQ)).isEmpty();
    }

    @Test
    void appRequirementsUpstreamFailureIsNotCached() throws Exception {
        DATA.on(REQ, request -> new MockUpstream.Response(500, "{\"code\":\"X\",\"message\":\"boom\"}"));
        mockMvc.perform(get("/auth/sessions/app-requirements?platform=ios"))
                .andExpect(header().string("Cache-Control", org.hamcrest.Matchers.containsString("no-store")))
                .andExpect(result -> assertThat(result.getResponse().getStatus()).isGreaterThanOrEqualTo(400));
    }

    @Test
    void forcesUpdateFollowsTheMinVersionsAndDefaultsToFalseForOldData() throws Exception {
        String common = "\"title\":\"t\",\"body\":\"b\",\"startsAt\":\"2026-10-29T00:00:00Z\","
                + "\"endsAt\":null,\"publishedAt\":\"2026-10-28T00:00:00Z\"";
        DATA.on(INTERNAL, request -> new MockUpstream.Response(200, "{\"items\":["
                + "{\"publicationId\":\"" + ID + "\"," + common + ",\"minAndroidVersion\":\"1.0.0\"},"
                + "{\"publicationId\":\"" + ID + "\"," + common + "},"
                + "{\"publicationId\":\"" + ID + "\"," + common + ",\"minIosVersion\":\"0.0.0\"}]}"));
        mockMvc.perform(get("/me/developer-notices")
                .header("Authorization", "Bearer " + Tokens.accessWithSession(USER, 3, SESSION)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.items[0].forcesUpdate").value(true))
                .andExpect(jsonPath("$.data.items[1].forcesUpdate").value(false))
                .andExpect(jsonPath("$.data.items[2].forcesUpdate").value(true))
                .andExpect(jsonPath("$.data.items[0].minAndroidVersion").doesNotExist());
    }
}
