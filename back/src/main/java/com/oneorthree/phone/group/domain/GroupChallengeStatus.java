package com.oneorthree.phone.group.domain;

/**
 * 챌린지 생명주기 상태.
 *
 * <p><b>{@code INACTIVE} = 종료(정책 §A8 의 {@code ENDED})다.</b> 정책 문서 표기는 {@code ENDED} 지만
 * DB CHECK 도메인이 V2 이래 {@code ACTIVE/INACTIVE} 이고 앱이 이 문자열로 분기한다 — 이름을 바꾸려면
 * 데이터 이관·CHECK 교체·앱 계약 파기가 동시에 필요하므로 <b>의미만 확정</b>하고 이름은 유지한다
 * (GROMO-1261). 전이는 {@link GroupChallenge#end()} 한 곳에서만 일어난다.
 */
public enum GroupChallengeStatus {
    /** 진행 중 — 판정·알림·회차가 돈다. */
    ACTIVE,
    /** 종료됨(= ENDED) — 카드에서 내려가고 판정·알림·회차가 멈춘다. 이력은 남는다. */
    INACTIVE
}
