package com.oneorthree.phone.group.dto;

import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.Instant;

/**
 * 미사용 — 초대 링크(groupId) 방식 전환으로 폐기(2026-07-31).
 * 링크가 groupId 를 직접 담으므로 8자 코드·3시간 만료 개념 자체가 사라졌다.
 * 삭제하지 않는 이유: 삭제 마이그레이션·계약 변경·테스트 수정 비용 > 잔존 비용. 실제 제거는 후속 정리 티켓.
 */
@Getter
@NoArgsConstructor
@AllArgsConstructor
public class RenewGroupCodeResponse {
    private String code;
    private Instant codeExpiresAt;
}
