package com.oneorthree.phone.internal.dto;

import java.util.UUID;

/**
 * 내부 응답에는 자격·이벤트 자료를 노출하지 않는다. sessionId 는 business 가 폐기 sid 거부목록을 채우는 용도다.
 */
public record SessionLogoutResponse(boolean revoked, UUID sessionId) {
}
