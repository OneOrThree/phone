package com.oneorthree.phone.group.dto;

import lombok.Builder;
import lombok.Getter;

import java.util.UUID;

/** 진행 중 내기의 참가자 한 줄 — 카드에 얼굴/닉네임만 나열한다. */
@Getter
@Builder
public class GroupBetParticipantResponse {
    private UUID userId;
    private String nickname;
}
