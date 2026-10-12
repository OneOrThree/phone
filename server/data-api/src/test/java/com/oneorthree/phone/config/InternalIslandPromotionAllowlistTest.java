package com.oneorthree.phone.config;

import com.oneorthree.phone.internal.InternalIslandPromotionController;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.env.YamlPropertySourceLoader;
import org.springframework.core.env.PropertySource;
import org.springframework.core.io.ClassPathResource;
import org.springframework.util.AntPathMatcher;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;

import java.io.IOException;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 잡지 홍보 신청·섬 소식 내부 경로 2종이 <b>실제</b> {@code application-satellites.yml} 의 business 허용목록을
 * 통과하는지 검증한다 (GROMO-2267, {@code InternalIslandGuestbookAllowlistTest} 와 같은 방식). 허용목록에 없으면
 * 운영에서 403 이라 통합 테스트(자기 허용목록을 따로 등록한다)로는 오타를 못 잡는다.
 *
 * <p>경로는 컨트롤러 애노테이션에서, 허용목록은 배포되는 yml 에서 읽는다. 겨냥하는 실패는 «세그먼트 수»와 «메서드» 다:
 * 신청(POST, 통장에서 돈을 뺀다)과 소식(GET)은 마지막 세그먼트가 달라 한 줄로 합칠 수 없고, 합치면 조회 권한이
 * 신청을 연다.
 */
class InternalIslandPromotionAllowlistTest {

    private static final String ID = "3f4a6c1e-0000-7000-8000-00000000abcd";
    private final AntPathMatcher matcher = new AntPathMatcher();

    @Test
    @DisplayName("홍보 내부 컨트롤러의 모든 매핑이 배포되는 허용목록을 통과한다")
    void everyPromotionInternalRouteIsAllowedByTheShippedFile() throws IOException {
        List<String> allow = shippedBusinessAllowlist();
        List<String> routes = routesOf(InternalIslandPromotionController.class);

        assertThat(routes).as("2종이 모두 잡혔는지 — 매핑이 늘면 허용목록도 함께 늘어야 한다").hasSize(2);
        assertThat(routes).allSatisfy(route ->
                assertThat(allows(allow, route)).as("허용목록에 없는 내부 경로: " + route).isTrue());
    }

    @Test
    @DisplayName("메서드가 다르거나 세그먼트가 다른 이웃 경로는 열리지 않는다")
    void allowlistDoesNotLeakIntoNeighbours() throws IOException {
        List<String> allow = shippedBusinessAllowlist();
        String base = "/internal/users/" + ID + "/islands/" + ID;

        assertThat(allows(allow, "GET " + base + "/promotions")).isFalse();
        assertThat(allows(allow, "DELETE " + base + "/promotions")).isFalse();
        assertThat(allows(allow, "POST " + base + "/news")).isFalse();
        assertThat(allows(allow, "DELETE " + base + "/news")).isFalse();
        assertThat(allows(allow, "GET " + base + "/news/" + ID)).isFalse();
        assertThat(allows(allow, "POST " + base + "/promotions/" + ID)).isFalse();
        // 섬 축(userId 없는) 경로로는 열리지 않는다 — 본인 명령은 사용자 축뿐이다.
        assertThat(allows(allow, "POST /internal/islands/" + ID + "/promotions")).isFalse();
        assertThat(allows(allow, "GET /internal/islands/" + ID + "/news")).isFalse();
    }

    @Test
    @DisplayName("두 계약은 메서드·경로가 각각 달라 두 줄로 등록돼 있다")
    void twoContractsAreSeparateEntries() throws IOException {
        assertThat(shippedBusinessAllowlist()).contains(
                "POST /internal/users/*/islands/*/promotions",
                "GET /internal/users/*/islands/*/news");
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
            if (get != null) {
                routes.add("GET " + fill(prefix + first(get.value())));
            } else if (post != null) {
                routes.add("POST " + fill(prefix + first(post.value())));
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
