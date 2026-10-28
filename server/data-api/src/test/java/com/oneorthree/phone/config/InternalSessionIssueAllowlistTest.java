package com.oneorthree.phone.config;

import com.oneorthree.phone.internal.InternalSessionIssueController;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.env.YamlPropertySourceLoader;
import org.springframework.core.env.PropertySource;
import org.springframework.core.io.ClassPathResource;
import org.springframework.util.AntPathMatcher;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;

import java.io.IOException;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 2.0 세션 발급 내부 경로 2종(GROMO-2035 · 2036)이 <b>실제</b> {@code application-satellites.yml} 의
 * business 허용목록을 통과하는지 검증한다 ({@code InternalAccountAllowlistTest} 와 같은 방식).
 *
 * <p>경로는 컨트롤러 애노테이션에서, 허용목록은 <b>배포되는 yml</b> 에서 읽는다. 둘 중 하나만 고치는
 * 사고가 이 파일의 표적이다 — 컨트롤러만 만들면 dev·prod 에서 403 이고, 목록만 늘리면 죽은 줄이 남는다.
 * 어느 쪽도 로컬 테스트에서는 드러나지 않는다(내부 필터는 위성 프로파일에서만 돈다).
 */
class InternalSessionIssueAllowlistTest {

    private static final String ID = "3f4a6c1e-0000-7000-8000-00000000abcd";
    private final AntPathMatcher matcher = new AntPathMatcher();

    @Test
    @DisplayName("세션 발급 내부 컨트롤러의 모든 매핑이 배포되는 허용목록을 통과한다")
    void everySessionIssueInternalRouteIsAllowedByTheShippedFile() throws IOException {
        List<String> allow = shippedBusinessAllowlist();
        List<String> routes = routesOf(InternalSessionIssueController.class);

        assertThat(routes).containsExactlyInAnyOrder(
                "POST /internal/auth/sessions/refresh", "POST /internal/auth/guest-sessions");
        assertThat(routes).allSatisfy(route ->
                assertThat(allows(allow, route)).as("허용목록에 없는 내부 경로: " + route).isTrue());
    }

    /**
     * 허용목록이 이웃 경로를 함께 열지 않는다.
     *
     * <p>인증 축의 내부 경로는 <b>주체 검사를 타지 않는다</b>({@code InternalAuthFilter} 의
     * {@code X-User-Id} ↔ 경로 일치 검사는 {@code /internal/users/*} 접두어에만 붙는다). 그래서 이
     * 축에서 와일드카드가 새면 그 결과가 곧 「주체 검사 없는 임의 경로」다 — 다른 축보다 비싸다.
     */
    @Test
    @DisplayName("세션 발급 허용목록은 다른 메서드나 이웃 경로를 열지 않는다")
    void allowlistDoesNotLeakIntoNeighbours() throws IOException {
        List<String> allow = shippedBusinessAllowlist();

        assertThat(allows(allow, "GET /internal/auth/sessions/refresh")).isFalse();
        assertThat(allows(allow, "DELETE /internal/auth/guest-sessions")).isFalse();
        assertThat(allows(allow, "POST /internal/auth/sessions/refresh/" + ID)).isFalse();
        assertThat(allows(allow, "POST /internal/auth/guest-sessions/" + ID)).isFalse();
        assertThat(allows(allow, "POST /internal/auth/sessions")).isFalse();
    }

    // ---------------------------------------------------------------- 도구

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

    private static List<String> routesOf(Class<?> controller) {
        String base = controller.getAnnotation(RequestMapping.class).value()[0];
        List<String> routes = new ArrayList<>();
        for (Method method : controller.getDeclaredMethods()) {
            PostMapping post = method.getAnnotation(PostMapping.class);
            if (post != null) {
                routes.add("POST " + base + post.value()[0]);
            }
        }
        return routes;
    }

    private boolean allows(List<String> allow, String route) {
        String[] wanted = route.split(" ", 2);
        return allow.stream().anyMatch(entry -> {
            String[] parts = entry.split(" ", 2);
            return parts.length == 2 && parts[0].equals(wanted[0]) && matcher.match(parts[1], wanted[1]);
        });
    }
}
