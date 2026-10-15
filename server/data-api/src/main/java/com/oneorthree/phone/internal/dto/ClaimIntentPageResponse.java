package com.oneorthree.phone.internal.dto;

import java.util.List;

/**
 * 재개 대상 목록 한 페이지 (A22 ㊄).
 *
 * <h2>커서를 믿고 「한 번 훑으면 끝」이라고 보면 안 된다</h2>
 * 이 커서는 PK(UUID v7) 순서다. UUID v7 은 <b>생성 순서</b>는 지키지만 <b>커밋 순서</b>는 지키지
 * 않는다 — 먼저 id 를 받은 트랜잭션이 늦게 커밋하면, 이미 그 지점을 지나친 커서는 그 행을 영영
 * 건너뛴다. 그래서 재개 실행자는 <b>매번 처음부터</b> 미완료를 다시 훑어야 하고, 커서는 한 번의
 * 훑기 안에서 페이지를 이어 붙이는 용도로만 쓴다.
 *
 * @param items       이 페이지의 항목들
 * @param nextCursor  다음 페이지 커서. {@code null} 이면 이번 훑기는 끝이다
 * @param pendingTotal 미완료 «전체» 수 — 인플라이트(리스 보유)와 백오프 대기분까지 포함한다.
 *                    이 값이 0 이 되어야 「남은 것이 없다」고 말할 수 있다
 */
public record ClaimIntentPageResponse(
        List<ClaimIntentItemResponse> items, String nextCursor, long pendingTotal) {
}
