package com.oneorthree.phone.group.dto;

import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.LocalDate;

/**
 * 내기 개설 요청(레거시 브리지 — 2계층 재편 후 "설정 보장 + 그 날짜 회차 개설 + 참가"로 해석된다).
 *
 * <p>{@code stake} 는 1~3000 범위만 받는다(N30, GROMO-1264) — 범위 검증은 서비스에서 하고
 * ({@code BET_INVALID_STAKE}), 여기서는 누락만 막는다. 프리셋(300/900/1,500/3,000)은 앱 몫이다.
 * {@code date} 는 KST 오늘 또는 내일이어야 한다(내일은 창 마감 뒤의 "내일 시간대부터 적용" 경로
 * — GROMO-1103).
 */
@Getter
@NoArgsConstructor
public class CreateBetRequest {

    @NotNull
    private Integer stake;

    @NotNull
    private LocalDate date;
}
