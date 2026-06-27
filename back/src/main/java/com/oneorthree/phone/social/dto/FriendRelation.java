package com.oneorthree.phone.social.dto;

// 검색 결과에서 나와 해당 유저의 기존 관계 표기 (GROMO-460 §6 검색 응답)
public enum FriendRelation {
    NONE,     // 아무 관계 없음
    PENDING,  // PENDING 요청 존재 (내가 보냈거나 받음)
    FRIEND    // 이미 ACCEPTED 친구
}
