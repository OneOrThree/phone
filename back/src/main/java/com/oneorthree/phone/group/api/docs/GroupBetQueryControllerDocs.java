package com.oneorthree.phone.group.api.docs;

import com.oneorthree.phone.group.dto.ChallengeDeletionPreviewResponse;
import com.oneorthree.phone.group.dto.GroupChallengeHistorySliceResponse;
import com.oneorthree.phone.group.dto.MyBetSessionsResponse;
import com.oneorthree.phone.group.dto.MyChallengeResultsResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.ResponseEntity;

import java.time.Instant;
import java.util.UUID;

/**
 * {@code GroupBetQueryController} 의 OpenAPI 문서 면(面) — Swagger 애노테이션만 둔다(GROMO-1621).
 */
@Tag(name = "Group Bet Query", description = "챌린지 v2 조회 축 (GROMO-1415·1416·1271) — 참가자 스코프"
        + " /me 조회(보고 탐색축·결과 모달 큐), 삭제 프리플라이트, 그룹 챌린지 내역")
public interface GroupBetQueryControllerDocs {

    @Operation(summary = "내 OPEN 회차 목록 (그룹 무관)",
            description = "내가 참가비를 건 진행 중(OPEN) 회차 전부 — 창 사용분 보고의 대상 탐색축(N43)."
                    + " 그룹 멤버십을 보지 않으므로 그룹 탈퇴 후에도, 챌린지 종료 후에도 조회된다."
                    + " 응답에 미션 스냅샷(카테고리·방식·목표·창 시각)과 closesAt·settleAfter 를 실어"
                    + " 앱이 챌린지 조회 없이 보고를 만든다. status 는 OPEN 만 지원한다.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "조회 성공"),
        @ApiResponse(responseCode = "400", description = "INVALID_STATUS_FILTER(status ≠ OPEN)"),
        @ApiResponse(responseCode = "403", description = "게스트"),
        // 그룹 스코프가 없는 경로라 404 는 USER_NOT_FOUND 하나뿐이다(GROMO-1247).
        @ApiResponse(responseCode = "404", description = "USER_NOT_FOUND(요청자 유저 부재 — 재로그인)")
    })
    ResponseEntity<MyBetSessionsResponse> getMyBetSessions(String status, UUID userId);

    @Operation(summary = "내 미확인 정산 완료 회차 (그룹 무관) — 결과 모달 큐의 유일한 소스",
            description = "내가 참가자인 정산 완료 회차(SETTLED·FORFEITED·VOIDED·REFUNDED) 중"
                    + " 아직 확인(ack)하지 않은 것을 회차일 내림차순으로 돌려준다(N53·N58)."
                    + " 미확인 필터는 limit 보다 먼저 걸린다 — 확인된 행까지 실으면 결과가 11건 이상인"
                    + " 사용자는 확인된 10건이 상한을 점유해 11번째 미확인 결과를 영영 못 본다."
                    + " 그래서 응답의 acknowledged 는 항상 false 다(계약 표면으로 유지)."
                    + " 그룹 멤버십·챌린지 상태를 보지 않아 탈퇴자·종료"
                    + " 챌린지도 실린다. 삭제된 챌린지의 회차는 제외(FR-44-4 — 삭제 환불은"
                    + " BET_VOID_REFUND 푸시가 알린다), UNUSED(0명 종료)도 제외(N52)."
                    + " since 는 settledAt 하한(생략 시 최근 30일 — 30일보다 과거는 30일로 보정),"
                    + " limit 은 1~10(생략 시 10). 회차 미션 스냅샷(missionCategory·missionType·창 시각)은"
                    + " 결과 모달의 관용치 고지 복원용 additive 필드다.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "조회 성공"),
        @ApiResponse(responseCode = "400", description = "INVALID_PAGE_REQUEST(limit 범위 밖) / since 형식 오류"),
        @ApiResponse(responseCode = "403", description = "게스트"),
        // 그룹 스코프가 없는 경로라 404 는 USER_NOT_FOUND 하나뿐이다(GROMO-1247).
        @ApiResponse(responseCode = "404", description = "USER_NOT_FOUND(요청자 유저 부재 — 재로그인)")
    })
    ResponseEntity<MyChallengeResultsResponse> getMyChallengeResults(Instant since, Integer limit, UUID userId);

    @Operation(summary = "챌린지 삭제 프리플라이트 (그룹장 전용)",
            description = "삭제 경고에 쓸 영향 범위(N49·K11 해소) — OPEN 회차 전부(예약된 미래 포함)의"
                    + " 날짜·인원·적립금과 총 환불액. 카드의 bet.session 은 오늘 회차 1건뿐이라 주간"
                    + " 예약분이 빠진다 — 이 응답으로 FR-12-1 의 확인 시트를 그린다. 서버 게이트는"
                    + " 없다 — DELETE 는 프리플라이트 호출 여부와 무관하게 받는다(경고는 오탭 방어).")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "조회 성공"),
        @ApiResponse(responseCode = "403", description = "게스트 / 그룹원 아님 / NOT_OWNER(그룹장 아님)"),
        @ApiResponse(responseCode = "404",
                description = "NOT_FOUND(그룹 없음 / 챌린지 없음 — 타 그룹 챌린지 포함, IDOR 차단)"
                        + " / USER_NOT_FOUND(요청자 유저 부재 — 재로그인)")
    })
    ResponseEntity<ChallengeDeletionPreviewResponse> getDeletionPreview(UUID groupId, UUID challengeId, UUID userId);

    @Operation(summary = "그룹 챌린지 내역 (그룹 단위 회차 이력)",
            description = "그룹의 정산 완료 회차(SETTLED·REFUNDED·FORFEITED·VOIDED)를 (session_date, id)"
                    + " 내림차순 keyset 커서로 페이지네이션한다(GROMO-1271·N6-1). 이력의 소유자가"
                    + " 그룹이라 챌린지가 삭제돼도 조회된다 — 표시 값은 회차 미션 스냅샷이고"
                    + " challengeDeleted 로 배지를 단다. UNUSED(0명 종료)는 실리지 않는다(N52)."
                    + " cursor 는 직전 페이지 마지막 항목의 sessionId(생략 시 첫 페이지), size 는 1~100"
                    + " 필수, challengeId 로 특정 챌린지만 필터할 수 있다. 그룹원 전체 열람 가능.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "조회 성공"),
        @ApiResponse(responseCode = "400", description = "INVALID_PAGE_REQUEST(size 범위 밖)"),
        @ApiResponse(responseCode = "403", description = "게스트 / 그룹원 아님"),
        @ApiResponse(responseCode = "404",
                description = "NOT_FOUND(그룹 없음) / BET_NOT_FOUND(커서가 이 그룹 회차가 아님)"
                        + " / USER_NOT_FOUND(요청자 유저 부재 — 재로그인)")
    })
    ResponseEntity<GroupChallengeHistorySliceResponse> getGroupChallengeHistory(UUID groupId, UUID cursor,
            int size, UUID challengeId, UUID userId);
}
