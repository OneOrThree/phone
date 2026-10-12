package com.oneorthree.phone.letter.repository.domain;

/**
 * 편지 종류 (GROMO-2260, V107 {@code letters.kind}). {@code FRIEND} 만 사람이 보내고, 나머지는 시스템
 * 편지라 발신자가 없다({@code sender_id IS NULL}).
 */
public enum LetterKind {
    /** 친구 1:1 편지 (GROMO-1933). */
    FRIEND,
    /** 섬에서 강퇴됐다는 안내. */
    KICK,
    /** 가입 신청이 승인됐다는 안내 — 항해 시간 문구가 함께 실린다. */
    JOIN_APPROVED
}
