package com.oneorthree.phone.config;

import com.oneorthree.phone.internal.InternalIslandFocusMembersController;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.env.YamlPropertySourceLoader;
import org.springframework.core.env.PropertySource;
import org.springframework.core.io.ClassPathResource;
import org.springframework.util.AntPathMatcher;
import org.springframework.web.bind.annotation.GetMapping;

import java.io.IOException;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 같이 낚시 스냅샷 내부 경로 2종이 <b>실제</b> {@code application-satellites.yml} 의 business 허용목록을
 * 통과하는지 검증한다 (GROMO-1765, {@code InternalIslandConstructionAllowlistTest} 와 같은 방식).
 * {@code /internal/islands/*} 는 세그먼트 하나라 {@code /internal/islands/{id}/focus-members} 를 덮지 않는다.
 */
class InternalIslandFocusMembersAllowlistTest {

    private static final String ID = "3f4a6c1e-0000-7000-8000-00000000abcd";
    private final AntPathMatcher matcher = new AntPathMatcher();

    @Test
    @DisplayName("스냅샷 내부 컨트롤러의 모든 매핑이 배포되는 허용목록을 통과한다")
    void everyRouteIsAllowedByTheShippedFile() throws IOException {
        List<String> allow = shippedBusinessAllowlist();
        List<String> routes = new ArrayList<>();
        for (Method method : InternalIslandFocusMembersController.class.getDeclaredMethods()) {
            GetMapping get = method.getAnnotation(GetMapping.class);
            if (get != null) {
                routes.add("GET " + get.value()[0].replaceAll("\\{[^}]+}", ID));
            }
        }

        assertThat(routes).as("2종이 모두 잡혔는지 — 매핑이 늘면 허용목록도 함께 늘어야 한다").hasSize(2);
        assertThat(routes).allSatisfy(route ->
                assertThat(allows(allow, route)).as("허용목록에 없는 내부 경로: " + route).isTrue());
    }

    @Test
    @DisplayName("다른 메서드·하위 경로는 열리지 않는다")
    void allowlistDoesNotLeakIntoNeighbours() throws IOException {
        List<String> allow = shippedBusinessAllowlist();

        assertThat(allows(allow, "POST /internal/islands/" + ID + "/focus-members")).isFalse();
        assertThat(allows(allow, "DELETE /internal/islands/" + ID + "/rest-members")).isFalse();
        assertThat(allows(allow, "GET /internal/islands/" + ID + "/focus-members/" + ID)).isFalse();
    }

    private static List<String> shippedBusinessAllowlist() throws IOException {
        List<PropertySource<?>> sources = new YamlPropertySourceLoader()
                .load("satellites", new ClassPathResource("application-satellites.yml"));
        List<String> allow = new ArrayList<>();
        for (PropertySource<?> source : sources) {
            for (int i = 0; ; i++) {
                Object value = source.getProperty("internal.api.callers.business.allow[" + i + "]");
                if (value == null) {
                    break;
                }
                allow.add(value.toString());
            }
        }
        assertThat(allow).as("허용목록을 읽지 못했다면 이 테스트는 의미가 없다").isNotEmpty();
        return allow;
    }

    private boolean allows(List<String> allow, String route) {
        String[] wanted = route.split(" ", 2);
        return allow.stream().anyMatch(entry -> {
            String[] parts = entry.split(" ", 2);
            return parts.length == 2 && parts[0].equals(wanted[0]) && matcher.match(parts[1], wanted[1]);
        });
    }
}
