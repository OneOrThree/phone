package com.oneorthree.phone.architecture;

import com.tngtech.archunit.base.DescribedPredicate;
import com.tngtech.archunit.core.domain.JavaClass;
import com.tngtech.archunit.core.domain.JavaClasses;
import com.tngtech.archunit.core.domain.JavaPackage;
import com.tngtech.archunit.core.importer.ClassFileImporter;
import com.tngtech.archunit.core.importer.ImportOption;
import com.tngtech.archunit.lang.ArchCondition;
import com.tngtech.archunit.lang.ArchRule;
import com.tngtech.archunit.lang.ConditionEvents;
import com.tngtech.archunit.lang.SimpleConditionEvent;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.classes;
import static com.tngtech.archunit.library.dependencies.SlicesRuleDefinition.slices;
import static org.assertj.core.api.Assertions.assertThat;

/**
 * 도메인 사이의 의존 방향을 <b>빌드 실패로</b> 고정한다 (GROMO-1724).
 *
 * <p>GROMO-1656 이 도메인 간 순환을 238개 → 0개, 레이어 역행 참조를 15쌍/49건 → 0쌍/0건으로
 * 만들었다. 그런데 그 상태를 지키는 것이 <b>문서와 사람의 주의력뿐</b>이었다 — 참조 하나만
 * 거꾸로 추가하면 컴파일도 기존 테스트도 잡지 못한 채 되돌아간다. 이 클래스가 그 자리를 메운다.
 *
 * <p><b>규칙의 정본은 {@code docs/conventions/backend-layering.md} §4</b> 이고, 아래
 * {@link #LAYERS} 가 그것을 코드로 옮긴 것이다. 문서를 고치면 여기도 고쳐야 한다 — 어느 한쪽만
 * 바뀌면 규칙이 문서와 다른 것을 강제하게 된다.
 *
 * <p><b>테스트 소스는 대상이 아니다.</b> 통합 테스트가 여러 도메인을 함께 세우는 것은 정상이므로
 * {@link ImportOption.DoNotIncludeTests} 로 뺀다. 규칙이 지키려는 것은 <b>배포되는 코드</b>의
 * 컴파일 단위가 갈라지는가이다.
 */
class DomainLayerRulesTest {

    /**
     * 도메인의 높이 — 「사실은 아래에, 그 사실에 반응·조립하는 것은 위에」.
     * 참조는 <b>위에서 아래로만</b> 간다(같은 층끼리도 금지).
     */
    private static final Map<String, Integer> LAYERS = new LinkedHashMap<>();

    static {
        // L-1 «아무것도 참조하지 않는다» — 내구 이벤트·명령 기반(GROMO-1659·1660 공통, A21).
        // user(L0)가 「아무도 참조하지 않는」 바닥이라면 outbox 는 「아무것도 참조하지 않는」 바닥이다:
        // 탈퇴·로그아웃처럼 L0 의 트랜잭션도 봉투를 적어야 하므로 user 보다 «아래»여야 하고,
        // 봉투는 도메인 타입을 하나도 모른다(userId 는 UUID, 나머지는 params JSON).
        // LAYER_FREE 로 두지 않은 것은 의도다 — 그러면 outbox → 도메인 참조가 아무 규칙에도
        // 안 걸려, 기반이 조용히 도메인을 끌어오기 시작해도 빌드가 초록으로 남는다.
        LAYERS.put("outbox", -1);
        LAYERS.put("user", 0);              // 계정 — 아무도 참조하지 않는다
        LAYERS.put("currency", 1);          // 유저에게 달린 원장·보유
        LAYERS.put("item", 1);
        LAYERS.put("focus", 2);             // 유저가 만든 기록
        LAYERS.put("screentime", 2);
        LAYERS.put("friend", 3);            // 유저 사이의 관계
        LAYERS.put("stats", 4);             // 기록·관계의 집계
        LAYERS.put("league", 4);
        LAYERS.put("group", 5);             // 모임·챌린지·내기
        LAYERS.put("invitelink", 6);        // 그룹을 가리키는 초대
        LAYERS.put("notification", 7);      // 전 도메인 구독
        LAYERS.put("auth", 8);              // 진입·부가
        LAYERS.put("character", 8);
        LAYERS.put("bot", 8);
        LAYERS.put("analytics", 8);
        LAYERS.put("profile", 9);           // 조립 — 영속성 없음
        LAYERS.put("withdrawal", 9);
        // L10 «가장 위» — 서비스 간 내부 표면(GROMO-1659·1660). 이 패키지는 앱 계약이 아니라
        // Business·알림·링크가 부르는 /internal/* 이고, 그 조합을 위해 auth(8)·group(5)·invitelink(6)·
        // user(0)·outbox(-1) 을 «아래로» 참조한다. 그래서 표의 맨 위여야 한다 — 아무도 이 패키지를
        // 참조하지 않아야 한다는 뜻이기도 하다. 도메인 서비스가 internal 을 부르기 시작하면
        // 그 순간 「내부 표면」이 도메인 로직의 일부가 되어 경계가 사라진다.
        LAYERS.put("internal", 10);
    }

