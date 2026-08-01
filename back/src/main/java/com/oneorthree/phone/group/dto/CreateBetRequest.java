package com.oneorthree.phone.group.dto;

import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.LocalDate;

/**
 * 내기 개설 요청.
 *
 * <p>{@code stake} 는 서버 허용값(10/30/50/100)만 받는다 — 값 검증은 서비스에서 하고
 * ({@code BET_INVALID_STAKE}), 여기서는 누락만 막는다. {@code date} 는 KST 오늘이어야 한다.
 */
@Getter
@NoArgsConstructor
public class CreateBetRequest {

    @NotNull
    private Integer stake;

    @NotNull
    private LocalDate date;
}
