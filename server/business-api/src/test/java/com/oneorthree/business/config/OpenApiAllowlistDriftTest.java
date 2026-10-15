package com.oneorthree.business.config;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.Resource;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;
import org.springframework.core.type.AnnotationMetadata;
import org.springframework.core.type.MethodMetadata;
import org.springframework.core.type.classreading.SimpleMetadataReaderFactory;
import org.springframework.util.AntPathMatcher;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestMapping;

import java.io.IOException;
import java.lang.annotation.Annotation;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 컨트롤러가 실제로 서빙하는 경로와 {@link OpenApiConfig#PUBLIC_PATH_PATTERNS} 의
 * «허용목록»이 어긋나지 않는지 검증한다 (GROMO-2069).
 *
 * <p>allowlist 방식의 약점은 «새 컨트롤러가 조용히 문서에서 빠지는 것»이다 — 이 테스트는
 * 그 방향의 드리프트를 잡는다. 경로는 테스트에 손으로 적지 않고 <b>컨트롤러 애노테이션에서
 * 읽는다</b>(Internal*AllowlistTest 와 같은 이유 — 손으로 다시 적으면 자기 자신과 비교하는
 * 테스트가 된다).
 *
 * <p>반대 방향(허용목록에 없는데 문서에 나오는 경로)은 springdoc 의 pathsToMatch 자체가
 * 걸러 주므로 여기선 보지 않는다.
 */
class OpenApiAllowlistDriftTest {

    /** 문서에서 «의도적으로» 제외하는 경로 — 허용목록에 넣지 않는다는 결정을 여기에 명시한다. */
    private static final Set<String> DELIBERATE_EXCLUSIONS = Set.of(
            "/health"  // 컨테이너 헬스체크 — 외부 API 계약이 아니다
    );

    private static final List<Class<? extends Annotation>> MAPPING_ANNOTATIONS = List.of(
            RequestMapping.class, GetMapping.class, PostMapping.class,
            PutMapping.class, DeleteMapping.class, PatchMapping.class);

    private final AntPathMatcher matcher = new AntPathMatcher();

    @Test
    @DisplayName("모든 컨트롤러 경로가 공개 허용목록 또는 명시적 제외 목록에 있다")
    void everyControllerRouteIsCovered() throws IOException {
        List<String> uncovered = new ArrayList<>();
        for (String route : allControllerRoutes("com.oneorthree.business")) {
            boolean covered = OpenApiConfig.PUBLIC_PATH_PATTERNS.stream()
                    .anyMatch(pattern -> matcher.match(pattern, route));
            if (!covered && !DELIBERATE_EXCLUSIONS.contains(route)) {
                uncovered.add(route);
            }
        }
        assertThat(uncovered)
                .as("허용목록(PUBLIC_PATH_PATTERNS)에도 의도적 제외 목록에도 없는 경로 — "
                        + "공개 문서에서 빠진다. 어느 쪽인지 정하고 목록에 적어라.")
                .isEmpty();
    }

    /** 클래스·메서드 레벨 매핑을 조합해 컨트롤러가 서빙하는 전체 경로를 만든다. */
    private List<String> allControllerRoutes(String basePackage) throws IOException {
        var resolver = new PathMatchingResourcePatternResolver();
        var factory = new SimpleMetadataReaderFactory();
        List<String> routes = new ArrayList<>();
        for (Resource resource : resolver.getResources(
                "classpath*:" + basePackage.replace('.', '/') + "/**/*.class")) {
            AnnotationMetadata meta = factory.getMetadataReader(resource).getAnnotationMetadata();
            if (!meta.getClassName().endsWith("Controller") || meta.getClassName().contains("$")) {
                continue;
            }
            List<String> prefixes = mappingValues(meta.getAnnotations().get(RequestMapping.class));
            for (MethodMetadata method : meta.getDeclaredMethods()) {
                List<String> suffixes = new ArrayList<>();
                for (Class<? extends Annotation> annotation : MAPPING_ANNOTATIONS) {
                    suffixes.addAll(mappingValues(method.getAnnotations().get(annotation)));
                }
                // 매핑 애노테이션이 «아예 없는» 메서드는 경로를 만들지 않는다 — 헬퍼 메서드가
                // 클래스 prefix 만으로 가짜 경로를 낳는다.
                boolean mapped = MAPPING_ANNOTATIONS.stream()
                        .anyMatch(a -> method.getAnnotations().get(a).isPresent());
                if (!mapped) {
                    continue;
                }
                for (String prefix : orEmpty(prefixes)) {
                    for (String suffix : orEmpty(suffixes)) {
                        routes.add(prefix + suffix);
                    }
                }
            }
        }
        return routes;
    }

    private static List<String> orEmpty(List<String> parts) {
        return parts.isEmpty() ? List.of("") : parts;
    }

    /** 매핑 애노테이션의 value/path 를 읽는다 — 둘은 @AliasFor 로 같은 자리다. */
    private static List<String> mappingValues(
            org.springframework.core.annotation.MergedAnnotation<?> annotation) {
        if (annotation == null || !annotation.isPresent()) {
            return List.of();
        }
        Set<String> values = new LinkedHashSet<>();
        for (String v : annotation.getStringArray("value")) {
            values.add(v);
        }
        for (String v : annotation.getStringArray("path")) {
            values.add(v);
        }
        return List.copyOf(values);
    }
}
