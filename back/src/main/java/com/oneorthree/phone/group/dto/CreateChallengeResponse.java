package com.oneorthree.phone.group.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.util.List;

@Getter
@Builder
public class CreateChallengeResponse {
    private Long id;
    private List<NonParticipantDto> nonParticipants;

    @Getter
    @Builder
    @AllArgsConstructor
    @NoArgsConstructor
    public static class NonParticipantDto {
        private Long userId;
        private String nickname;
    }
}