    /**
     * 레이어 밖 — 어느 도메인이 참조해도 된다.
     *
     * <p><b>반대 방향({@code common}·{@code config} → 도메인)은 여기서 검사하지 않는다.</b>
     * 방향 규칙은 소스를 「레이어 표에 있는 도메인」으로 걸러 이 둘을 아예 후보에서 빼고, 순환
     * 규칙은 이 둘을 오가는 간선을 통째로 무시한다. 그래서 {@code common → 도메인} 참조는 어느
     * 규칙에도 걸리지 않는다 — 실제로 {@code common/exception/GlobalExceptionHandler} 가 열 개
     * 도메인의 예외를 직접 알고 있다.
     *
     * <p>그 결합은 실재하지만 「도메인끼리 순환하는가」와는 다른 문제이고, 공통 {@code ErrorCode}
     * 인터페이스로 푸는 일은 GROMO-1657 이 받는다. 그때 이 방향도 규칙으로 세울 수 있다.
     */
    private static final Set<String> LAYER_FREE = Set.of("common", "config");

    private static final String ROOT = "com.oneorthree.phone";

    private static JavaClasses productionClasses;

    @BeforeAll
    static void importProductionClasses() {
        productionClasses = new ClassFileImporter()
                .withImportOption(new ImportOption.DoNotIncludeTests())
                .importPackages(ROOT);
    }

    /**
     * 클래스가 속한 도메인 — {@code com.oneorthree.phone.<domain>...} 의 첫 조각.
     * 최상위({@code com.oneorthree.phone.PhoneApplication})면 {@code null}.
     */
    private static String domainOf(JavaClass javaClass) {
        String name = javaClass.getPackageName();
        if (!name.startsWith(ROOT + ".")) {
            return null;
        }
        String rest = name.substring(ROOT.length() + 1);
        int dot = rest.indexOf('.');
        return dot < 0 ? rest : rest.substring(0, dot);
    }

    @Test
    @DisplayName("모든 도메인 패키지가 레이어 표에 등록돼 있다 — 미등록은 침묵이 아니라 실패다")
    void everyDomainPackageIsRegisteredInTheLayerTable() {
        // 이 단언이 이 클래스에서 가장 중요하다. 새 도메인이 표에 없으면 아래 두 규칙이 그 도메인을
        // 통째로 «검사 대상 아님»으로 넘겨 버려, 규칙이 있는데도 위반이 0으로 보고된다.
        // GROMO-1656 작업 중 실제로 그 일이 있었다 — 측정 스크립트가 새로 만든 profile·withdrawal 을
        // 조용히 건너뛰어 「위반 0」을 두 번 잘못 보고했다.
        JavaPackage root = productionClasses.getPackage(ROOT);
        Set<String> actual = new TreeSet<>();
        for (JavaPackage sub : root.getSubpackages()) {
            actual.add(sub.getRelativeName());
        }

        Set<String> known = new TreeSet<>(LAYERS.keySet());
        known.addAll(LAYER_FREE);

        assertThat(actual)
                .as("새 패키지가 생기면 docs/conventions/backend-layering.md §4 의 레이어 표와 "
                        + "이 클래스의 LAYERS 에 함께 등록해야 한다")
                .isSubsetOf(known);
    }

