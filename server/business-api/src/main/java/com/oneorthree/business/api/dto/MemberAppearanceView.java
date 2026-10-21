package com.oneorthree.business.api.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.oneorthree.business.upstream.data.dto.PersonalAppearanceState;

/**
 * 남의 고양이 착용 외양의 공개 모양 (GROMO-1937 · GROMO-2389) — 주민 목록·같이 낚시·우체통·친구·퀘스트·도서관·
 * 신청자 목록이 같은 모양을 쓴다. head·neck·shoes 는 미착용이면 키를 싣지 않는다(옛 앱 호환).
 */
public record MemberAppearanceView(
        @JsonProperty(required = true) String clothes,
        @JsonProperty(required = true) String decor,
        @JsonInclude(JsonInclude.Include.NON_NULL) String head,
        @JsonInclude(JsonInclude.Include.NON_NULL) String neck,
        @JsonInclude(JsonInclude.Include.NON_NULL) String shoes,
        @JsonProperty(required = true) String hull,
        @JsonProperty(required = true) String position,
        @JsonProperty(required = true) long version) {

    /** 개인 외양 행의 기본 자리 — Data {@code personal_appearances.position} 의 DEFAULT 와 같다. */
    static final String DEFAULT_POSITION = "front";

    /** 상류 외양을 그대로 옮긴다. 상류가 외양을 못 줬으면(탈퇴 등) null. */
    public static MemberAppearanceView from(PersonalAppearanceState appearance) {
        return appearance == null ? null : new MemberAppearanceView(appearance.clothes(), appearance.decor(),
                appearance.head(), appearance.neck(), appearance.shoes(), appearance.hull(), appearance.position(),
                appearance.version());
    }

    /**
     * 차단 대상의 외양 — 착용 아이템·자리를 기본값으로 가린다. {@code hull} 은 종류가 하나({@code raft})라 사용자
     * 선택이 아니므로 그대로 둔다. {@code version} 도 유지한다 — 앱이 실시간 외양 사건과 순서를 비교하는 단조
     * 값이라 임의로 바꾸면 병합 판정이 어긋난다. 그 대가로 「상대가 외양을 바꿨다」는 활동 신호는 남는다 —
     * 식별 정보가 아니라 의도적으로 허용한다. 실시간 외양 사건 쪽 치환은 이 경로의 범위가 아니다.
     */
    public static MemberAppearanceView neutral(PersonalAppearanceState appearance) {
        return appearance == null ? null : new MemberAppearanceView(null, null, null, null, null, appearance.hull(),
                DEFAULT_POSITION, appearance.version());
    }
}
