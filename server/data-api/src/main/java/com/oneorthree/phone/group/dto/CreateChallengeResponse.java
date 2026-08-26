package com.oneorthree.phone.group.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.util.List;
import java.util.UUID;

@Getter
@Builder
public class CreateChallengeResponse {
    private UUID id;
    private List<NonParticipantDto> nonParticipants;

    @Getter
    @Builder
    @AllArgsConstructor
    @NoArgsConstructor
    public static class NonParticipantDto {
        private UUID userId;
        private String nickname;
    }
}
