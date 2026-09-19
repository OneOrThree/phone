package com.oneorthree.phone.internal.dto;

import java.util.List;
import java.util.Map;

/**
 * 외양 PATCH 내부 요청 — 공개 PATCH 의 tri-state 를 잃지 않고 넘기는 캐리어다 (LLD §4).
 *
 * <p>{@code fields} 는 제출된 필드명 목록, {@code values} 는 그 필드의 원시 값이다 — 둘은 같은
 * 키 집합을 이뤄야 하고, 명시 {@code null} 은 맵 키로 보존되어 미제출과 구분된다. Business 가
 * 공개 본문에서 복원한 뒤 그대로 전달하고, Data 도 같은 형식 검사를 다시 한다(신뢰 경계).
 * 값 타입은 {@code Object} 로 둔다 — 어느 Jackson 세대로도 같은 형태로 역직렬화된다.
 *
 * <p>{@code expectedVersion} 은 공동 PATCH 전용이다 — 개인 PATCH 는 보내지 않는다.
 */
public record AppearancePatchRequest(
        List<String> fields,
        Map<String, Object> values,
        Long expectedVersion) {
}