    @Test
    @DisplayName("참조는 위에서 아래로만 간다 — 같은 층끼리도 금지")
    void referencesOnlyGoDownwards() {
        ArchRule rule = classes()
                .that(new DescribedPredicate<>("도메인에 속한다") {
                    @Override
                    public boolean test(JavaClass javaClass) {
                        return LAYERS.containsKey(domainOf(javaClass));
                    }
                })
                .should(new ArchCondition<>("자기보다 낮은 레이어만 참조한다") {
                    @Override
                    public void check(JavaClass source, ConditionEvents events) {
                        int from = LAYERS.get(domainOf(source));
                        for (JavaClass target : source.getDirectDependenciesFromSelf().stream()
                                .map(d -> d.getTargetClass()).toList()) {
                            String targetDomain = domainOf(target);
                            Integer to = LAYERS.get(targetDomain);
                            if (to == null || to < from || targetDomain.equals(domainOf(source))) {
                                // 레이어 밖(common·config)이거나, 아래쪽이거나, 자기 도메인 안 — 전부 허용.
                                // 자기 도메인 참조를 빼지 않으면 규칙이 «모든 클래스»를 위반으로 센다.
                                continue;
                            }
                            events.add(SimpleConditionEvent.violated(source, String.format(
                                    "%s (L%d %s) → %s (L%d %s)",
                                    source.getName(), from, domainOf(source),
                                    target.getName(), to, targetDomain)));
                        }
                    }
                });

        rule.check(productionClasses);
    }

    @Test
    @DisplayName("도메인 사이에 순환이 없다 — common·config 는 레이어 밖이라 제외한다")
    void domainsAreFreeOfCycles() {
        // common·config 를 오가는 간선은 슬라이스에서 뺀다. 레이어 밖이라 «누가 참조해도 되는» 자리이고,
        // 실제로 common/exception/GlobalExceptionHandler 가 전 도메인의 예외를 알고 있어(핸들러 19개)
        // 넣어 두면 모든 도메인이 common 을 거쳐 서로 순환한 것처럼 잡힌다. 그 결합 자체는 실재하지만
        // 「도메인끼리 순환하는가」와는 다른 문제이고, 공통 ErrorCode 인터페이스로 푸는 일은
        // GROMO-1657(공통 응답·예외 규약 통일)이 받는다.
        //
        // GROMO-1656 의 실측(순환 238 → 0)도 같은 기준이었다 — 그 수와 이 규칙이 같은 것을 세야
        // 「0을 고정한다」는 말이 성립한다.
        DescribedPredicate<JavaClass> layerFree = new DescribedPredicate<>("common·config 에 있다") {
            @Override
            public boolean test(JavaClass javaClass) {
                String domain = domainOf(javaClass);
                // 의존 대상에는 JDK·스프링 클래스도 섞여 온다 — 그쪽은 domain 이 null 이고,
                // Set.of(...) 는 contains(null) 에서 NPE 를 던진다.
                return domain != null && LAYER_FREE.contains(domain);
            }
        };

        // 패턴이 빗나가 슬라이스가 0개가 되면 조용히 통과하지 않는다 — ArchUnit 기본값
        // archRule.failOnEmptyShould=true 가 슬라이스 규칙에도 적용된다. 패턴을 일부러
        // 깨뜨려(com.nonexistent.pkg) 실제로 실패하는 것을 확인했다.
        slices().matching(ROOT + ".(*)..")
                .should().beFreeOfCycles()
                .ignoreDependency(layerFree, DescribedPredicate.alwaysTrue())
                .ignoreDependency(DescribedPredicate.alwaysTrue(), layerFree)
                .check(productionClasses);
    }
}
