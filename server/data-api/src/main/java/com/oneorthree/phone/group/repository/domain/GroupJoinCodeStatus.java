package com.oneorthree.phone.group.repository.domain;

/**
 * 미사용 — 초대 링크(groupId) 방식 전환으로 폐기(2026-07-31).
 * 링크가 groupId 를 직접 담으므로 8자 코드·3시간 만료 개념 자체가 사라졌다.
 * 삭제하지 않는 이유: 삭제 마이그레이션·계약 변경·테스트 수정 비용 &gt; 잔존 비용. 실제 제거는 후속 정리 티켓.
 */
public enum GroupJoinCodeStatus {
    /** 코드로 참여 가능 — 발급·재발급 시의 상태. 만료 시각(expires_at)은 별도 컬럼이 든다. */
    ACTIVE,
    /** 코드 사용 종료 — 재발급 전까지 이 코드로는 참여할 수 없다. */
    ENDED
}
