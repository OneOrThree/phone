package com.oneorthree.phone.internal.dto;

import java.util.UUID;

/**
 * 방문자에게도 보이는 섬 공개 요약 (GROMO-1759, 섬 소속 LLD §2 {@code PublicIslandSummary}).
 *
 * <p>이 record 는 <b>허용 필드만 조립하는 whitelist</b> 다(PRD M04). 주민 상세를 만든 뒤 민감 필드를
 * 지우는 방식을 쓰지 않는다 — 그 방식은 새 필드가 생길 때마다 기본값이 «노출» 이라 조용히 샌다.
 *
 * <p>{@code intro} 는 {@code Group.description} 의 공개 projection 이다. 기존 행의 null 을
 * {@code ""} 로 매핑할 뿐 DB 값을 바꾸지 않는다(LLD §2).
 *
 * <p><b>{@code growthStage}·{@code themeId} 는 아직 항상 null 이다.</b> 이 두 값의 정본은 건설·외양
 * 도메인이 소유하는데(HLD §1 소유 표) data-api 에 그 도메인이 <b>존재하지 않는다</b> — 시설·성장·테마
 * 테이블도 엔티티도 없다(2026-09-17 실측). LLD §2 가 "필요한 설정/자산 projection 이 없으면 예시
 * 숫자로 대체하지 않고 해당 기능 준비 상태를 드러낸다"고 못 박았으므로 임의의 기본 단계/테마를
 * 지어내지 않는다. island-construction 이 합류하면 그때 실제 projection 을 채운다.
 *
 * @param maxMembers 섬 정원(1~15, GROMO-1993). <b>방문자에게도 준다</b> — 2026-09-19 결정 V-읽기가
 *     「마을회관 섬 정보 등록증(이름·소개·주민 수/정원)」을 방문자 열람 범위로 확정했다. 주민 수만 주고
 *     정원을 빼면 화면이 「3명」만 알고 「3/15」를 못 그린다. 고치는 것은 여전히 방장뿐이다
 * @param membershipStatus {@code none|pending|active} — 본인 기준 값이다. {@code pending} 은
 *     그 섬에 대한 본인의 열린 가입 요청이 있다는 뜻이다 (GROMO-1760)
 * @param joinRequestId 본인의 최신 가입 요청 식별자 — 요청을 한 번도 한 적 없으면 null (LLD §2)
 */
public record IslandSummaryView(
        UUID id,
        String name,
        String intro,
        String visibility,
        boolean approvalRequired,
        int memberCount,
        int maxMembers,
        String membershipStatus,
        String growthStage,
        String themeId,
        UUID joinRequestId) {
}
