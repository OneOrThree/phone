package com.oneorthree.business.upstream.data.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonSetter;
import com.fasterxml.jackson.annotation.Nulls;

import java.util.List;
import java.util.UUID;

/**
 * 미완료 claim 의도 한 페이지 — 재개 CLI 의 입력이다(서비스 전용 조회).
 *
 * <p><b>커서는 시각이 아니라 commit 과 함께 증가하는 sequence 여야 한다</b>(A22 ㋖). 상태 변경 시각은
 * 커밋 순서를 보장하지 않아, T1 이 이른 시각을 쓰고 멈춘 사이 T2 가 늦은 시각으로 커밋돼 커서가
 * 전진하면 <b>뒤늦게 커밋된 T1 을 다음 증분이 영구히 건너뛴다</b>.
 *
 * <h2>빈 페이지를 「전부 완료」로 읽으면 안 된다</h2>
 * 이 페이지에 안 담기는 미완료가 있다 — 다른 작업자가 lease 를 쥔 행, 재시도 예정인 행, 커서가 지난
 * 뒤 새로 적재된 행. 그래서 gate 판정은 <b>{@code pendingTotal}</b>(전체 미완료, 인플라이트 포함)로
 * 한다. 「빈 페이지 = 끝」으로 접으면 <b>미완료를 남긴 채 절차가 다음 단계로 넘어간다</b>.
 *
 * @param items        이 페이지의 의도들 — <b>지금 집을 수 있는</b> 것만 담긴다
 * @param nextCursor   다음 페이지 커서. null 이면 이번 순회의 끝이다(전체 완료가 아니다)
 * @param pendingTotal 전체 미완료 건수. <b>다른 작업자가 lease 를 쥔 행과 재시도 예정 행을 포함</b>한다.
 *                     이 값이 0 일 때만 「미완료 0」 gate 를 통과한다
 */
public record ClaimIntentPage(
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) List<ClaimIntent> items,
        String nextCursor,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) long pendingTotal) {

    /**
     * 재개해야 할 claim 하나.
     *
     * @param commandId      내구 명령 id — lease·완료 표시의 대상
     * @param userId         claim 주체
     * @param slug           초대 링크
     * @param idempotencyKey <b>원래 요청이 쓴 키</b>. CLI 가 새 키를 만들면 링크 서버의 멱등 저장이
     *                       이 claim 을 «새 명령»으로 보아 중복 기록한다 — Data 가 이 값을 저장해
     *                       돌려주는 것이 재생의 전제다(A22 ㉼)
     * @param attempts       지금까지의 시도 횟수 — 반복 실패를 관측하고 gate 판단에 쓴다
     */
    public record ClaimIntent(UUID commandId, UUID userId, String slug, String idempotencyKey, int attempts) {
    }
}
