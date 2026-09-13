package com.oneorthree.phone.internal.dto;

import java.time.Instant;
import java.util.UUID;

/**
 * 재개 대상 claim 의도 한 건 (A22 ㊄).
 *
 * <p><b>{@code idempotencyKey} 를 함께 준다</b> — 재개 실행자가 <b>같은 키로</b> 링크 잠정 기록과 Data
 * 확정을 재생해야 한다(㉼). 새 키로 밟으면 재개가 별개 명령이 되어 이미 확정된 귀속을 한 번 더 집계한다.
 *
 * @param commandId      의도 식별자 — lease·완료 표시가 이 값으로 온다
 * @param userId         claim 주체
 * @param slug           초대 링크
 * @param idempotencyKey 재생에 쓸 멱등 키
 * @param attempts       지금까지 선점된 횟수 — 고갈 관측용이다(폐기는 A18 보류라 하지 않는다)
 * @param leaseExpiresAt 현재 리스 만료. 비어 있으면 아무도 잡고 있지 않다
 */
public record ClaimIntentItemResponse(
        UUID commandId,
        UUID userId,
        String slug,
        String idempotencyKey,
        int attempts,
        Instant leaseExpiresAt) {
}
