package com.oneorthree.business.api;

import com.oneorthree.business.support.UpstreamTestBase;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;

import java.lang.reflect.GenericArrayType;
import java.lang.reflect.ParameterizedType;
import java.lang.reflect.Type;
import java.lang.reflect.WildcardType;
import java.util.HashSet;
import java.util.Set;
import java.util.TreeSet;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 공개 응답 타입 감사 (GROMO-2198) — 컨트롤러가 앱에 돌려주는 타입의 그래프에
 * {@code com.oneorthree.business.upstream} 패키지 타입(= 상류 전송 레코드)이 나타나지 않아야 한다.
 *
 * <p>상류 레코드를 그대로 내보내면 상류 필드가 바뀌는 순간 앱 계약이 따라 바뀐다. 응답은 {@code api/dto} 의
 * 자체 타입으로 한 번 감싸서 내보낸다.
 *
 * <p><b>현재 노출은 {@link #KNOWN_EXPOSURES} 에 동결해 둔다</b> (data-api 의 ArchUnit freeze 와 같은 정신).
 * 기준선 밖의 <b>새 노출</b>은 실패하고, 기준선에 있는데 더는 노출되지 않는 <b>죽은 항목</b>도 실패한다 —
 * 노출을 고쳤다면 이 집합에서 그 줄을 지운다. 노출 자체를 고치는 일은 이 테스트의 범위가 아니다.
 *
 * <p>상류 타입에 닿으면 거기서 멈춘다(그 안의 중첩 레코드까지 세지 않는다) — 노출의 «진입점»만 기준선에 둔다.
 */
class PublicResponseTypeAuditTest extends UpstreamTestBase {

    private static final String UPSTREAM_PACKAGE = "com.oneorthree.business.upstream";

    /**
     * 알려진 노출(2026-10-24 기준 14건) — {@code 핸들러 -> 상류 타입(패키지 뺀 이름, 중첩은 $)}. 새 항목을 추가하지 말고 노출을 없애라.
     *
     * <p>원인은 5곳(컨트롤러 3 + 응답 레코드 2; 방문록은 컨트롤러·레코드 한 쌍이라 «4묶음»으로도 센다) —
     * 컨트롤러: {@code IslandPromotionController}({@code IslandPromotions.*} 를 직접 반환),
     * {@code MagazineController}({@code Magazines.*} 를 직접 반환), {@code IslandGuestbookController#write}
     * ({@code ResponseEntity<IslandGuestbooks.Item>}). 응답 레코드: {@code IslandGuestbookResponses.items}
     * ({@code List<IslandGuestbooks.Item>}), {@code IslandMembershipResponses} 의 {@code Magazines.Cell magazineCell}(망원경 응답).
     */
    private static final Set<String> KNOWN_EXPOSURES = Set.of(
            "IslandGuestbookController#list -> IslandGuestbooks$Item",
            "IslandGuestbookController#write -> IslandGuestbooks$Item",
            "IslandMembershipController#pinTelescope -> Magazines$Cell",
            "IslandMembershipController#telescope -> Magazines$Cell",
            "IslandPromotionController#assets -> IslandPromotions$Assets",
            "IslandPromotionController#editor -> IslandPromotions$Editor",
            "IslandPromotionController#news -> IslandPromotions$NewsPage",
            "IslandPromotionController#promote -> IslandPromotions$Created",
            "IslandPromotionController#report -> IslandPromotions$Reported",
            "IslandPromotionController#update -> IslandPromotions$Updated",
            "MagazineController#issue -> Magazines$IssueView",
            "MagazineController#issues -> Magazines$Issues",
            "MagazineController#receipt -> Magazines$Receipt",
            "MagazineController#today -> Magazines$Today"
    );

    @Autowired
    @Qualifier("requestMappingHandlerMapping")
    RequestMappingHandlerMapping mappings;

    @Test
    @DisplayName("공개 응답이 상류 패키지 타입을 새로 노출하지 않는다 — 기준선 밖은 실패, 사라진 기준선도 실패")
    void noNewUpstreamTypeInPublicResponses() {
        Set<String> found = new TreeSet<>();
        int endpoints = 0;
        for (var handler : mappings.getHandlerMethods().values()) {
            // business 아래 모든 @RestController — 패키지를 api·linkpreview 로 좁히면 새 패키지의 컨트롤러가 조용히 빠진다.
            if (handler.getBeanType().getPackageName().startsWith("com.oneorthree.business")
                    && handler.getBeanType().isAnnotationPresent(RestController.class)) {
                String name = handler.getBeanType().getSimpleName() + "#" + handler.getMethod().getName();
                collectUpstreamTypes(handler.getMethod().getGenericReturnType(), name, new HashSet<>(), found);
                endpoints++;
            }
        }
        assertThat(endpoints).as("감사 대상 엔드포인트 수 — 매핑 탐색이 빗나가면 감사가 조용히 비어 버린다").isGreaterThan(50);

        Set<String> added = new TreeSet<>(found);
        added.removeAll(KNOWN_EXPOSURES);
        Set<String> gone = new TreeSet<>(KNOWN_EXPOSURES);
        gone.removeAll(found);

        assertThat(added)
                .as("기준선에 없는 새 상류 타입 노출 — 응답은 api/dto 의 자체 타입으로 감싸서 돌려준다")
                .isEmpty();
        assertThat(gone)
                .as("기준선에 있지만 더는 노출되지 않는 항목 — KNOWN_EXPOSURES 에서 지운다")
                .isEmpty();
    }

    private static void collectUpstreamTypes(Type type, String handler, Set<Type> visited, Set<String> found) {
        if (!visited.add(type)) {
            return;
        }
        if (type instanceof ParameterizedType parameterized) {
            for (Type argument : parameterized.getActualTypeArguments()) {
                collectUpstreamTypes(argument, handler, visited, found);
            }
            collectUpstreamTypes(parameterized.getRawType(), handler, visited, found);
        } else if (type instanceof GenericArrayType array) {
            collectUpstreamTypes(array.getGenericComponentType(), handler, visited, found);
        } else if (type instanceof WildcardType wildcard) {
            for (Type bound : wildcard.getUpperBounds()) {
                collectUpstreamTypes(bound, handler, visited, found);
            }
        } else if (type instanceof Class<?> value) {
            if (value.isArray()) {
                collectUpstreamTypes(value.getComponentType(), handler, visited, found);
                return;
            }
            if (value.getPackageName().startsWith(UPSTREAM_PACKAGE)) {
                found.add(handler + " -> " + value.getName().substring(value.getName().lastIndexOf('.') + 1));
                return;
            }
            if (value.isRecord()) {
                for (var component : value.getRecordComponents()) {
                    collectUpstreamTypes(component.getGenericType(), handler, visited, found);
                }
            }
        }
        // TypeVariable 은 건너뛴다 — 구체 타입이 아니라 따라갈 경계가 없다(제네릭 레코드는 현재 응답에 없다).
    }
}
