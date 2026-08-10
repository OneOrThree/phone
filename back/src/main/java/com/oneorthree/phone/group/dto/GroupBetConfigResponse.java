package com.oneorthree.phone.group.dto;

import lombok.Builder;
import lombok.Getter;

/**
 * 챌린지 카드 최상위의 <b>내기 설정</b>({@code betConfig}) — 신앱 additive(GROMO-1418).
 * "이 챌린지에 내기가 걸려 있고 참가비는 얼마인가"만 말하며, <b>회차 유무와 무관</b>하다.
 *
 * <p>{@code bet}(오늘 열린 판 — 구앱 계약상 {@code betId} 가 유효해야 한다)과 <b>축이 다르다</b>:
 * 회차가 없는 날 {@code bet} 은 종전대로 null 이고(구앱은 그때 「내기 걸기」로 레거시 createBet
 * 브리지를 탄다), 신앱은 이 필드로 "설정은 켜져 있고 오늘 회차만 없다"를 읽는다. 두 요구를 한
 * 객체에 겹쳐 담으면 어느 한쪽이 반드시 깨진다.
 *
 * <p>null(필드 부재·값 없음) = 내기 진입점 없음 — 설정이 없거나, 꺼졌거나, 끝난·삭제된 챌린지다.
 */
@Getter
@Builder
public class GroupBetConfigResponse {

    /** 내기 켜짐 — 생성 시 1회 결정·불변(N26, 끄기 경로 없음 · GROMO-1426). */
    private Boolean enabled;

    /** 1인 참가비(설정값). 회차는 개설 시점에 이 값을 박제한다(GROMO-1263). */
    private int stake;
}
