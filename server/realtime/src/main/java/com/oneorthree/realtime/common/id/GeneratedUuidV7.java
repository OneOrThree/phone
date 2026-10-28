package com.oneorthree.realtime.common.id;

import org.hibernate.annotations.IdGeneratorType;
import org.hibernate.annotations.ValueGenerationType;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * {@code @Id UUID id} 필드에 붙여 {@link UuidV7Generator} 를 물리는 애노테이션.
 *
 * <p>{@code @GeneratedValue} 를 쓰지 않는 이유는 Hibernate 기본 UUID 전략이 v4 이기 때문이다 —
 * 커서 페이징이 id 의 시간 단조성에 기대므로 v4 로 떨어지면 조용히 깨진다.
 */
@IdGeneratorType(UuidV7Generator.class)
@ValueGenerationType(generatedBy = UuidV7Generator.class)
@Retention(RetentionPolicy.RUNTIME)
@Target({ElementType.FIELD, ElementType.METHOD})
public @interface GeneratedUuidV7 {
}
