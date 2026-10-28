package com.oneorthree.phone.config;

import com.oneorthree.phone.internal.InternalIslandRankingsController;
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
 * 주간 섬 랭킹(GROMO-1997)이 <b>실제</b> {@code application-satellites.yml} 의 business 허용목록을 통과하는지
 * 검증한다({@code InternalIslandRecordsAllowlistTest} 와 같은 방식).
 */
class InternalRankingsAllowlistTest {

    private static final String ID = "3f4a6c1e-0000-7000-8000-00000000abcd";
    private final AntPathMatcher matcher = new AntPathMatcher();

    @Test
    @DisplayName("랭킹 내부 컨트롤러의 모든 매핑이 배포되는 허용목록을 통과한다")
    void everyRankingInternalRouteIsAllowedByTheShippedFile() throws IOException {
        List<String> allow = shippedBusinessAllowlist();
        List<String> routes = routesOf(InternalIslandRankingsController.class);

        assertThat(routes).as("매핑이 늘면 허용목록도 함께 늘어야 한다").hasSize(1);
        assertThat(routes).allSatisfy(route ->
                assertThat(allows(allow, route)).as("허용목록에 없는 내부 경로: " + route).isTrue());
    }

    @Test
    @DisplayName("한 줄은 다른 메서드·상위·하위 경로를 열지 않고, 폐기된 주민 랭킹도 열지 않는다")
    void allowlistDoesNotLeakIntoNeighbours() throws IOException {
        List<String> allow = shippedBusinessAllowlist();

        assertThat(allows(allow, "POST /internal/users/" + ID + "/island-rankings")).isFalse();
        assertThat(allows(allow, "GET /internal/users/" + ID + "/island-rankings/x")).isFalse();
        // 주의: `GET /internal/users/*` 가 이미 있어 «id 자리에 island-rankings 가 온» 3세그먼트 경로는
        // 그 줄이 받는다(계정 조회). 새 줄이 여는 것이 아니므로 여기서 검사하지 않는다.
        // 주민 랭킹은 결정 B23·B15 로 엔드포인트 자체가 폐기됐다 — 되살아나면 여기서 잡힌다.
        assertThat(allows(allow, "GET /internal/islands/" + ID + "/rankings/members")).isFalse();
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
            if (get != null) {
                routes.add("GET " + fill(get.value().length == 0 ? "" : get.value()[0]));
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
