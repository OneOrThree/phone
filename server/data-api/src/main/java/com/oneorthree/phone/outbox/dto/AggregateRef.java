package com.oneorthree.phone.outbox.dto;

import java.util.UUID;

/**
 * 순서 축 — {@code version} 을 발급한 aggregate 이자 relay 가 전달 순서를 지키는 단위.
 *
 * <p><b>둘이 같은 값이어야 한다.</b> version 발급 축과 전달 순서 축이 다르면 「선행 미전달을 건너뛰지
 * 않는다」가 성립하지 않는다 — 잠금이 직렬화한 것은 발급 축의 커밋 순서뿐이라, 다른 축으로 정렬하면
 * 늦게 커밋된 낮은 번호가 이미 전달된 높은 번호 뒤에 도착한다.
 *
 * <p>유저 축은 {@link #ofUser(UUID)}로 표현한다. 다른 도메인의 순서는 해당 도메인의
 * aggregate 종류와 식별자로 구분한다.
 *
 * @param type 축의 종류
 * @param id   축의 식별자 — 같은 {@code type} 안에서 유일해야 한다
 */
public record AggregateRef(String type, String id) {

    /** 유저 단위 순서 축 — 기본값이다. */
    public static final String TYPE_USER = "USER";


    public AggregateRef {
        if (type == null || type.isBlank()) {
            throw new IllegalArgumentException("aggregate type 은 비어 있을 수 없습니다.");
        }
        if (id == null || id.isBlank()) {
            throw new IllegalArgumentException("aggregate id 는 비어 있을 수 없습니다.");
        }
    }

    /**
     * @param userId 순서를 지킬 유저
     * @return 유저 축 참조
     */
    public static AggregateRef ofUser(UUID userId) {
        return new AggregateRef(TYPE_USER, userId.toString());
    }

}
