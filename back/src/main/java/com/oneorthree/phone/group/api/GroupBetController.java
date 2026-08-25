package com.oneorthree.phone.group.api;

import com.oneorthree.phone.common.auth.LoginUser;
import com.oneorthree.phone.group.api.docs.GroupBetControllerDocs;
import com.oneorthree.phone.group.dto.CreateBetRequest;
import com.oneorthree.phone.group.dto.CreateBetResponse;
import com.oneorthree.phone.group.dto.GroupBetHistorySliceResponse;
import com.oneorthree.phone.group.dto.JoinSessionResponse;
import com.oneorthree.phone.group.dto.JoinWeekRequest;
import com.oneorthree.phone.group.dto.JoinWeekResponse;
import com.oneorthree.phone.group.service.GroupBetJoinService;
import com.oneorthree.phone.group.service.GroupBetService;
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

/**
 * 그룹 챌린지 내기(개설·참가·히스토리) API.
 * Swagger 애노테이션은 {@link GroupBetControllerDocs} 로 분리했다(GROMO-1621).
 */
@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class GroupBetController implements GroupBetControllerDocs {

    // 브리지 경로 사용량 계측(N36 · 제거 판단 GROMO-1238)은 LegacyBetBridgeLogInterceptor 가 한다 —
    // 여기서 찍으면 인자 검증을 통과한 호출만 세어 실패하는 구앱 호출이 집계에서 빠진다.

    private final GroupBetService groupBetService;
    private final GroupBetJoinService groupBetJoinService;

    @Override
    @PostMapping("/groups/{groupId}/sessions/{sessionId}/join")
    public ResponseEntity<JoinSessionResponse> joinSession(
            @PathVariable UUID groupId,
            @PathVariable UUID sessionId,
            @LoginUser UUID userId
    ) {
        return ResponseEntity.ok(groupBetJoinService.joinSession(groupId, sessionId, userId));
    }

    @Override
    @DeleteMapping("/groups/{groupId}/sessions/{sessionId}/participation")
    public ResponseEntity<Void> leaveSession(
            @PathVariable UUID groupId,
            @PathVariable UUID sessionId,
            @LoginUser UUID userId
    ) {
        // 레거시 철회와 같은 서비스 경로 — 2계층 재편 후 betId 가 곧 회차 id 라 판정점이 하나다(N22).
        groupBetService.leaveBet(groupId, sessionId, userId);
        return ResponseEntity.noContent().build();
    }

    @Override
    @PostMapping("/groups/{groupId}/challenges/{challengeId}/join-next")
    public ResponseEntity<JoinSessionResponse> joinNext(
            @PathVariable UUID groupId,
            @PathVariable UUID challengeId,
            @LoginUser UUID userId
    ) {
        return ResponseEntity.ok(groupBetJoinService.joinNext(groupId, challengeId, userId));
    }

    @Override
    @PostMapping("/groups/{groupId}/challenges/{challengeId}/join-week")
    public ResponseEntity<JoinWeekResponse> joinWeek(
            @PathVariable UUID groupId,
            @PathVariable UUID challengeId,
            @RequestBody(required = false) JoinWeekRequest request,
            @LoginUser UUID userId
    ) {
        return ResponseEntity.ok(groupBetJoinService.joinWeek(groupId, challengeId, userId, request));
    }

    @Override
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

    @Override
    @PostMapping("/groups/{groupId}/bets/{betId}/join")
    public ResponseEntity<Void> joinBet(
            @PathVariable UUID groupId,
            @PathVariable UUID betId,
            @LoginUser UUID userId
    ) {
        groupBetService.joinBet(groupId, betId, userId);
        return ResponseEntity.noContent().build();
    }

    @Override
    @DeleteMapping("/groups/{groupId}/bets/{betId}")
    public ResponseEntity<Void> cancelBet(
            @PathVariable UUID groupId,
            @PathVariable UUID betId,
            @LoginUser UUID userId
    ) {
        groupBetService.cancelBet(groupId, betId, userId);
        return ResponseEntity.noContent().build();
    }

    @Override
    @DeleteMapping("/groups/{groupId}/bets/{betId}/participation")
    public ResponseEntity<Void> leaveBet(
            @PathVariable UUID groupId,
            @PathVariable UUID betId,
            @LoginUser UUID userId
    ) {
        groupBetService.leaveBet(groupId, betId, userId);
        return ResponseEntity.noContent().build();
    }

    @Override
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
