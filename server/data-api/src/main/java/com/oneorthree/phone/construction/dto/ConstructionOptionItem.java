package com.oneorthree.phone.construction.dto;

/**
 * 건설 옵션 한 항목 (LLD §2) — {@code blockedReason} 만 nullable 이고 나머지는 전부 필수다.
 * {@code blockedReason} 은 HTTP 오류 code 가 아니라 UI 사유다
 * (FORBIDDEN → FACILITY_LOCKED → IN_PROGRESS·OTHER_IN_PROGRESS → INSUFFICIENT_FUNDS 우선순위, 통과하면 null).
 * 공사 중인 그 건물은 IN_PROGRESS, 그동안 다른 미완공 건물은 OTHER_IN_PROGRESS 다(GROMO-2854).
 */
public record ConstructionOptionItem(
        String id,
        String name,
        int cost,
        String currency,
        boolean selectable,
        boolean buildable,
        String blockedReason) {
}
