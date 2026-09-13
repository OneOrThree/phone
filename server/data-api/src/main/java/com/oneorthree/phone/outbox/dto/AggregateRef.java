package com.oneorthree.phone.outbox.dto;

import java.util.UUID;

/**
 * 순서 축 — {@code version} 을 발급한 aggregate 이자 relay 가 전달 순서를 지키는 단위.
 *
 * <p><b>둘이 같은 값이어야 한다.</b> version 발급 축과 전달 순서 축이 다르면 「선행 미전달을 건너뛰지
 * 않는다」가 성립하지 않는다 — 잠금이 직렬화한 것은 발급 축의 커밋 순서뿐이라, 다른 축으로 정렬하면
 * 늦게 커밋된 낮은 번호가 이미 전달된 높은 번호 뒤에 도착한다.
 *
 * <p>유저 축은 {@link #ofUser(UUID)}, 링크 멤버십 전이는 {@link #ofLinkMembership(UUID, UUID)} 다.
 * 후자가 따로 있는 이유는 ㋥ 에 있다 — confirm/revoke 의 순서는 {@code (groupId, inviterId)} 축인데
 * claim 사용자와 발급자는 서로 다른 유저라 유저 축으로는 표현할 수 없다.
 *
 * @param type 축의 종류
 * @param id   축의 식별자 — 같은 {@code type} 안에서 유일해야 한다
 */
public record AggregateRef(String type, String id) {

    /** 유저 단위 순서 축 — 기본값이다. */
    public static final String TYPE_USER = "USER";

    /** 링크 멤버십 전이 축 — 발급·폐기·확정의 순서가 유저가 아니라 {@code (groupId, inviterId)} 다. */
    public static final String TYPE_LINK_MEMBERSHIP = "LINK_MEMBERSHIP";

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

    /**
     * @param groupId   그룹
     * @param inviterId 발급자
     * @return 링크 멤버십 전이 축 참조 — {@code "<groupId>:<inviterId>"}
     */
    public static AggregateRef ofLinkMembership(UUID groupId, UUID inviterId) {
        return new AggregateRef(TYPE_LINK_MEMBERSHIP, groupId + ":" + inviterId);
    }
}
