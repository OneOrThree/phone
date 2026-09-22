package com.oneorthree.phone.construction.repository.domain;

import java.util.Arrays;
import java.util.Optional;
import java.util.Set;

/**
 * 건설 가능 건물 — 7개(정책 C01, GROMO-1999). 선행 그래프는 <b>선형이 아니다</b>:
 * 회관 → 게시판까지는 고정이고, 게시판 뒤의 축음기·도서관·우체통·전망대는 <b>순서가 자유</b>이며,
 * 상점만 그 넷이 모두 완공된 뒤에 고를 수 있다(기획 정본 「도서관·전망대·우체통·축음기 순서는
 * 자유다. 상점은 다른 모든 건물 공사 완료 후 선택한다」).
 *
 * <p>「한 번에 한 건물만 진행한다」는 선행 그래프가 아니라 {@code IslandConstructionService} 의
 * BUILDING 가드가 지킨다 — 선형이던 때는 선행 조건이 그 일을 겸했지만, 자유 순서에서는
 * 축음기와 도서관을 동시에 착공할 수 있게 되므로 별도 가드가 필요하다.
 *
 * <p>가격·공사 시간은 여기 두지 않는다 — 그 값은 불변 비용 정책 revision
 * ({@code construction_cost_policies})의 데이터이며 코드 상수가 아니다(정책 C02·C10).
 * 모으는 방식(WALLET_TOTAL / RESIDENT_SPLIT)은 구조 정책이라 코드에 둔다 — revision 이
 * 바뀌어도 회관·게시판은 「섬 통장 합산」, 축음기 이후는 「각자 몫 n빵」이다(1829 표).
 */
public enum ConstructionBuilding {

    /** 회관 — 섬 통장 합산. */
    HALL("hall", "회관", Funding.WALLET_TOTAL),
    /** 게시판 — 섬 통장 합산. */
    BOARD("board", "게시판", Funding.WALLET_TOTAL),
    /** 축음기 — 서버 식별자는 방송기 {@code gram}(정책 C14). 각자 몫 n빵. */
    GRAM("gram", "방송기", Funding.RESIDENT_SPLIT),
    /** 도서관 — 기능은 GROMO-1822 미확정이나 건물로는 존재한다(정책 C14). */
    LIBRARY("library", "도서관", Funding.RESIDENT_SPLIT),
    /** 우체통 — 완공되면 편지·우체통 잠금이 풀린다(GROMO-1775 게이트의 판정 대상). */
    MAIL("mail", "우체통", Funding.RESIDENT_SPLIT),
    /** 전망대 — 완공되면 섬 검색·이동 잠금이 풀린다(GROMO-1759 게이트의 판정 대상). */
    TOWER("tower", "전망대", Funding.RESIDENT_SPLIT),
    /** 상점 — 선형 마지막. */
    SHOP("shop", "상점", Funding.RESIDENT_SPLIT);

    /** 모으는 방식 (1829 표 「섬 통장 합산 / 각자 몫 n빵」). */
    public enum Funding {
        /** 섬 물고기가 총액만큼 모이면 건설 — 지갑 잔액으로만 판정한다. */
        WALLET_TOTAL,
        /** 주민마다 총액 ÷ 인원(올림)을 목표 epoch 이후로 채우면 건설 — 주민별 기여로 판정한다. */
        RESIDENT_SPLIT
    }

    private final String id;
    private final String displayName;
    private final Funding funding;

    ConstructionBuilding(String id, String displayName, Funding funding) {
        this.id = id;
        this.displayName = displayName;
        this.funding = funding;
    }

    /** 계약상 시설 식별자 — 요청 buildingId 와 응답 items[].id 가 쓰는 문자열이다. */
    public String id() {
        return id;
    }

    public String displayName() {
        return displayName;
    }

    public Funding funding() {
        return funding;
    }

    /**
     * 선행 건물 전부 — 모두 COMPLETED 여야 이 건물을 고를 수 있다. 회관은 비어 있다.
     *
     * <p>상점만 선행이 넷이다. 전이 선행(게시판·회관)은 넷 각자의 선행이 이미 강제하므로
     * 여기 다시 적지 않는다.
     */
    public Set<ConstructionBuilding> prerequisites() {
        return switch (this) {
            case HALL -> Set.of();
            case BOARD -> Set.of(HALL);
            case GRAM, LIBRARY, MAIL, TOWER -> Set.of(BOARD);
            case SHOP -> Set.of(GRAM, LIBRARY, MAIL, TOWER);
        };
    }

    /** 계약 식별자로 건물을 찾는다 — 없는 ID 는 호출측이 422 OUT_OF_RANGE 로 접는다. */
    public static Optional<ConstructionBuilding> byId(String id) {
        return Arrays.stream(values()).filter(b -> b.id.equals(id)).findFirst();
    }
}
