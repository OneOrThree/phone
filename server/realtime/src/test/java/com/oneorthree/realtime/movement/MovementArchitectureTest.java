package com.oneorthree.realtime.movement;

import com.tngtech.archunit.core.domain.JavaClasses;
import com.tngtech.archunit.core.importer.ClassFileImporter;
import com.tngtech.archunit.core.importer.ImportOption;
import com.tngtech.archunit.lang.ArchRule;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;

/**
 * movement 코어(= {@code ..movement..} 에서 아직 없는 {@code ..movement.stomp..} 를 뺀 나머지)가 네트워크·
 * Fishcat 도메인을 모른다는 것을 빌드 실패로 고정한다(티켓 2246 완료 조건 1, 계약 §4).
 *
 * <p>{@code DomainLayerRulesTest}(data-api) 와 같은 방식 — {@code @Test} + {@code ClassFileImporter} 로
 * 쓰고 archunit-junit5 러너는 쓰지 않는다. 테스트 소스는 대상이 아니다({@link ImportOption.DoNotIncludeTests}).
 */
class MovementArchitectureTest {

    private static final String ROOT = "com.oneorthree.realtime";
    private static final String MOVEMENT_CORE = ROOT + ".movement..";
    private static final String STOMP_BOUNDARY = ROOT + ".movement.stomp..";

    private static JavaClasses classes;

    @BeforeAll
    static void importClasses() {
        classes = new ClassFileImporter()
                .withImportOption(new ImportOption.DoNotIncludeTests())
                .importPackages(ROOT);
    }

    @Test
    @DisplayName("movement 코어는 realtime 의 Fishcat 도메인 패키지를 참조하지 않는다")
    void movementCoreDoesNotDependOnFishcatDomains() {
        ArchRule rule = noClasses()
                .that().resideInAPackage(MOVEMENT_CORE)
                .and().resideOutsideOfPackage(STOMP_BOUNDARY)
                .should().dependOnClassesThat().resideInAnyPackage(
                        ROOT + ".focus..", ROOT + ".message..", ROOT + ".event..",
                        ROOT + ".presence..", ROOT + ".membership..", ROOT + ".block..",
                        ROOT + ".fanout..");

        rule.check(classes);
    }

    @Test
    @DisplayName("movement 코어는 Spring Messaging·Web·JPA 를 쓰지 않는다 — Ticker 빈 배선(stereotype·PreDestroy)만 예외")
    void movementCoreDoesNotDependOnMessagingWebOrPersistence() {
        ArchRule rule = noClasses()
                .that().resideInAPackage(MOVEMENT_CORE)
                .and().resideOutsideOfPackage(STOMP_BOUNDARY)
                .should().dependOnClassesThat().resideInAnyPackage(
                        "jakarta.persistence..", "org.springframework.messaging..", "org.springframework.web..");

        rule.check(classes);
    }
}
