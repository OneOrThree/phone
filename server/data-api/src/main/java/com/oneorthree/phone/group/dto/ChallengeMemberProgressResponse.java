package com.oneorthree.phone.group.dto;

import lombok.Builder;
import lombok.Getter;

import java.util.UUID;

/**
 * 챌린지 목록의 멤버별 당일 진행률 한 줄.
 *
 * <p>{@code progressMinutes}/{@code achieved} 를 래퍼 타입으로 둔 것은 "아직 데이터 없음"(null)을
 * 0/false 와 구분하기 위함이다 — SCREEN_TIME 은 통계 행이 없으면 "지키는 중"으로 단정할 수 없다.
 *
 * <p>{@code achieved} 를 {@code boolean} 이 아니라 {@link Boolean} 으로 둬서 getter 가
 * {@code getAchieved()} 가 되므로 JSON 키는 {@code achieved} 하나다. primitive boolean 이었다면
 * is-getter 의 암묵 이름 문제로 {@code isAchieved}/{@code achieved} 이중 직렬화 함정에 걸린다
 * (선례: {@link GroupOverviewResponse#isMember()}).
 */
@Getter
@Builder
public class ChallengeMemberProgressResponse {

    private UUID userId;
    private String nickname;

    /** FOCUS: 당일 집중 분(통계 없으면 0) · SCREEN_TIME: 당일 스크린타임 분(통계 없으면 null). */
    private Integer progressMinutes;

    /** FOCUS: progress >= 목표 · SCREEN_TIME: progress <= 목표. progress 가 null 이면 null(판정 불가). */
    private Boolean achieved;
}
