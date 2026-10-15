package com.oneorthree.business.api;

import com.jayway.jsonpath.JsonPath;
import com.oneorthree.business.support.MockUpstream;
import com.oneorthree.business.support.Tokens;
import com.oneorthree.business.support.UpstreamTestBase;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 화면 계약 테스트 공통 (GROMO-1896) — 실제 필터·서명 검증·조합기·HTTP client 를 쓰고 상류만 MockUpstream 이다.
 * 조각 JSON 은 각 도메인 계약 테스트의 fixture 와 같은 모양이다.
 */
abstract class ScreenContractTestBase extends UpstreamTestBase {

    static final UUID USER = UUID.fromString("aaaaaaaa-1896-0000-0000-000000000001");
    static final UUID SESSION = UUID.fromString("bbbbbbbb-1896-0000-0000-000000000001");
    static final UUID ISLAND = UUID.fromString("cccccccc-1896-0000-0000-000000000001");
    static final UUID REQUEST = UUID.fromString("dddddddd-1896-0000-0000-000000000001");
    static final String USERS = "/internal/users/" + USER;
    static final String DATA_ME = "GET " + USERS;
    static final String DATA_MINE = "GET " + USERS + "/islands";

    static final String ME = "{\"id\":\"" + USER + "\",\"name\":\"수빈\",\"catColor\":null,"
            + "\"mainIslandId\":null,\"linkedProviders\":[\"apple\"],\"onboardingComplete\":true}";

    static String summary(String membershipStatus, UUID joinRequestId) {
        return "{\"id\":\"" + ISLAND + "\",\"name\":\"모래섬\",\"intro\":\"\",\"visibility\":\"public\","
                + "\"approvalRequired\":true,\"memberCount\":3,\"maxMembers\":15,"
                + "\"membershipStatus\":\"" + membershipStatus + "\","
                + "\"joinRequestId\":" + (joinRequestId == null ? "null" : "\"" + joinRequestId + "\"")
                + ",\"growthStage\":null,\"themeId\":null}";
    }

    static MockHttpServletRequestBuilder auth(MockHttpServletRequestBuilder request) {
        return request.header("Authorization", "Bearer " + Tokens.accessWithSession(USER, 3, SESSION));
    }

    static MockUpstream.Response ok(String body) {
        return new MockUpstream.Response(200, body);
    }

    static MockUpstream.Response domainError(int status, String code) {
        return new MockUpstream.Response(status, "{\"code\":\"" + code + "\",\"message\":\"internal detail\"}");
    }

    /** 응답 키가 정확히 이 조각들뿐인지 — 화면 DTO 가 없으니 키 집합이 곧 계약이다. */
    static void assertKeys(MvcResult result, String... keys) throws Exception {
        Map<String, Object> data = JsonPath.read(result.getResponse().getContentAsString(), "$.data");
        assertThat(data.keySet()).isEqualTo(Set.of(keys));
    }
}
