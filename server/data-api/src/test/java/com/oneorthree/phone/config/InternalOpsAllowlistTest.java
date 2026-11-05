package com.oneorthree.phone.config;

import com.oneorthree.phone.internal.InternalHallLessIslandCleanupController;
import com.oneorthree.phone.internal.InternalIslandFocusAverageController;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.env.YamlPropertySourceLoader;
import org.springframework.core.env.PropertySource;
import org.springframework.core.io.ClassPathResource;
import org.springframework.util.AntPathMatcher;
import org.springframework.web.bind.annotation.PostMapping;

import java.io.IOException;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 운영자 caller({@code ops}, GROMO-2280)가 <b>실제</b> {@code application-satellites.yml} 에서 선택 caller 이고 운영자
 * 컨트롤러의 경로(스냅샷 수동 실행 · 마을회관 없는 섬 정리 GROMO-2763)만 여는지, 다른 caller 의 허용목록이 그 경로를 열지
 * 않는지 본다({@code InternalRankingsAllowlistTest} 와 같은 방식).
 */
class InternalOpsAllowlistTest {

    private final AntPathMatcher matcher = new AntPathMatcher();

    @Test
    @DisplayName("ops 는 토큰 기본값이 빈 선택 caller 이고, 허용목록은 운영자 컨트롤러의 매핑과 정확히 같다")
    void opsCallerIsOptionalAndOpensOnlyTheOperatorRoutes() throws IOException {
        List<String> routes = operatorRoutes();

        assertThat(shipped("internal.api.callers.ops.token"))
                .as("기본값이 없으면 SM 에 토큰을 넣기 전 배포가 미해결 placeholder 로 죽는다")
                .isEqualTo("${SVC_TOKEN_OPS_TO_DATA:}");
        assertThat(shipped("internal.api.callers.ops.optional")).isEqualTo("true");
        assertThat(shippedAllow("ops")).as("매핑이 늘면 허용목록도 함께 늘어야 한다").isEqualTo(routes).hasSize(2);
    }

    @Test
    @DisplayName("다른 caller 의 허용목록은 운영자 경로를 열지 않는다")
    void otherCallersCannotReachTheAdminRoute() throws IOException {
        for (String caller : List.of("business", "notification")) {
            for (String route : operatorRoutes()) {
                String path = route.split(" ", 2)[1];
                assertThat(shippedAllow(caller)).as(caller + " " + path).noneMatch(entry -> {
                    String[] parts = entry.split(" ", 2);
                    return parts[0].equals("POST") && matcher.match(parts[1], path);
                });
            }
        }
    }

    /** 운영자 컨트롤러의 POST 매핑 — 허용목록 순서와 같게 컨트롤러 순서대로 모은다. */
    private static List<String> operatorRoutes() {
        List<String> routes = new ArrayList<>();
        for (Class<?> controller : List.of(InternalIslandFocusAverageController.class,
                InternalHallLessIslandCleanupController.class)) {
            for (Method method : controller.getDeclaredMethods()) {
                PostMapping post = method.getAnnotation(PostMapping.class);
                if (post != null) {
                    routes.add("POST " + post.value()[0]);
                }
            }
        }
        return routes;
    }

    // ---------------------------------------------------------------- 도구

    private static String shipped(String key) throws IOException {
        for (PropertySource<?> source : sources()) {
            Object value = source.getProperty(key);
            if (value != null) {
                return value.toString();
            }
        }
        return null;
    }

    private static List<String> shippedAllow(String caller) throws IOException {
        List<String> allow = new ArrayList<>();
        for (int i = 0; ; i++) {
            String value = shipped("internal.api.callers." + caller + ".allow[" + i + "]");
            if (value == null) {
                break;
            }
            allow.add(value);
        }
        assertThat(allow).as("허용목록을 읽지 못했다면 이 테스트는 의미가 없다").isNotEmpty();
        return allow;
    }

    private static List<PropertySource<?>> sources() throws IOException {
        return new YamlPropertySourceLoader().load("satellites", new ClassPathResource("application-satellites.yml"));
    }
}
