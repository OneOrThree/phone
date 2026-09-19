package com.oneorthree.phone.config;

import com.oneorthree.phone.internal.InternalIslandQuestController;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.env.YamlPropertySourceLoader;
import org.springframework.core.env.PropertySource;
import org.springframework.core.io.ClassPathResource;
import org.springframework.util.AntPathMatcher;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;

import java.io.IOException;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 섬 퀘스트 내부 경로 5종이 <b>실제</b> {@code application-satellites.yml} 의 business 허용목록을
 * 통과하는지 검증한다 (GROMO-1773, {@code InternalAppearanceAllowlistTest} 와 같은 방식).
 *
 * <p>기대 경로는 컨트롤러 애노테이션에서 읽고 허용목록은 배포되는 yml 에서 읽는다 — 둘 중
 * 하나만 바뀌면 이 테스트가 깨진다. {@link AntPathMatcher} 의 {@code *} 는 세그먼트 하나라
 * {@code /internal/users/*} 는 그 아래 경로를 덮지 않는다.
 */
class InternalQuestAllowlistTest {

    private static final String ID = "3f4a6c1e-0000-7000-8000-00000000abcd";
    private final AntPathMatcher matcher = new AntPathMatcher();

    @Test
    @DisplayName("퀘스트 내부 컨트롤러의 모든 매핑이 배포되는 허용목록을 통과한다")
    void everyQuestInternalRouteIsAllowedByTheShippedFile() throws IOException {
        List<String> allow = shippedBusinessAllowlist();
        List<String> routes = routesOf(InternalIslandQuestController.class);

        assertThat(routes).as("5종이 모두 잡혔는지 — 매핑이 늘면 허용목록도 함께 늘어야 한다")
                .containsExactlyInAnyOrder(
                        "GET /internal/islands/" + ID + "/quests/current",
                        "GET /internal/islands/" + ID + "/quests/" + ID + "/progress",
                        "POST /internal/islands/" + ID + "/quests",
                        "PATCH /internal/islands/" + ID + "/quests/" + ID,
                        "POST /internal/islands/" + ID + "/quests/" + ID + "/claims");
        assertThat(routes).allSatisfy(route ->
                assertThat(allows(allow, route)).as("허용목록에 없는 내부 경로: " + route).isTrue());
    }

    @Test
    @DisplayName("세그먼트가 한 칸 더 붙은 경로는 허용되지 않는다")
    void allowlistDoesNotLeakIntoDeeperSegments() throws IOException {
        List<String> allow = shippedBusinessAllowlist();

        assertThat(allows(allow, "GET /internal/islands/" + ID + "/quests/" + ID + "/progress/" + ID)).isFalse();
        assertThat(allows(allow, "POST /internal/islands/" + ID + "/quests/" + ID + "/claims/" + ID)).isFalse();
        assertThat(allows(allow, "DELETE /internal/islands/" + ID + "/quests/" + ID)).isFalse();
        assertThat(allows(allow, "POST /internal/islands/" + ID + "/quests/" + ID)).isFalse();
    }

    // ---------------------------------------------------------------- 도구

    /** 배포되는 파일에서 business 호출자의 허용목록을 읽는다. */
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

    /** 컨트롤러 애노테이션에서 {@code "METHOD /경로"} 를 만든다 — 경로 변수는 실제 UUID 로 채운다. */
    private static List<String> routesOf(Class<?> controller) {
        RequestMapping base = controller.getAnnotation(RequestMapping.class);
        String prefix = base == null || base.value().length == 0 ? "" : base.value()[0];
        List<String> routes = new ArrayList<>();
        for (Method method : controller.getDeclaredMethods()) {
            GetMapping get = method.getAnnotation(GetMapping.class);
            PatchMapping patch = method.getAnnotation(PatchMapping.class);
            PostMapping post = method.getAnnotation(PostMapping.class);
            if (get != null) {
                routes.add("GET " + fill(prefix + first(get.value())));
            } else if (post != null) {
                routes.add("POST " + fill(prefix + first(post.value())));
            } else if (patch != null) {
                routes.add("PATCH " + fill(prefix + first(patch.value())));
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
