package com.oneorthree.phone.config;

import org.junit.jupiter.api.Test;
import org.springframework.boot.env.YamlPropertySourceLoader;
import org.springframework.core.env.PropertySource;
import org.springframework.core.io.ClassPathResource;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/** 앱 최소 버전 공개 조회 내부 경로는 배포되는 yml 의 business 허용목록에만 있다. */
class InternalDeveloperNoticeAllowlistTest {
    private static final String ROUTE = "GET /internal/developer-notices/app-requirements";

    @Test
    void onlyBusinessMayReadAppRequirements() throws IOException {
        assertThat(allowlist("business")).contains(ROUTE);
        assertThat(allowlist("notification")).doesNotContain(ROUTE);
        assertThat(allowlist("realtime")).doesNotContain(ROUTE);
        assertThat(allowlist("console")).doesNotContain(ROUTE);
    }

    private static List<String> allowlist(String caller) throws IOException {
        List<String> allow = new ArrayList<>();
        for (PropertySource<?> source : new YamlPropertySourceLoader()
                .load("satellites", new ClassPathResource("application-satellites.yml"))) {
            for (int i = 0; ; i++) {
                Object value = source.getProperty("internal.api.callers." + caller + ".allow[" + i + "]");
                if (value == null) {
                    break;
                }
                allow.add(value.toString());
            }
        }
        return allow;
    }
}
