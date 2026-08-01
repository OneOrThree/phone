package com.oneorthree.phone.group.dto;

import lombok.Builder;
import lombok.Getter;

import java.util.UUID;

/** 내기 개설 응답 — 앱은 betId 만 받아 참가 호출에 쓴다. */
@Getter
@Builder
public class CreateBetResponse {
    private UUID betId;
}
