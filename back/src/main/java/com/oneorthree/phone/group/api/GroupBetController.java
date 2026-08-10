package com.oneorthree.phone.group.api;

import com.oneorthree.phone.common.auth.LoginUser;
import com.oneorthree.phone.group.dto.CreateBetRequest;
import com.oneorthree.phone.group.dto.CreateBetResponse;
import com.oneorthree.phone.group.dto.GroupBetHistorySliceResponse;
import com.oneorthree.phone.group.service.GroupBetService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

@Tag(name = "Group Bet", description = "그룹 챌린지 내기 (개설/참가/히스토리). 현재 판 조회는 챌린지 목록 API 의 bet/lastSettledBet 필드")
@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class GroupBetController {

    // 브리지 경로 사용량 계측(N36 · 제거 판단 GROMO-1238)은 LegacyBetBridgeLogInterceptor 가 한다 —
    // 여기서 찍으면 인자 검증을 통과한 호출만 세어 실패하는 구앱 호출이 집계에서 빠진다.

    private final GroupBetService groupBetService;

    @Operation(summary = "챌린지 내기 개설 (레거시 브리지)",
            description = "2계층 재편(GROMO-1262) 후 '설정 보장 + 해당 날짜 회차 개설 + 본인 참가'로"
                    + " 동작한다. 응답의 betId 는 회차 id 다(참가·취소 호출에 그대로 쓴다)."
                    + " 그룹원 누구나 호출 가능하며 참가비가 즉시 차감된다(에스크로)."
                    + " date 는 KST 오늘 또는 내일, stake 는 1~3000(GROMO-1264)."
                    + " 개설 시점에 이미 목표를 달성했으면 거절된다.")
    @ApiResponses({
        @ApiResponse(responseCode = "201", description = "개설 성공"),
        @ApiResponse(responseCode = "400",
                description = "BET_FOCUS_ONLY(집중 챌린지 아님) / BET_INVALID_STAKE / INSUFFICIENT_CURRENCY"),
        @ApiResponse(responseCode = "403", description = "게스트 / 그룹원 아님"),
        @ApiResponse(responseCode = "404", description = "그룹 없음 / 챌린지 없음"),
        @ApiResponse(responseCode = "409",
                description = "BET_ALREADY_EXISTS / BET_ALREADY_ACHIEVED"
                        + " / BET_CLOSED(오늘·내일 아님 / 비활성 요일 / 창 마감)")
    })
    @PostMapping("/groups/{groupId}/challenges/{challengeId}/bets")
    public ResponseEntity<CreateBetResponse> createBet(
            @PathVariable UUID groupId,
            @PathVariable UUID challengeId,
            @Valid @RequestBody CreateBetRequest request,
            @LoginUser UUID userId
    ) {
        CreateBetResponse response = groupBetService.createBet(groupId, challengeId, userId, request);
        return ResponseEntity.status(HttpStatus.CREATED).body(response);
    }

    @Operation(summary = "챌린지 내기 참가",
            description = "빈 바디. 판돈이 즉시 차감된다. OPEN 이고 bet_date 가 KST 오늘인 내기만 참가 가능하며,"
                    + " 이미 목표를 달성했으면 거절된다(무위험 참가 차단).")
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "참가 성공"),
        @ApiResponse(responseCode = "400", description = "INSUFFICIENT_CURRENCY"),
        @ApiResponse(responseCode = "403", description = "게스트 / 그룹원 아님"),
        @ApiResponse(responseCode = "404", description = "그룹 없음 / BET_NOT_FOUND"),
        @ApiResponse(responseCode = "409", description = "BET_CLOSED / BET_ALREADY_JOINED / BET_ALREADY_ACHIEVED")
    })
    @PostMapping("/groups/{groupId}/bets/{betId}/join")
    public ResponseEntity<Void> joinBet(
            @PathVariable UUID groupId,
            @PathVariable UUID betId,
            @LoginUser UUID userId
    ) {
        groupBetService.joinBet(groupId, betId, userId);
        return ResponseEntity.noContent().build();
    }

    @Operation(summary = "챌린지 내기 취소",
            description = "개설자 본인 && 참가자가 개설자 1명뿐 && OPEN 일 때만 취소할 수 있다."
                    + " 판돈은 환불된다. 정산 배치와 겹치면 CAS 게이트에서 한쪽만 이긴다"
                    + " (정산이 먼저면 BET_NOT_OPEN).")
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "취소 성공 (판돈 환불)"),
        @ApiResponse(responseCode = "403",
                description = "게스트 / 그룹원 아님 / BET_CANCEL_FORBIDDEN(개설자 아님)"),
        @ApiResponse(responseCode = "404", description = "그룹 없음 / BET_NOT_FOUND"),
        @ApiResponse(responseCode = "409",
                description = "BET_CANCEL_HAS_OTHERS(타 참가자 존재) / BET_NOT_OPEN(이미 종료·이중 취소)")
    })
    @DeleteMapping("/groups/{groupId}/bets/{betId}")
    public ResponseEntity<Void> cancelBet(
            @PathVariable UUID groupId,
            @PathVariable UUID betId,
            @LoginUser UUID userId
    ) {
        groupBetService.cancelBet(groupId, betId, userId);
        return ResponseEntity.noContent().build();
    }

    @Operation(summary = "챌린지 내기 참가 철회",
            description = "시작 전 내기에서 호출자 본인의 참가만 철회하고 본인 참가비를 환불한다."
                    + " 개설자가 철회해도 남은 참가자가 있으면 내기는 유지되고, 마지막 참가자가 떠나면"
                    + " 내기가 자동 취소(CANCELED)된다. 시작 전 = TIME_WINDOW 는 bet_date 창 시작 전,"
                    + " DURATION 은 bet_date 가 내일 이후(KST).")
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "철회 성공 (본인 참가비 환불)"),
        @ApiResponse(responseCode = "403", description = "게스트 / 그룹원 아님"),
        @ApiResponse(responseCode = "404", description = "그룹 없음 / BET_NOT_FOUND"),
        @ApiResponse(responseCode = "409",
                description = "BET_NOT_JOINED(참가 이력 없음) / BET_NOT_OPEN(이미 종료)"
                        + " / BET_LEAVE_CLOSED(시작 이후)")
    })
    @DeleteMapping("/groups/{groupId}/bets/{betId}/participation")
    public ResponseEntity<Void> leaveBet(
            @PathVariable UUID groupId,
            @PathVariable UUID betId,
            @LoginUser UUID userId
    ) {
        groupBetService.leaveBet(groupId, betId, userId);
        return ResponseEntity.noContent().build();
    }

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
                description = "그룹 없음 / 챌린지 없음 / BET_NOT_FOUND(커서가 이 챌린지의 내기가 아님)")
    })
    @GetMapping("/groups/{groupId}/challenges/{challengeId}/bets")
    public ResponseEntity<GroupBetHistorySliceResponse> getBetHistory(
            @PathVariable UUID groupId,
            @PathVariable UUID challengeId,
            @RequestParam(required = false) UUID cursor,
            @RequestParam int size,
            @LoginUser UUID userId
    ) {
        return ResponseEntity.ok(groupBetService.getBetHistory(groupId, challengeId, userId, cursor, size));
    }
}
