package com.oneorthree.phone.config;

import com.oneorthree.phone.internal.InternalCustomizationRewardPoolAdminController;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.env.YamlPropertySourceLoader;
import org.springframework.core.env.PropertySource;
import org.springframework.core.io.ClassPathResource;
import org.springframework.util.AntPathMatcher;
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

/**
 * 꾸미기 아이템 현황·추첨 풀 관리 경로 5종이 <b>실제</b> {@code application-satellites.yml} 의 console-member-1/2/3 허용목록을
 * 통과하고 business 에는 열리지 않는지 검증한다 (GROMO-2829, {@code InternalIslandPromotionAllowlistTest} 와 같은 방식).
 * 통합 테스트는 자기 허용목록을 따로 등록하므로 배포 파일의 오타는 여기서만 잡힌다.
 */
class InternalCustomizationRewardPoolAllowlistTest {

    private static final String ID = "3f4a6c1e-0000-7000-8000-00000000abcd";
    private final AntPathMatcher matcher = new AntPathMatcher();

    @Test
    @DisplayName("새 컨트롤러의 모든 매핑을 console-member-1/2/3 허용목록이 열고 business 는 열지 않는다")
    void everyRouteIsAllowedForConsoleMembersOnly() throws IOException {
        List<String> routes = routesOf(InternalCustomizationRewardPoolAdminController.class);
        assertThat(routes).as("5종이 모두 잡혔는지 — 매핑이 늘면 허용목록도 함께 늘어야 한다").hasSize(5);

        for (String caller : List.of("console-member-1", "console-member-2", "console-member-3")) {
            List<String> allow = shippedAllowlist(caller);
            assertThat(routes).allSatisfy(route ->
                    assertThat(allows(allow, route)).as(caller + " 허용목록에 없는 경로: " + route).isTrue());
        }
        List<String> business = shippedAllowlist("business");
        assertThat(routes).allSatisfy(route ->
                assertThat(allows(business, route)).as("business 에 열린 경로: " + route).isFalse());
    }

    @Test
    @DisplayName("메서드나 세그먼트가 다른 이웃 경로는 열리지 않는다")
    void neighboursStayClosed() throws IOException {
        for (String caller : List.of("console-member-1", "console-member-2", "console-member-3")) {
            List<String> allow = shippedAllowlist(caller);
            String base = "/internal/admin/customization";
            assertThat(allows(allow, "POST " + base + "/items")).isFalse();
            assertThat(allows(allow, "PUT " + base + "/reward-pool")).isFalse();
            assertThat(allows(allow, "GET " + base + "/reward-pool/approvals/" + ID)).isFalse();
            assertThat(allows(allow, "PUT " + base + "/reward-pool/approvals/" + ID)).isFalse();
            assertThat(allows(allow, "DELETE " + base + "/reward-pool/publications/" + ID)).isFalse();
            assertThat(allows(allow, "PUT " + base + "/reward-pool/publications/" + ID + "/" + ID)).isFalse();
        }
    }

    // ---------------------------------------------------------------- 도구

    private static List<String> shippedAllowlist(String caller) throws IOException {
        List<PropertySource<?>> sources = new YamlPropertySourceLoader()
                .load("satellites", new ClassPathResource("application-satellites.yml"));
        List<String> allow = new ArrayList<>();
        for (PropertySource<?> source : sources) {
            for (int i = 0; ; i++) {
                Object value = source.getProperty("internal.api.callers." + caller + ".allow[" + i + "]");
                if (value == null) {
                    break;
                }
                allow.add(value.toString());
            }
        }
        assertThat(allow).as("허용목록을 읽지 못했다면 이 테스트는 의미가 없다: " + caller).isNotEmpty();
        return allow;
    }

    /** 클래스 {@code @RequestMapping} 접두 + 메서드 매핑으로 {@code "METHOD /경로"} 를 만든다. DELETE 도 읽는다. */
    private static List<String> routesOf(Class<?> controller) {
        String prefix = first(controller.getAnnotation(RequestMapping.class).value());
        List<String> routes = new ArrayList<>();
        for (Method method : controller.getDeclaredMethods()) {
            GetMapping get = method.getAnnotation(GetMapping.class);
            PostMapping post = method.getAnnotation(PostMapping.class);
            PutMapping put = method.getAnnotation(PutMapping.class);
            DeleteMapping delete = method.getAnnotation(DeleteMapping.class);
            if (get != null) {
                routes.add("GET " + fill(prefix + first(get.value())));
            } else if (post != null) {
                routes.add("POST " + fill(prefix + first(post.value())));
            } else if (put != null) {
                routes.add("PUT " + fill(prefix + first(put.value())));
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
