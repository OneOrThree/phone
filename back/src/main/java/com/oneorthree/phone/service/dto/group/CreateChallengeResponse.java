package com.oneorthree.phone.service.dto.group;

import lombok.Builder;
import lombok.Getter;

import java.util.List;

@Getter
@Builder
public class CreateChallengeResponse {
    // TODO GROMO-290: Long id — 생성된 챌린지 ID
    Long id;
    // TODO GROMO-357: List<NonParticipantDto> nonParticipants — SCREEN_TIME일 때 권한 없는 그룹원 목록, FOCUS면 빈 리스트
    // TODO GROMO-357: static inner class NonParticipantDto { Long userId; String nickname; } — @Getter @Builder
}
