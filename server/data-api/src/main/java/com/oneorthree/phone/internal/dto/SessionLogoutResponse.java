package com.oneorthree.phone.internal.dto;

/** 내부 응답에는 자격·세션·이벤트 자료를 노출하지 않는다. */
public record SessionLogoutResponse(boolean revoked) {
}
