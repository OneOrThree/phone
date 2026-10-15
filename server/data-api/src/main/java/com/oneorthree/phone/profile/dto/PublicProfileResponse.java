package com.oneorthree.phone.profile.dto;

import com.oneorthree.phone.friend.dto.FriendRelation;
import com.oneorthree.phone.item.dto.CharacterEquipmentResponse;

import java.util.List;
import java.util.UUID;

/**
 * 타 유저 공개 프로필 응답 DTO (GROMO-520).
 * 닉네임·준비 시험·캐릭터·친구수·리그 티어·랭킹·호출자와의 관계를 포함한다.
 * currentTier 는 users.tier_level 에서 도출한다 — GROMO-814.
 * occupation 은 준비 시험 코드(Occupation enum name, 미설정이면 null) — 표시명은 앱이 GET /occupations
 * 마스터(GROMO-631)로 매핑한다 (GROMO-747).
 * relation 은 호출자 기준 친구 관계(검색 응답과 동일한 {@link FriendRelation} 3값 — PENDING 은 방향 무구분, N02),
 * isPinned 는 호출자가 대상을 핀했는지 여부 — 본인 조회 시 둘 다 NONE/false (GROMO-1631).
 */
public record PublicProfileResponse(
        UUID userId,
        String nickname,
        String occupation,
        List<CharacterEquipmentResponse> equipments,
        long friendCount,
        Integer currentTier,
        Integer rank,
        FriendRelation relation,
        boolean isPinned
) {}
