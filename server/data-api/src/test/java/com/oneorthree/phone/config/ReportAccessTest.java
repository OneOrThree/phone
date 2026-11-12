package com.oneorthree.phone.config;

import org.junit.jupiter.api.Test;
import org.springframework.boot.env.YamlPropertySourceLoader;
import org.springframework.core.io.ClassPathResource;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import java.util.ArrayList;
import java.util.UUID;
import static org.assertj.core.api.Assertions.assertThat;

/** 배포 허용목록을 그대로 읽어 사용자 접수와 운영 조회의 경계를 검증한다. */
class ReportAccessTest {
    @Test
    void onlyConsoleCanReadAndCloseReportsAndBusinessCanOnlySubmitForItsCaller() throws Exception {
        var properties = new InternalApiProperties();
        for (String name : new String[] {"business", "console-member-1", "console-member-2", "console-member-3"}) {
            var caller = new InternalApiProperties.Caller();
            caller.setToken(name + "-test-token");
            if (name.startsWith("console-")) {
                caller.setConsoleActor(name.substring("console-".length()));
            }
            var allow = new ArrayList<String>();
            for (var source : new YamlPropertySourceLoader().load("satellites",
                    new ClassPathResource("application-satellites.yml"))) {
                for (int i = 0; ; i++) {
                    var value = source.getProperty("internal.api.callers." + name + ".allow[" + i + "]");
                    if (value == null) {
                        break;
                    }
                    allow.add(value.toString());
                }
            }
            caller.setAllow(allow);
            properties.getCallers().put(name, caller);
        }
        var filter = new InternalAuthFilter(properties);
        UUID user = UUID.randomUUID();
        assertThat(status(filter, "business", "POST", "/internal/users/" + user + "/reports", user)).isEqualTo(200);
        assertThat(status(filter, "business", "POST", "/internal/users/" + user + "/reports", UUID.randomUUID()))
                .isEqualTo(403);
        for (String method : new String[] {"GET", "POST"}) {
            String path = "/internal/admin/content/reports" + (method.equals("POST") ? "/" + user + "/close" : "");
            assertThat(status(filter, "business", method, path, user)).isEqualTo(403);
            assertThat(status(filter, "unknown", method, path, user)).isEqualTo(401);
            for (int i = 1; i <= 3; i++) {
                assertThat(status(filter, "console-member-" + i, method, path, null)).isEqualTo(200);
            }
        }
    }

    private int status(InternalAuthFilter filter, String caller, String method, String path, UUID user) throws Exception {
        var request = new MockHttpServletRequest(method, path);
        request.addHeader("Authorization", "Bearer " + caller + "-test-token");
        if (user != null) {
            request.addHeader("X-User-Id", user.toString());
        }
        var response = new MockHttpServletResponse();
        filter.doFilter(request, response, new MockFilterChain());
        return response.getStatus();
    }
}
