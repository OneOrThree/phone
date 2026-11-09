package com.oneorthree.phone.config;

import org.junit.jupiter.api.Test;
import org.springframework.boot.env.YamlPropertySourceLoader;
import org.springframework.core.io.ClassPathResource;
import org.springframework.core.env.PropertySource;

import com.oneorthree.phone.internal.InternalCustomizationGrantAdminController;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestMapping;

import java.io.IOException;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/** 꾸미기 지급 경로 5개는 배포되는 yml 의 console 세 목록에만 있고, business 등에는 열리지 않는다. */
class InternalCustomizationGrantAllowlistTest {
    private static final List<String> ROUTES = List.of(
            "POST /internal/admin/customization/grants/previews",
            "POST /internal/admin/customization/grants/approvals/*",
            "DELETE /internal/admin/customization/grants/approvals/*",
            "PUT /internal/admin/customization/grants/executions/*",
            "GET /internal/admin/customization/grants/executions");

    @Test
    void everyConsoleMemberMayCallAllGrantRoutes() throws IOException {
        for (String caller : List.of("console-member-1", "console-member-2", "console-member-3")) {
            assertThat(allowlist(caller)).as(caller).containsAll(ROUTES);
        }
    }

    @Test
    void everyControllerMappingIsCoveredByTheConsoleAllowlist() throws IOException {
        List<String> mappings = new ArrayList<>();
        String base = InternalCustomizationGrantAdminController.class.getAnnotation(RequestMapping.class).value()[0];
        for (Method method : InternalCustomizationGrantAdminController.class.getDeclaredMethods()) {
            GetMapping get = method.getAnnotation(GetMapping.class);
            PostMapping post = method.getAnnotation(PostMapping.class);
            PutMapping put = method.getAnnotation(PutMapping.class);
            DeleteMapping delete = method.getAnnotation(DeleteMapping.class);
            if (get != null) {
                mappings.add("GET " + base + get.value()[0]);
            } else if (post != null) {
                mappings.add("POST " + base + post.value()[0]);
            } else if (put != null) {
                mappings.add("PUT " + base + put.value()[0]);
            } else if (delete != null) {
                mappings.add("DELETE " + base + delete.value()[0]);
            }
        }
        assertThat(mappings).hasSize(ROUTES.size());
        // 컨트롤러의 {id} 자리를 허용목록의 * 로 바꾸면 5개 경로와 정확히 같아야 한다 — 매핑을 더하고 목록을 빠뜨리는 실수를 막는다.
        assertThat(mappings.stream().map(m -> m.replaceAll("\\{[^}]+}", "*")).toList())
                .containsExactlyInAnyOrderElementsOf(ROUTES);
    }

    @Test
    void nonConsoleCallersMayNotCallGrantRoutes() throws IOException {
        for (String caller : List.of("business", "notification", "realtime", "ops")) {
            assertThat(allowlist(caller)).as(caller).doesNotContainAnyElementsOf(ROUTES);
            assertThat(allowlist(caller)).as(caller)
                    .noneMatch(route -> route.contains("/internal/admin/customization/"));
        }
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
