package com.oneorthree.phone.group.api;

import com.oneorthree.phone.common.auth.LoginUser;
import com.oneorthree.phone.group.dto.CreateBetRequest;
import com.oneorthree.phone.group.dto.CreateBetResponse;
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
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

@Tag(name = "Group Bet", description = "그룹 챌린지 내기 (개설/참가). 조회는 챌린지 목록 API 의 bet/lastSettledBet 필드")
@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class GroupBetController {

    private final GroupBetService groupBetService;

    @Operation(summary = "챌린지 내기 개설",
            description = "그룹원 누구나 개설 가능. 개설자는 자동 참가하고 판돈이 즉시 차감된다(에스크로)."
                    + " 대상은 FOCUS + DURATION 챌린지뿐이며, date 는 KST 오늘, stake 는 10/30/50/100 만 허용."
                    + " 개설 시점에 이미 목표를 달성했으면 거절된다.")
    @ApiResponses({
        @ApiResponse(responseCode = "201", description = "개설 성공"),
        @ApiResponse(responseCode = "400",
                description = "BET_FOCUS_ONLY(집중 챌린지 아님) / BET_INVALID_STAKE / INSUFFICIENT_CURRENCY"),
        @ApiResponse(responseCode = "403", description = "게스트 / 그룹원 아님"),
        @ApiResponse(responseCode = "404", description = "그룹 없음 / 챌린지 없음"),
        @ApiResponse(responseCode = "409",
                description = "BET_ALREADY_EXISTS / BET_ALREADY_ACHIEVED / BET_CLOSED(date 가 오늘이 아님)")
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
}
