package com.oneorthree.phone.group.dto;

import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.LocalDate;

/**
 * 내기 개설 요청.
 *
 * <p>{@code stake} 는 1~1000 범위만 받는다 — 범위 검증은 서비스에서 하고
 * ({@code BET_INVALID_STAKE}), 여기서는 누락만 막는다. {@code date} 는 KST 오늘 또는 내일이어야
 * 한다(내일은 창 마감 뒤의 "내일 시간대부터 적용" 경로 — GROMO-1103).
 */
@Getter
@NoArgsConstructor
public class CreateBetRequest {

    @NotNull
    private Integer stake;

    @NotNull
    private LocalDate date;
}
