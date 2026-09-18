package com.oneorthree.phone.config;

import com.oneorthree.phone.internal.InternalLetterController;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.env.YamlPropertySourceLoader;
import org.springframework.core.env.PropertySource;
import org.springframework.core.io.ClassPathResource;
import org.springframework.util.AntPathMatcher;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;

import java.io.IOException;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 편지 내부 경로 3종이 <b>실제</b> {@code application-satellites.yml} 의 business 허용목록을 통과하는지
 * 검증한다 (GROMO-1933, GROMO-1894 의 {@code InternalFriendAllowlistTest} 와 같은 방식).
 *
 * <p>경로는 <b>컨트롤러 애노테이션에서 읽고</b>, 허용목록은 <b>배포되는 yml 파일에서 읽는다</b> — 둘 중
 * 하나만 바뀌면 이 테스트가 깨진다. 겨냥하는 실패는 «세그먼트 수» 다: {@link AntPathMatcher} 의 {@code *}
 * 는 세그먼트 하나라 {@code /letters/*} 는 {@code /letters/{id}/more} 를 덮지 않는다.
 */
class InternalLetterAllowlistTest {

    private static final String ID = "3f4a6c1e-0000-7000-8000-00000000abcd";
    private final AntPathMatcher matcher = new AntPathMatcher();

    @Test
    @DisplayName("편지 내부 컨트롤러의 모든 매핑이 배포되는 허용목록을 통과한다")
    void everyLetterInternalRouteIsAllowedByTheShippedFile() throws IOException {
        List<String> allow = shippedBusinessAllowlist();
        List<String> routes = routesOf(InternalLetterController.class);

        assertThat(routes).as("3종이 모두 잡혔는지 — 매핑이 늘면 허용목록도 함께 늘어야 한다").hasSize(3);
        assertThat(routes).allSatisfy(route ->
                assertThat(allows(allow, route)).as("허용목록에 없는 내부 경로: " + route).isTrue());
    }

    @Test
    @DisplayName("세그먼트가 다르거나 메서드가 다른 이웃 경로는 열리지 않는다")
    void allowlistDoesNotLeakIntoNeighbours() throws IOException {
        List<String> allow = shippedBusinessAllowlist();

        // 목록·발송·상세 세 줄 외에는 없다 — 편지 삭제·수정·남의 편지함은 열리지 않는다.
        assertThat(allows(allow, "DELETE /internal/users/" + ID + "/letters")).isFalse();
        assertThat(allows(allow, "DELETE /internal/users/" + ID + "/letters/" + ID)).isFalse();
        assertThat(allows(allow, "POST /internal/users/" + ID + "/letters/" + ID)).isFalse();
        assertThat(allows(allow, "PUT /internal/users/" + ID + "/letters/" + ID)).isFalse();
        assertThat(allows(allow, "GET /internal/users/" + ID + "/letters/" + ID + "/replies")).isFalse();
    }

    @Test
    @DisplayName("발송과 목록은 메서드로만 갈리므로 한 줄로 합쳐 두지 않았다")
    void sendAndListAreSeparateEntries() throws IOException {
        List<String> allow = shippedBusinessAllowlist();

        assertThat(allow).contains("POST /internal/users/*/letters",
                "GET /internal/users/*/letters", "GET /internal/users/*/letters/*");
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
        RequestMapping base = controller.getAnnotation(RequestMapping.class);
        String prefix = base == null || base.value().length == 0 ? "" : base.value()[0];
        List<String> routes = new ArrayList<>();
        for (Method method : controller.getDeclaredMethods()) {
            GetMapping get = method.getAnnotation(GetMapping.class);
            PostMapping post = method.getAnnotation(PostMapping.class);
            DeleteMapping del = method.getAnnotation(DeleteMapping.class);
            if (get != null) {
                routes.add("GET " + fill(prefix + first(get.value())));
            } else if (post != null) {
                routes.add("POST " + fill(prefix + first(post.value())));
            } else if (del != null) {
                routes.add("DELETE " + fill(prefix + first(del.value())));
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
