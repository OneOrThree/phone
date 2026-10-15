package com.oneorthree.phone.group.dto;

import lombok.Builder;
import lombok.Getter;

import java.util.UUID;

/** 진행 중 내기의 참가자 한 줄 — 카드에 얼굴/닉네임만 나열한다. */
@Getter
@Builder
public class GroupBetParticipantResponse {

    /**
     * 참가자 사용자 id. 탈퇴자 행은 null 이다(계정 LLD §4 — 과거 회차 명단이 탈퇴자 UUID 를 다른 그룹원에게
     * 계속 잇지 않게). 목록 key·행 구분에는 {@link #participantId} 를 쓴다.
     */
    private UUID userId;

    /** 회차별 참가 행 id — 탈퇴자 행도 항상 채워지는 목록 key. 회차를 넘어 같은 사람을 잇지 않는다. */
    private UUID participantId;

    private String nickname;
}
