package com.oneorthree.phone.config;

import com.oneorthree.phone.internal.InternalIslandJoinController;
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
 * 섬 가입·가입 요청·초대 내부 경로 5종이 <b>실제</b> {@code application-satellites.yml} 의 business
 * 허용목록을 통과하는지 검증한다 (GROMO-1760, {@code InternalIslandConstructionAllowlistTest} 와 같은 방식).
 *
 * <p>통합 테스트는 허용목록을 레지스트리로 직접 주입하므로 배포 파일의 누락을 잡지 못한다 — 여기서 메운다.
 */
class InternalIslandJoinAllowlistTest {

    private static final String ID = "3f4a6c1e-0000-7000-8000-00000000abcd";
    private final AntPathMatcher matcher = new AntPathMatcher();

    @Test
    @DisplayName("가입 내부 컨트롤러의 모든 매핑이 배포되는 허용목록을 통과한다")
    void everyJoinInternalRouteIsAllowedByTheShippedFile() throws IOException {
        List<String> allow = shippedBusinessAllowlist();
        List<String> routes = routesOf(InternalIslandJoinController.class);

        assertThat(routes).as("5종이 모두 잡혔는지 — 매핑이 늘면 허용목록도 함께 늘어야 한다").hasSize(5);
        assertThat(routes).allSatisfy(route ->
                assertThat(allows(allow, route)).as("허용목록에 없는 내부 경로: " + route).isTrue());
    }

    @Test
    @DisplayName("메서드가 다르거나 세그먼트가 다른 이웃 경로는 열리지 않는다")
    void allowlistDoesNotLeakIntoNeighbours() throws IOException {
        List<String> allow = shippedBusinessAllowlist();

        assertThat(allows(allow, "PUT /internal/users/" + ID + "/join-requests/" + ID)).isFalse();
        assertThat(allows(allow, "GET /internal/users/" + ID + "/join-requests")).isFalse();
        assertThat(allows(allow, "DELETE /internal/users/" + ID + "/islands/" + ID + "/memberships")).isFalse();
        assertThat(allows(allow, "GET /internal/users/" + ID + "/invitations/resolve")).isFalse();
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

    /** 클래스 {@code @RequestMapping} 접두 + 메서드 매핑으로 {@code "METHOD /경로"} 를 만든다. */
    private static List<String> routesOf(Class<?> controller) {
        String prefix = first(controller.getAnnotation(RequestMapping.class).value());
        List<String> routes = new ArrayList<>();
        for (Method method : controller.getDeclaredMethods()) {
            GetMapping get = method.getAnnotation(GetMapping.class);
            PostMapping post = method.getAnnotation(PostMapping.class);
            DeleteMapping delete = method.getAnnotation(DeleteMapping.class);
            if (get != null) {
                routes.add("GET " + fill(prefix + first(get.value())));
            } else if (post != null) {
                routes.add("POST " + fill(prefix + first(post.value())));
            } else if (delete != null) {
                routes.add("DELETE " + fill(prefix + first(delete.value())));
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
