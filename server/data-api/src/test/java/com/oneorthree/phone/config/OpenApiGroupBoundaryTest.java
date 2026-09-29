package com.oneorthree.phone.config;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.Resource;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;
import org.springframework.core.type.AnnotationMetadata;
import org.springframework.core.type.MethodMetadata;
import org.springframework.core.type.classreading.SimpleMetadataReaderFactory;
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
 * {@code /internal/**} 경로와 {@code internal} 패키지의 일치를 검증한다 (GROMO-2069).
 *
 * <p>게시 스펙은 {@code OpenApiConfig#internalApi} 그룹({@code /internal/**}) 하나다.
 * 그룹 필터가 «경로 패턴»만 보기 때문에, 경계가 실제로 지켜지려면 코드 쪽 규칙 —
 * internal 패키지는 /internal/** 만 만들고, 다른 패키지는 /internal/** 를 만들지 않는다 —
 * 이 성립해야 한다. 이 테스트는 그 규칙을 애노테이션 스캔으로 고정한다.
 *
 * <p>경로를 손으로 적지 않는 이유는 Internal*AllowlistTest 와 같다 — 자기가 적은 문자열과
 * 자기가 적은 문자열을 비교하는 테스트는 어느 한쪽만 바뀐 사고를 못 잡는다.
 */
class OpenApiGroupBoundaryTest {

    private static final List<Class<? extends Annotation>> MAPPING_ANNOTATIONS = List.of(
            RequestMapping.class, GetMapping.class, PostMapping.class,
            PutMapping.class, DeleteMapping.class, PatchMapping.class);

    @Test
    @DisplayName("internal 패키지 컨트롤러는 /internal/** 경로만 만든다")
    void internalPackageOnlyServesInternalPaths() throws IOException {
        List<String> offenders = new ArrayList<>();
        for (String route : allControllerRoutes("com.oneorthree.phone.internal")) {
            if (!route.startsWith("/internal/")) {
                offenders.add(route);
            }
        }
        assertThat(offenders)
                .as("internal 패키지인데 /internal/ 밖의 경로 — 게시 스펙(internal 그룹)에서 빠진다.")
                .isEmpty();
    }

    @Test
    @DisplayName("internal 패키지 밖 컨트롤러는 /internal/** 경로를 만들지 않는다")
    void outsidePackageNeverServesInternalPaths() throws IOException {
        List<String> offenders = new ArrayList<>();
        // com.oneorthree.phone 전체를 훑되 internal 패키지는 건너뛴다.
        for (var entry : allControllerRoutesWithOwner("com.oneorthree.phone").entrySet()) {
            if (entry.getKey().contains(".internal.")) {
                continue;
            }
            for (String route : entry.getValue()) {
                if (route.startsWith("/internal/")) {
                    offenders.add(entry.getKey() + " -> " + route);
                }
            }
        }
        assertThat(offenders)
                .as("internal 패키지 밖인데 /internal/ 경로를 만든다 — 그룹 경계를 우회한다.")
                .isEmpty();
    }

    /** 클래스·메서드 레벨 매핑을 조합해 컨트롤러가 서빙하는 전체 경로를 만든다. */
    private List<String> allControllerRoutes(String basePackage) throws IOException {
        List<String> all = new ArrayList<>();
        for (List<String> routes : allControllerRoutesWithOwner(basePackage).values()) {
            all.addAll(routes);
        }
        return all;
    }

    private java.util.Map<String, List<String>> allControllerRoutesWithOwner(String basePackage)
            throws IOException {
        var resolver = new PathMatchingResourcePatternResolver();
        var factory = new SimpleMetadataReaderFactory();
        var byClass = new java.util.LinkedHashMap<String, List<String>>();
        for (Resource resource : resolver.getResources(
                "classpath*:" + basePackage.replace('.', '/') + "/**/*.class")) {
            AnnotationMetadata meta = factory.getMetadataReader(resource).getAnnotationMetadata();
            if (!meta.getClassName().endsWith("Controller") || meta.getClassName().contains("$")) {
                continue;
            }
            List<String> prefixes = mappingValues(meta.getAnnotations().get(RequestMapping.class));
            List<String> routes = new ArrayList<>();
            for (MethodMetadata method : meta.getDeclaredMethods()) {
                List<String> suffixes = new ArrayList<>();
                for (Class<? extends Annotation> annotation : MAPPING_ANNOTATIONS) {
                    suffixes.addAll(mappingValues(method.getAnnotations().get(annotation)));
                }
                // 매핑 애노테이션이 «아예 없는» 메서드는 경로를 만들지 않는다 — 헬퍼 메서드가
                // 클래스 prefix 만으로 가짜 경로를 낳는다(≫"/internal" 같은 유령 경로).
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
            if (!routes.isEmpty()) {
                byClass.put(meta.getClassName(), routes);
            }
        }
        return byClass;
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
