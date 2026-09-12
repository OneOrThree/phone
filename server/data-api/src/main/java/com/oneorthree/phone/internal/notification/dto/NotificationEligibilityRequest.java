package com.oneorthree.phone.internal.notification.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/**
 * 발송 직전 <b>상태 재확인</b> 요청 (조회 3종의 세 번째 · A22 ⓩ · ㊩).
 *
 * <p>투영으로 대체되지 않는 질문이다. 지연 소비자는 첫 레코드를 처리하는 시점에 투영이 아직 옛
 * 상태라, 이미 삭제된 챌린지의 개설 알림이나 이미 수락된 친구 요청 알림을 그대로 낸다.
 *
 * @param userId    수신자
 * @param kind      알림 종류. <b>모르는 이름이면 거절한다</b>(fail-closed) — 「모르면 일단 보낸다」는
 *                  새 kind 가 붙을 때마다 조용히 재확인을 건너뛴다
 * @param subjectId 사건 대상 id. 대상이 없는 kind 는 {@code null}
 * @param params    kind 별 추가 판정 입력(예: 친구 요청의 {@code requestId}). 없으면 빈 맵
 */
public record NotificationEligibilityRequest(
        @NotNull UUID userId,
        @NotBlank String kind,
        UUID subjectId,
        Map<String, Object> params) {

    public NotificationEligibilityRequest {
        // 정산 결과의 voidReason 등 nullable 사건 필드는 봉투와 동일하게 보존한다.
        params = params == null ? Map.of() : Collections.unmodifiableMap(new LinkedHashMap<>(params));
    }
}
