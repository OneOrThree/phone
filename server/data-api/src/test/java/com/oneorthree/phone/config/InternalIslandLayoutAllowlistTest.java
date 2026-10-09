package com.oneorthree.phone.config;

import com.oneorthree.phone.internal.InternalIslandLayoutController;
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
 * 섬 배치 내부 경로가 <b>실제</b> {@code application-satellites.yml} 의 business 허용목록을 통과하는지
 * 고정한다 (GROMO-2232, {@code InternalIslandConstructionAllowlistTest} 와 같은 방식). 줄이 지워지면 CI 가 잡는다.
 */
class InternalIslandLayoutAllowlistTest {

    private static final String ID = "3f4a6c1e-0000-7000-8000-00000000abcd";
    private final AntPathMatcher matcher = new AntPathMatcher();

    @Test
    @DisplayName("배치 내부 컨트롤러의 모든 GET 매핑이 배포되는 허용목록을 통과한다")
    void layoutRouteIsAllowedByTheShippedFile() throws IOException {
        List<String> allow = shippedBusinessAllowlist();
        List<String> routes = new ArrayList<>();
        for (Method method : InternalIslandLayoutController.class.getDeclaredMethods()) {
            GetMapping get = method.getAnnotation(GetMapping.class);
            if (get != null) {
                routes.add(get.value()[0].replaceAll("\\{[^}]+}", ID));
            }
        }

        assertThat(routes).as("매핑이 늘면 허용목록도 함께 늘어야 한다").hasSize(1);
        assertThat(routes).allSatisfy(path ->
                assertThat(allows(allow, "GET", path)).as("허용목록에 없는 내부 경로: " + path).isTrue());
    }

    @Test
    @DisplayName("다른 메서드·하위 경로는 열리지 않는다")
    void neighboursStayClosed() throws IOException {
        List<String> allow = shippedBusinessAllowlist();

        assertThat(allows(allow, "PUT", "/internal/islands/" + ID + "/layout")).isFalse();
        assertThat(allows(allow, "GET", "/internal/islands/" + ID + "/layout/extra")).isFalse();
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

    private boolean allows(List<String> allow, String method, String path) {
        return allow.stream().anyMatch(entry -> {
            String[] parts = entry.split(" ", 2);
            return parts.length == 2 && parts[0].equals(method) && matcher.match(parts[1], path);
        });
    }
}
