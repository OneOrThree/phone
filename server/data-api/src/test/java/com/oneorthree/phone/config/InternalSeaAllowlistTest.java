package com.oneorthree.phone.config;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.env.YamlPropertySourceLoader;
import org.springframework.core.env.PropertySource;
import org.springframework.core.io.ClassPathResource;
import org.springframework.util.AntPathMatcher;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 바다 항해 내부 표면 4종(GROMO-2299)과 <b>실제 배포되는</b> 허용목록의 동기화 계약 — Business 는 시작·한마디만,
 * Realtime 은 입장용 조회 둘만 열린다. 이웃 경로(휴식·다른 메서드)는 닫혀 있다.
 */
class InternalSeaAllowlistTest {

    private static final String ID = "3f4a6c1e-0000-7000-8000-00000000abcd";
    private final AntPathMatcher matcher = new AntPathMatcher();

    @Test
    @DisplayName("Business: 바다 집중 시작 POST 와 한마디 PUT 만 열려 있고 조회 둘은 닫혀 있다")
    void businessSeesOnlyStartAndRemark() throws IOException {
        List<String> allow = allow("application-satellites.yml", "business");

        assertThat(allows(allow, "POST /internal/users/" + ID + "/focus-sessions/sea")).isTrue();
        assertThat(allows(allow, "PUT /internal/users/" + ID + "/sea-remark")).isTrue();
        assertThat(allows(allow, "GET /internal/users/" + ID + "/sea-state")).isFalse();
        assertThat(allows(allow, "GET /internal/users/" + ID + "/friends/ids")).isFalse();
        assertThat(allows(allow, "GET /internal/users/" + ID + "/focus-sessions/sea")).isFalse();
        assertThat(allows(allow, "POST /internal/users/" + ID + "/focus-sessions/sea/extra")).isFalse();
    }

    @Test
    @DisplayName("Realtime: sea-state 와 friends/ids GET 만 열려 있고 시작·한마디 변경은 닫혀 있다")
    void realtimeSeesOnlyTheTwoReads() throws IOException {
        List<String> allow = allow("application-realtime-authorization.yml", "realtime");

        assertThat(allows(allow, "GET /internal/users/" + ID + "/sea-state")).isTrue();
        assertThat(allows(allow, "GET /internal/users/" + ID + "/friends/ids")).isTrue();
        assertThat(allows(allow, "PUT /internal/users/" + ID + "/sea-remark")).isFalse();
        assertThat(allows(allow, "POST /internal/users/" + ID + "/focus-sessions/sea")).isFalse();
        assertThat(allows(allow, "GET /internal/users/" + ID + "/friends")).isFalse();
        assertThat(allows(allow, "DELETE /internal/users/" + ID + "/friends/ids")).isFalse();
    }

    private static List<String> allow(String file, String caller) throws IOException {
        List<String> result = new ArrayList<>();
        for (PropertySource<?> source : new YamlPropertySourceLoader().load(file, new ClassPathResource(file))) {
            for (int index = 0; ; index++) {
                Object value = source.getProperty("internal.api.callers." + caller + ".allow[" + index + "]");
                if (value == null) {
                    break;
                }
                result.add(value.toString());
            }
        }
        assertThat(result).as("허용목록을 읽지 못했다면 이 테스트는 의미가 없다").isNotEmpty();
        return result;
    }

    private boolean allows(List<String> allow, String route) {
        String[] wanted = route.split(" ", 2);
        return allow.stream().anyMatch(entry -> {
            String[] candidate = entry.split(" ", 2);
            return candidate.length == 2 && candidate[0].equals(wanted[0]) && matcher.match(candidate[1], wanted[1]);
        });
    }
}
