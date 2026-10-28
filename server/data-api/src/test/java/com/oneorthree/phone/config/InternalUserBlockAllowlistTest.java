package com.oneorthree.phone.config;

import com.oneorthree.phone.internal.InternalUserBlockController;
import org.junit.jupiter.api.Test;
import org.springframework.boot.env.YamlPropertySourceLoader;
import org.springframework.core.env.PropertySource;
import org.springframework.core.io.ClassPathResource;
import org.springframework.util.AntPathMatcher;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;

import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/** 차단 내부 표면 3종과 실제 배포 허용목록의 동기화 계약 (GROMO-1975). */
class InternalUserBlockAllowlistTest {

    private static final String ID = "3f4a6c1e-0000-7000-8000-00000000abcd";

    @Test
    void everyBlockRouteIsAllowedAndNeighboursRemainClosed() throws Exception {
        List<String> allow = allow();
        List<String> routes = routes();
        AntPathMatcher matcher = new AntPathMatcher();
        assertThat(routes).hasSize(3);
        assertThat(routes).allSatisfy(route -> assertThat(allows(matcher, allow, route)).isTrue());
        assertThat(allows(matcher, allow, "PUT /internal/users/" + ID + "/blocks/" + ID)).isFalse();
        assertThat(allows(matcher, allow, "GET /internal/users/" + ID + "/blocks/" + ID)).isFalse();
        assertThat(allows(matcher, allow, "DELETE /internal/users/" + ID + "/blocks")).isFalse();
    }

    private static List<String> allow() throws Exception {
        List<String> result = new ArrayList<>();
        for (PropertySource<?> source : new YamlPropertySourceLoader()
                .load("satellites", new ClassPathResource("application-satellites.yml"))) {
            for (int index = 0; ; index++) {
                Object value = source.getProperty("internal.api.callers.business.allow[" + index + "]");
                if (value == null) {
                    break;
                }
                result.add(value.toString());
            }
        }
        return result;
    }

    private static List<String> routes() {
        RequestMapping base = InternalUserBlockController.class.getAnnotation(RequestMapping.class);
        List<String> result = new ArrayList<>();
        for (Method method : InternalUserBlockController.class.getDeclaredMethods()) {
            if (method.isAnnotationPresent(GetMapping.class)) {
                result.add("GET " + fill(base.value()[0] + first(method.getAnnotation(GetMapping.class).value())));
            } else if (method.isAnnotationPresent(PostMapping.class)) {
                result.add("POST " + fill(base.value()[0] + first(method.getAnnotation(PostMapping.class).value())));
            } else if (method.isAnnotationPresent(DeleteMapping.class)) {
                result.add("DELETE " + fill(base.value()[0] + first(method.getAnnotation(DeleteMapping.class).value())));
            }
        }
        return result;
    }

    private static String fill(String path) {
        return path.replaceAll("\\{[^}]+}", ID);
    }

    private static String first(String[] values) {
        return values.length == 0 ? "" : values[0];
    }

    private static boolean allows(AntPathMatcher matcher, List<String> allow, String route) {
        String[] wanted = route.split(" ", 2);
        return allow.stream().anyMatch(entry -> {
            String[] candidate = entry.split(" ", 2);
            return candidate.length == 2 && candidate[0].equals(wanted[0]) && matcher.match(candidate[1], wanted[1]);
        });
    }
}
