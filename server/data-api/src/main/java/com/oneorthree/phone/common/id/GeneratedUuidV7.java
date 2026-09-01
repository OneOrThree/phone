package com.oneorthree.phone.common.id;

import org.hibernate.annotations.IdGeneratorType;
import org.hibernate.annotations.ValueGenerationType;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * 엔티티 PK 를 UUIDv7 로 채우는 표식 — {@code @Id} 필드에 붙이면 INSERT 직전에 값이 생성된다.
 *
 * <p>UUIDv4 가 아니라 v7 인 이유는 <b>앞부분이 생성 시각</b>이라 값이 시간순으로 증가하기 때문이다.
 * 랜덤 UUID 를 PK 로 쓰면 B-tree 인덱스에 삽입 지점이 매번 흩어져 페이지 분할과 캐시 미스가 늘어난다.
 * v7 은 append 에 가까워 그 비용을 피하면서도 UUID 의 전역 유일성과 "id 로 총량을 못 세는" 성질을 유지한다.
 *
 * <p>클라이언트가 채워 보낼 수 있는 값이 아니다 — 생성은 항상 서버 INSERT 시점에 일어난다.
 */
@IdGeneratorType(UuidV7Generator.class)
@ValueGenerationType(generatedBy = UuidV7Generator.class)
@Retention(RetentionPolicy.RUNTIME)
@Target({ElementType.FIELD, ElementType.METHOD})
public @interface GeneratedUuidV7 {
}
