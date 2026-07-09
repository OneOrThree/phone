package com.oneorthree.phone.user.dto;

import com.oneorthree.phone.item.dto.CharacterEquipmentResponse;

import java.util.List;
import java.util.UUID;

/**
 * 타 유저 공개 프로필 응답 DTO (GROMO-520).
 * 닉네임·캐릭터·친구수·리그 티어·랭킹을 포함한다.
 * currentTier 는 league_arena_users.tier_level 에서 도출(리그 미소속이면 null) — GROMO-671.
 */
public record PublicProfileResponse(
        UUID userId,
        String nickname,
        List<CharacterEquipmentResponse> equipments,
        long friendCount,
        Integer currentTier,
        Integer rank
) {}
