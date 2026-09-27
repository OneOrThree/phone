package com.oneorthree.phone.config;

import com.oneorthree.phone.internal.InternalReportDeliveryController;
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

/** 신고 workflow 컨트롤러와 실제 배포 허용목록이 함께 바뀌는지 검증한다. */
class InternalReportDeliveryAllowlistTest {

    private static final String ID = "3f4a6c1e-0000-7000-8000-000000001976";
    private final AntPathMatcher matcher = new AntPathMatcher();

    @Test
    void everyControllerRouteIsAllowedByShippedConfiguration() throws IOException {
        List<String> allow = shippedBusinessAllowlist();
        RequestMapping base = InternalReportDeliveryController.class.getAnnotation(RequestMapping.class);
        List<String> routes = new ArrayList<>();
        for (Method method : InternalReportDeliveryController.class.getDeclaredMethods()) {
            PostMapping post = method.getAnnotation(PostMapping.class);
            if (post != null) {
                routes.add("POST " + (base.value()[0] + post.value()[0]).replaceAll("\\{[^}]+}", ID));
            }
        }
        assertThat(routes).hasSize(6).allSatisfy(route ->
                assertThat(allowed(allow, route)).as("허용목록에 없는 내부 경로: " + route).isTrue());
        assertThat(allowed(allow, "GET /internal/users/" + ID + "/report-deliveries/" + ID + "/claim"))
                .isFalse();
        assertThat(allowed(allow, "POST /internal/users/" + ID + "/report-deliveries/" + ID + "/unknown"))
                .isFalse();
    }

    private static List<String> shippedBusinessAllowlist() throws IOException {
        List<PropertySource<?>> sources = new YamlPropertySourceLoader()
                .load("satellites", new ClassPathResource("application-satellites.yml"));
        List<String> allow = new ArrayList<>();
        for (PropertySource<?> source : sources) {
            for (int i = 0; ; i++) {
                Object value = source.getProperty("internal.api.callers.business.allow[" + i + "]");
                if (value == null) break;
                allow.add(value.toString());
            }
        }
        return allow;
    }

    private boolean allowed(List<String> allow, String route) {
        String[] wanted = route.split(" ", 2);
        return allow.stream().anyMatch(entry -> {
            String[] parts = entry.split(" ", 2);
            return parts[0].equals(wanted[0]) && matcher.match(parts[1], wanted[1]);
        });
    }
}
