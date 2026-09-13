package com.oneorthree.phone.internal.dto;

/** 이 조회 snapshot의 멤버십 판정뿐이다. 재사용·캐시·다른 이벤트 수신권 추론을 허용하지 않는다. */
public record RealtimeMembershipAuthorizationResponse(boolean allowed) {
}
