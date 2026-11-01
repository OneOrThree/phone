package com.oneorthree.phone.architecture;

import com.tngtech.archunit.core.domain.JavaClasses;
import com.tngtech.archunit.core.domain.JavaField;
import com.tngtech.archunit.core.importer.ClassFileImporter;
import com.tngtech.archunit.core.importer.ImportOption;
import com.tngtech.archunit.lang.ArchCondition;
import com.tngtech.archunit.lang.ConditionEvents;
import com.tngtech.archunit.lang.SimpleConditionEvent;
import jakarta.persistence.Column;
import org.hibernate.annotations.CreationTimestamp;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.fields;

/**
 * {@code @CreationTimestamp} 필드는 {@code @Column(updatable = false)} 여야 한다 (GROMO-2674).
 *
 * <p>없으면 한 트랜잭션에서 생성 뒤 수정해 flush 가 두 번 일어날 때 Hibernate 가 HHH000502 를 찍고
 * 아무것도 바꾸지 않는 UPDATE 를 한 번 더 보낸다(GROMO-2632 의 UserIslandContext 와 같은 증상).
 * 실제 배포 클래스({@code com.oneorthree.phone..})를 읽으므로 새 엔티티도 자동으로 검사된다.
 */
class CreationTimestampImmutableRuleTest {

    @Test
    @DisplayName("@CreationTimestamp 필드는 @Column(updatable = false) 이다")
    void creationTimestampFieldsAreNotUpdatable() {
        JavaClasses classes = new ClassFileImporter()
                .withImportOption(new ImportOption.DoNotIncludeTests())
                .importPackages("com.oneorthree.phone");

        fields().that().areAnnotatedWith(CreationTimestamp.class)
                .should(new ArchCondition<>("@Column(updatable = false) 를 단다") {
                    @Override
                    public void check(JavaField field, ConditionEvents events) {
                        boolean ok = field.tryGetAnnotationOfType(Column.class)
                                .map(c -> !c.updatable()).orElse(false);
                        if (!ok) {
                            events.add(SimpleConditionEvent.violated(field,
                                    field.getFullName() + " — @Column(updatable = false) 가 없다"));
                        }
                    }
                })
                .check(classes);
    }
}
