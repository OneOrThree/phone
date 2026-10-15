package com.oneorthree.phone.group.repository.domain;

/**
 * 그룹 내 역할 — 그룹당 {@link #OWNER} 는 한 명이다(위임은 승격·강등을 같은 트랜잭션에서 함께 돌린다).
 * 탈퇴 후 재참여({@code GroupMember.rejoin})는 역할을 {@link #MEMBER} 로 되돌린다.
 */
public enum GroupMemberRole {
    /** 방장 — 설정·강퇴·챌린지 개설·공지를 권한 컬럼과 무관하게 항상 할 수 있다. */
    OWNER,
    /** 일반 멤버 — 참여 시 기본값. 공지 등 개별 권한은 멤버 단위 컬럼이 따로 연다. */
    MEMBER
}
