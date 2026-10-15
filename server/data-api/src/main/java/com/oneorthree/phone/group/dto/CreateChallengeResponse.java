package com.oneorthree.phone.group.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.util.List;
import java.util.UUID;

/**
 * 챌린지 생성 응답 — 새 챌린지 id 와, 방장이 곧바로 독려할 미참여자 명단.
 */
@Getter
@Builder
public class CreateChallengeResponse {
    private UUID id;
    private List<NonParticipantDto> nonParticipants;

    /**
     * 스크린타임 권한이 없어 집계에서 빠지는 멤버. SCREEN_TIME 챌린지를 만들 때만 채워지고
     * 그 외에는 빈 리스트이며, 탈퇴 유저는 제외한다 — 독려 대상은 라이브 멤버뿐이다.
     */
    @Getter
    @Builder
    @AllArgsConstructor
    @NoArgsConstructor
    public static class NonParticipantDto {
        private UUID userId;
        private String nickname;
    }
}
