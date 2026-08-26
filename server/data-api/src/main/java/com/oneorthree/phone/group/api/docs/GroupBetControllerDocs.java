package com.oneorthree.phone.group.api.docs;

import com.oneorthree.phone.group.dto.CreateBetRequest;
import com.oneorthree.phone.group.dto.CreateBetResponse;
import com.oneorthree.phone.group.dto.GroupBetHistorySliceResponse;
import com.oneorthree.phone.group.dto.JoinSessionResponse;
import com.oneorthree.phone.group.dto.JoinWeekRequest;
import com.oneorthree.phone.group.dto.JoinWeekResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.ResponseEntity;

import java.util.UUID;

/**
 * {@code GroupBetController} 의 OpenAPI 문서 면(面) — Swagger 애노테이션만 둔다(GROMO-1621).
 */
@Tag(name = "Group Bet", description = "그룹 챌린지 내기 (개설/참가/히스토리). 현재 판 조회는 챌린지 목록 API 의 bet/lastSettledBet 필드")
public interface GroupBetControllerDocs {

    @Operation(summary = "회차 참여 (신 경로, GROMO-1408 · LLD §2.2)",
            description = "빈 바디. 앱이 카드의 bet.session.sessionId 로 지목한 회차에 참가하고 참가비를"
                    + " 즉시 차감한다(에스크로). 회차가 이미 있어야 호출 가능한 축이다 — lazy 개설은"
                    + " join-next·join-week·00:05 크론의 몫. 참가 마감은 박제 joinClosesAt(창형 = 창"
                    + " 시작, 하루형 = 회차 종료) 기준이고, SCREEN_TIME 회차는 서버가 스크린타임"
                    + " 권한을 확인한다(N50). 다른 그룹의 회차 id 는 404 다(IDOR).")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "참여 성공 — {sessionId, sessionDate, stake, balanceAfter}"),
        @ApiResponse(responseCode = "400", description = "INVALID_MISSION_PARAMS"),
        @ApiResponse(responseCode = "403", description = "게스트 / 그룹원 아님"),
        @ApiResponse(responseCode = "404",
                description = "NOT_FOUND(그룹 없음) / BET_NOT_FOUND(회차 없음·그룹 불일치) / 챌린지 삭제됨"
                        + " / USER_NOT_FOUND(요청자 유저 부재 — 재로그인)"),
        @ApiResponse(responseCode = "409",
                description = "BET_CLOSED(참가 마감) / BET_ALREADY_JOINED / BET_ALREADY_ACHIEVED"
                        + " / BET_ALREADY_FAILED / BET_SCREENTIME_PERMISSION_REQUIRED"
                        + " / BET_INSUFFICIENT_BALANCE / BET_CHALLENGE_INACTIVE")
    })
    ResponseEntity<JoinSessionResponse> joinSession(UUID groupId, UUID sessionId, UUID userId);

    @Operation(summary = "회차 참여 취소 (신 경로, GROMO-1423 · LLD §2.2)",
            description = "본인 참가를 무르고 참가비를 환불한다. 취소 마감(N22): 시작 전 참가는 회차"
                    + " 시작까지(유예 없음), 시작 후 참가(하루형)는 min(참가+5분, 회차 종료)까지."
                    + " 예약분(join-next·join-week)도 같은 규칙이다. 마지막 참가자가 떠나면 회차는"
                    + " \"없던 일\"로 삭제된다.")
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "취소 성공 (본인 참가비 환불)"),
        @ApiResponse(responseCode = "403", description = "게스트 / 그룹원 아님"),
        @ApiResponse(responseCode = "404",
                description = "NOT_FOUND(그룹 없음) / BET_NOT_FOUND(회차 없음·그룹 불일치)"
                        + " / USER_NOT_FOUND(요청자 유저 부재 — 재로그인)"),
        @ApiResponse(responseCode = "409",
                description = "BET_NOT_JOINED(참가 이력 없음) / BET_NOT_OPEN(이미 종료)"
                        + " / BET_LEAVE_CLOSED(취소 마감 경과)")
    })
    ResponseEntity<Void> leaveSession(UUID groupId, UUID sessionId, UUID userId);

    @Operation(summary = "다음 활성일 회차 참여 (신 경로, GROMO-1408·N45)",
            description = "빈 바디. 오늘을 제외한 다음 활성일 회차 1건을 lazy 개설 후 참가한다(예약 —"
                    + " 참가비 즉시 에스크로, N15). 오늘 회차는 join 이 담당한다. 취소는 예약분 규칙"
                    + " 그대로 회차 시작까지 가능하다(N22).")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "예약 성공 — {sessionId, sessionDate, stake, balanceAfter}"),
        @ApiResponse(responseCode = "403", description = "게스트 / 그룹원 아님"),
        @ApiResponse(responseCode = "404",
                description = "NOT_FOUND(그룹 없음 / 챌린지 없음) / BET_NOT_FOUND(내기 미설정)"
                        + " / USER_NOT_FOUND(요청자 유저 부재 — 재로그인)"),
        @ApiResponse(responseCode = "409",
                description = "BET_ALREADY_JOINED(이미 예약) / BET_SCREENTIME_PERMISSION_REQUIRED"
                        + " / BET_INSUFFICIENT_BALANCE / BET_CHALLENGE_INACTIVE")
    })
    ResponseEntity<JoinSessionResponse> joinNext(UUID groupId, UUID challengeId, UUID userId);

    @Operation(summary = "주간 부분 예약 (신 경로, GROMO-1408·N39)",
            description = "이번 주(월~일) 남은 활성일 회차를 lazy 개설 후 한 트랜잭션으로 참가한다"
                    + " (부분 성공 없음, 잔액 검사는 총액). 본문 sessionDates 는 선택 — 주면 그 날짜만"
                    + " 부분 예약. 이미 참가한 회차와 마감·자격 가드에 걸린 오늘은 조용히 스킵한다.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "예약 성공 — {joined[], totalStake, balanceAfter}"),
        @ApiResponse(responseCode = "400",
                description = "INVALID_SESSION_DATES(빈 목록·중복·활성일 아님·이번 주 밖·과거)"),
        @ApiResponse(responseCode = "403", description = "게스트 / 그룹원 아님"),
        @ApiResponse(responseCode = "404",
                description = "NOT_FOUND(그룹 없음 / 챌린지 없음) / BET_NOT_FOUND(내기 미설정)"
                        + " / USER_NOT_FOUND(요청자 유저 부재 — 재로그인)"),
        @ApiResponse(responseCode = "409",
                description = "BET_SCREENTIME_PERMISSION_REQUIRED / BET_INSUFFICIENT_BALANCE(총액)"
                        + " / BET_CHALLENGE_INACTIVE")
    })
    ResponseEntity<JoinWeekResponse> joinWeek(UUID groupId, UUID challengeId, JoinWeekRequest request, UUID userId);

    @Operation(summary = "챌린지 내기 개설 (레거시 브리지)",
            description = "2계층 재편(GROMO-1262) 후 '설정 보장 + 해당 날짜 회차 개설 + 본인 참가'로"
                    + " 동작한다. 응답의 betId 는 회차 id 다(참가·취소 호출에 그대로 쓴다)."
                    + " 그룹원 누구나 호출 가능하며 참가비가 즉시 차감된다(에스크로)."
                    + " date 는 KST 오늘 또는 내일, stake 는 1~3000(GROMO-1264)."
                    + " 개설 시점에 이미 목표를 달성했으면 거절된다.")
    @ApiResponses({
        @ApiResponse(responseCode = "201", description = "개설 성공"),
        @ApiResponse(responseCode = "400",
                description = "BET_INVALID_STAKE / INSUFFICIENT_CURRENCY"),
        @ApiResponse(responseCode = "403", description = "게스트 / 그룹원 아님"),
        @ApiResponse(responseCode = "404",
                description = "NOT_FOUND(그룹 없음 / 챌린지 없음) / USER_NOT_FOUND(요청자 유저 부재 — 재로그인)"),
        @ApiResponse(responseCode = "409",
                description = "BET_ALREADY_EXISTS / BET_ALREADY_ACHIEVED"
                        + " / BET_CLOSED(오늘·내일 아님 / 비활성 요일 / 창 마감)")
    })
    ResponseEntity<CreateBetResponse> createBet(UUID groupId, UUID challengeId, CreateBetRequest request, UUID userId);

    @Operation(summary = "챌린지 내기 참가",
            description = "빈 바디. 판돈이 즉시 차감된다. OPEN 이고 bet_date 가 KST 오늘인 내기만 참가 가능하며,"
                    + " 이미 목표를 달성했으면 거절된다(무위험 참가 차단).")
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "참가 성공"),
        @ApiResponse(responseCode = "400", description = "INSUFFICIENT_CURRENCY"),
        @ApiResponse(responseCode = "403", description = "게스트 / 그룹원 아님"),
        @ApiResponse(responseCode = "404",
                description = "NOT_FOUND(그룹 없음) / BET_NOT_FOUND"
                        + " / USER_NOT_FOUND(요청자 유저 부재 — 재로그인)"),
        @ApiResponse(responseCode = "409", description = "BET_CLOSED / BET_ALREADY_JOINED / BET_ALREADY_ACHIEVED")
    })
    ResponseEntity<Void> joinBet(UUID groupId, UUID betId, UUID userId);

    @Operation(summary = "챌린지 내기 취소",
            description = "개설자 본인 && 참가자가 개설자 1명뿐 && OPEN 일 때만 취소할 수 있다."
                    + " 판돈은 환불된다. 취소 마감(N22·GROMO-1423)도 철회와 같은 규칙이다 — 시작 전"
                    + " 참가는 회차 시작까지, 시작 후 참가(하루형)는 참가+5분(회차 종료 상한)까지."
                    + " 정산 배치와 겹치면 CAS 게이트에서 한쪽만 이긴다(정산이 먼저면 BET_NOT_OPEN).")
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "취소 성공 (판돈 환불)"),
        @ApiResponse(responseCode = "403",
                description = "게스트 / 그룹원 아님 / BET_CANCEL_FORBIDDEN(개설자 아님)"),
        @ApiResponse(responseCode = "404",
                description = "NOT_FOUND(그룹 없음) / BET_NOT_FOUND"
                        + " / USER_NOT_FOUND(요청자 유저 부재 — 재로그인)"),
        @ApiResponse(responseCode = "409",
                description = "BET_CANCEL_HAS_OTHERS(타 참가자 존재) / BET_NOT_OPEN(이미 종료·이중 취소)"
                        + " / BET_LEAVE_CLOSED(취소 마감 경과)")
    })
    ResponseEntity<Void> cancelBet(UUID groupId, UUID betId, UUID userId);

    @Operation(summary = "챌린지 내기 참가 철회",
            description = "시작 전 회차에서 호출자 본인의 참가만 철회하고 본인 참가비를 환불한다."
                    + " 철회해도 남은 참가자가 있으면 회차는 유지되고, 유저가 연 회차에서 마지막"
                    + " 참가자가 떠나면 회차 행이 삭제된다(2계층 재편으로 CANCELED 상태는 소멸 —"
                    + " GROMO-1262). 시작 전 = TIME_WINDOW 는 session_date 창 시작 전,"
                    + " DURATION 은 session_date 가 내일 이후(KST).")
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "철회 성공 (본인 참가비 환불)"),
        @ApiResponse(responseCode = "403", description = "게스트 / 그룹원 아님"),
        @ApiResponse(responseCode = "404",
                description = "NOT_FOUND(그룹 없음) / BET_NOT_FOUND"
                        + " / USER_NOT_FOUND(요청자 유저 부재 — 재로그인)"),
        @ApiResponse(responseCode = "409",
                description = "BET_NOT_JOINED(참가 이력 없음) / BET_NOT_OPEN(이미 종료)"
                        + " / BET_LEAVE_CLOSED(시작 이후)")
    })
    ResponseEntity<Void> leaveBet(UUID groupId, UUID betId, UUID userId);

    @Operation(summary = "챌린지 내기 히스토리 조회",
            description = "챌린지의 정산 완료 내기(SETTLED·REFUNDED·FORFEITED)를 bet_date 내림차순으로"
                    + " keyset 커서 페이지네이션해 돌려준다. CANCELED(취소)는 '없던 일'이라 실리지 않는다."
                    + " cursor 는 직전 페이지 마지막 항목의 betId(생략 시 첫 페이지), size 는 1~100."
                    + " 항목의 goalMinutes·참가자별 progressMinutes 는 정산 시점 판정 근거 스냅샷이며,"
                    + " 근거 저장 이전(V29 미만) 정산 건은 null 이다(앱은 '—'·분모 생략으로 표시)."
                    + " 이력은 그룹원 전체가 열람할 수 있다.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "조회 성공"),
        @ApiResponse(responseCode = "400", description = "INVALID_PAGE_REQUEST(size 범위 밖)"),
        @ApiResponse(responseCode = "403", description = "게스트 / 그룹원 아님"),
        @ApiResponse(responseCode = "404",
                description = "NOT_FOUND(그룹 없음 / 챌린지 없음) / BET_NOT_FOUND(커서가 이 챌린지의 내기가 아님)"
                        + " / USER_NOT_FOUND(요청자 유저 부재 — 재로그인)")
    })
    ResponseEntity<GroupBetHistorySliceResponse> getBetHistory(UUID groupId, UUID challengeId, UUID cursor,
            int size, UUID userId);
}
