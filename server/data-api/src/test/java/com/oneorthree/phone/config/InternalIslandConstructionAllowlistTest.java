package com.oneorthree.phone.config;

import com.oneorthree.phone.internal.InternalIslandConstructionController;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.env.YamlPropertySourceLoader;
import org.springframework.core.env.PropertySource;
import org.springframework.core.io.ClassPathResource;
import org.springframework.util.AntPathMatcher;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestMapping;

import java.io.IOException;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 섬 건설 내부 경로 3종이 <b>실제</b> {@code application-satellites.yml} 의 business 허용목록을
 * 통과하는지 검증한다 (GROMO-1767, {@code InternalLetterAllowlistTest} 와 같은 방식).
 *
 * <p>경로는 <b>컨트롤러 애노테이션에서 읽고</b>, 허용목록은 <b>배포되는 yml 파일에서 읽는다</b>.
 * 겨냥하는 실패는 «세그먼트 수» 다: {@code /internal/islands/*} 는 세그먼트 하나라
 * {@code /internal/islands/{id}/constructions} 를 덮지 않는다.
 */
class InternalIslandConstructionAllowlistTest {

    private static final String ID = "3f4a6c1e-0000-7000-8000-00000000abcd";
    private final AntPathMatcher matcher = new AntPathMatcher();

    @Test
    @DisplayName("건설 내부 컨트롤러의 모든 매핑이 배포되는 허용목록을 통과한다")
    void everyConstructionInternalRouteIsAllowedByTheShippedFile() throws IOException {
        List<String> allow = shippedBusinessAllowlist();
        List<String> routes = routesOf(InternalIslandConstructionController.class);

        assertThat(routes).as("3종이 모두 잡혔는지 — 매핑이 늘면 허용목록도 함께 늘어야 한다").hasSize(3);
        assertThat(routes).allSatisfy(route ->
                assertThat(allows(allow, route)).as("허용목록에 없는 내부 경로: " + route).isTrue());
    }

    @Test
    @DisplayName("세그먼트가 다르거나 메서드가 다른 이웃 경로는 열리지 않는다")
    void allowlistDoesNotLeakIntoNeighbours() throws IOException {
        List<String> allow = shippedBusinessAllowlist();

        // 3종 외에는 없다 — 목록·삭제·다른 메서드·하위 경로는 열리지 않는다.
        assertThat(allows(allow, "DELETE /internal/islands/" + ID + "/constructions")).isFalse();
        assertThat(allows(allow, "POST /internal/islands/" + ID + "/construction-target")).isFalse();
        assertThat(allows(allow, "GET /internal/islands/" + ID + "/constructions/" + ID)).isFalse();
        assertThat(allows(allow, "PUT /internal/islands/" + ID)).isFalse();
    }

    @Test
    @DisplayName("세 계약은 메서드·경로가 각각 달라 세 줄로 등록돼 있다")
    void threeContractsAreSeparateEntries() throws IOException {
        List<String> allow = shippedBusinessAllowlist();

        assertThat(allow).contains(
                "GET /internal/islands/*/construction-options",
                "PUT /internal/islands/*/construction-target",
                "POST /internal/islands/*/constructions");
    }

    // ---------------------------------------------------------------- 도구

    /** 배포되는 파일에서 business 호출자의 허용목록을 읽는다. */
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

    /** 컨트롤러 애노테이션에서 {@code "METHOD /경로"} 를 만든다 — 경로 변수는 실제 UUID 로 채운다. */
    private static List<String> routesOf(Class<?> controller) {
        List<String> routes = new ArrayList<>();
        for (Method method : controller.getDeclaredMethods()) {
            GetMapping get = method.getAnnotation(GetMapping.class);
            PutMapping put = method.getAnnotation(PutMapping.class);
            PostMapping post = method.getAnnotation(PostMapping.class);
            if (get != null) {
                routes.add("GET " + fill(first(get.value())));
            } else if (put != null) {
                routes.add("PUT " + fill(first(put.value())));
            } else if (post != null) {
                routes.add("POST " + fill(first(post.value())));
            }
        }
        return routes;
    }

    private static String first(String[] values) {
        return values.length == 0 ? "" : values[0];
    }

    private static String fill(String template) {
        return template.replaceAll("\\{[^}]+}", ID);
    }

    private boolean allows(List<String> allow, String route) {
        String[] wanted = route.split(" ", 2);
        return allow.stream().anyMatch(entry -> {
            String[] parts = entry.split(" ", 2);
            return parts.length == 2 && parts[0].equals(wanted[0]) && matcher.match(parts[1], wanted[1]);
        });
    }
}
