package com.oneorthree.phone.config;

import com.oneorthree.phone.internal.InternalAccountController;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.env.YamlPropertySourceLoader;
import org.springframework.core.env.PropertySource;
import org.springframework.core.io.ClassPathResource;
import org.springframework.util.AntPathMatcher;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;

import java.io.IOException;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 계정 내부 경로 3종이 <b>실제</b> {@code application-satellites.yml} 의 business 허용목록을 통과하는지 검증한다
 * (GROMO-1801, {@code InternalIslandConstructionAllowlistTest} 와 같은 방식).
 *
 * <p>경로는 컨트롤러 애노테이션에서, 허용목록은 배포되는 yml 에서 읽는다. {@code /internal/users/*} 는 세그먼트
 * 하나라 사용자 하위 경로를 덮지 않아야 한다.
 */
class InternalAccountAllowlistTest {

    private static final String ID = "3f4a6c1e-0000-7000-8000-00000000abcd";
    private final AntPathMatcher matcher = new AntPathMatcher();

    @Test
    @DisplayName("계정 내부 컨트롤러의 모든 매핑이 배포되는 허용목록을 통과한다")
    void everyAccountInternalRouteIsAllowedByTheShippedFile() throws IOException {
        List<String> allow = shippedBusinessAllowlist();
        List<String> routes = routesOf(InternalAccountController.class);

        assertThat(routes).containsExactlyInAnyOrder(
                "GET /internal/users/" + ID, "PATCH /internal/users/" + ID, "DELETE /internal/users/" + ID);
        assertThat(routes).allSatisfy(route ->
                assertThat(allows(allow, route)).as("허용목록에 없는 내부 경로: " + route).isTrue());
    }

    @Test
    @DisplayName("한 세그먼트 와일드카드는 하위 경로와 다른 메서드를 열지 않는다")
    void allowlistDoesNotLeakIntoNeighbours() throws IOException {
        List<String> allow = shippedBusinessAllowlist();

        assertThat(allows(allow, "POST /internal/users/" + ID)).isFalse();
        assertThat(allows(allow, "PUT /internal/users/" + ID)).isFalse();
        assertThat(allows(allow, "PATCH /internal/users/" + ID + "/notification-settings")).isFalse();
        // GROMO-2002 가 `DELETE …/letters/{id}`(편지 닫기)를 «의도적으로» 열었다 — 이웃 검사를 한 칸
        // 위로 옮긴다. 확인하려는 것은 그대로다: 계정의 `DELETE /internal/users/*` 가 하위 경로를 열지 않는다.
        assertThat(allows(allow, "DELETE /internal/users/" + ID + "/letters")).isFalse();
        assertThat(allows(allow, "GET /internal/users/" + ID + "/result-ack")).isFalse();
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
        List<String> routes = new ArrayList<>();
        for (Method method : controller.getDeclaredMethods()) {
            GetMapping get = method.getAnnotation(GetMapping.class);
            PatchMapping patch = method.getAnnotation(PatchMapping.class);
            DeleteMapping delete = method.getAnnotation(DeleteMapping.class);
            if (get != null) {
                routes.add("GET " + fill(get.value()[0]));
            } else if (patch != null) {
                routes.add("PATCH " + fill(patch.value()[0]));
            } else if (delete != null) {
                routes.add("DELETE " + fill(delete.value()[0]));
            }
        }
        return routes;
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
