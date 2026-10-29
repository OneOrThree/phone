package com.oneorthree.phone.construction.repository.domain;

import java.util.Set;

/** DB의 건물 종류 한 행. id는 요청과 응답에 쓰이는 변경 불가 계약 문자열이다. */
public record ConstructionBuilding(String id, String displayName, Funding funding,
                                   Set<String> prerequisites) {

    public ConstructionBuilding {
        prerequisites = Set.copyOf(prerequisites);
    }

    /** 건설비를 모으는 방식. */
    public enum Funding {
        WALLET_TOTAL,
        RESIDENT_SPLIT
    }
}
