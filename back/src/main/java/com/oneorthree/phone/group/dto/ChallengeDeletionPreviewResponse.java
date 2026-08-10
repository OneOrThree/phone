package com.oneorthree.phone.group.dto;

import java.time.LocalDate;
import java.util.List;

/**
 * 챌린지 삭제 프리플라이트 — {@code GET .../deletion-preview} (GROMO-1416, N49 · K11 해소).
 *
 * <p>삭제 경고 시트가 이 수치로 "사라지는 날짜·참여 인원·돌아가는 적립금"을 그린다(FR-12-1).
 * 카드의 {@code bet.session} 은 오늘 회차 1건뿐이라 {@code join-week} 로 예약된 미래 회차가
 * 빠진다 — 그 상태로 경고를 그리면 그룹장이 뒤에 걸린 남의 돈을 못 본 채 삭제를 확정한다.
 *
 * @param openSessions OPEN 회차 전부(예약된 미래 포함, 날짜 오름차순)
 * @param totalRefund  무효화 시 돌려줄 총액(= Σ pot)
 */
public record ChallengeDeletionPreviewResponse(
        List<OpenSessionPreview> openSessions,
        int totalRefund
) {

    /**
     * OPEN 회차 한 줄.
     *
     * @param sessionDate      회차 날짜(KST)
     * @param participantCount 참가 인원(0명 회차도 그대로 보인다 — 삭제 시엔 UNUSED 로 닫힌다)
     * @param pot              적립금 = stake × 인원
     */
    public record OpenSessionPreview(LocalDate sessionDate, int participantCount, int pot) {
    }
}
