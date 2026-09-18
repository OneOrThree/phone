package com.oneorthree.phone.internal.dto;

/**
 * {@code GET /internal/islands/{islandId}} 응답 (GROMO-1759).
 *
 * <p>같은 200 이 두 모양 중 하나다(LLD §3.4) — 활성 주민이면 {@code member}, 비소속이면
 * {@code visitor}. 둘을 한 record 의 nullable 두 칸으로 «판별 가능하게» 내려보낸다. 한 모양으로
 * 합쳐 필드를 null 로 비우면 Business 가 "값이 null 인 주민 응답"과 "방문자 응답"을 구분할 수 없고,
 * 그 구분이 곧 권한 경계라 흐려 두면 안 된다.
 *
 * <p>둘 중 하나는 «항상» 채워진다 — 빈 본문을 만들지 않는다. Business 의 {@code InternalHttpClient}
 * 는 응답 DTO 를 요구한 호출의 빈 본문을 계약 불일치(502)로 올린다.
 *
 * @param scope {@code member} 또는 {@code visitor}
 */
public record IslandViewResponse(String scope, IslandSummaryView visitor, IslandDetailView member) {

    /** 활성 주민 응답. */
    public static IslandViewResponse ofMember(IslandDetailView detail) {
        return new IslandViewResponse("member", null, detail);
    }

    /** 비소속 방문자 응답. */
    public static IslandViewResponse ofVisitor(IslandSummaryView summary) {
        return new IslandViewResponse("visitor", summary, null);
    }
}
