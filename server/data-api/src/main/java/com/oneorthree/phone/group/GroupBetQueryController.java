package com.oneorthree.phone.group;

import com.oneorthree.phone.common.auth.LoginUser;
import com.oneorthree.phone.group.dto.ChallengeDeletionPreviewResponse;
import com.oneorthree.phone.group.dto.GroupChallengeHistorySliceResponse;
import com.oneorthree.phone.group.dto.MyBetSessionsResponse;
import com.oneorthree.phone.group.dto.MyChallengeResultsResponse;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.group.service.GroupBetQueryService;
import lombok.RequiredArgsConstructor;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.util.UUID;

/**
 * 챌린지 v2 조회 축. Swagger 애노테이션은 {@link GroupBetQueryControllerDocs} 로 분리했다(GROMO-1621).
 */
@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class GroupBetQueryController implements GroupBetQueryControllerDocs {

    private final GroupBetQueryService groupBetQueryService;

    @Override
    @GetMapping("/me/bet-sessions")
    public ResponseEntity<MyBetSessionsResponse> getMyBetSessions(
            @RequestParam(defaultValue = "OPEN") String status,
            @LoginUser UUID userId
    ) {
        if (!"OPEN".equals(status)) {
            throw new GroupException(GroupErrorCode.INVALID_STATUS_FILTER);
        }
        return ResponseEntity.ok(groupBetQueryService.getMyOpenBetSessions(userId));
    }

    @Override
    @GetMapping("/me/challenge-results")
    public ResponseEntity<MyChallengeResultsResponse> getMyChallengeResults(
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant since,
            @RequestParam(required = false) Integer limit,
            @LoginUser UUID userId
    ) {
        return ResponseEntity.ok(groupBetQueryService.getMyChallengeResults(userId, since, limit));
    }

    @Override
    @GetMapping("/groups/{groupId}/challenges/{challengeId}/deletion-preview")
    public ResponseEntity<ChallengeDeletionPreviewResponse> getDeletionPreview(
            @PathVariable UUID groupId,
            @PathVariable UUID challengeId,
            @LoginUser UUID userId
    ) {
        return ResponseEntity.ok(groupBetQueryService.getDeletionPreview(groupId, challengeId, userId));
    }

    @Override
    @GetMapping("/groups/{groupId}/challenge-history")
    public ResponseEntity<GroupChallengeHistorySliceResponse> getGroupChallengeHistory(
            @PathVariable UUID groupId,
            @RequestParam(required = false) UUID cursor,
            @RequestParam int size,
            @RequestParam(required = false) UUID challengeId,
            @LoginUser UUID userId
    ) {
        return ResponseEntity.ok(groupBetQueryService
                .getGroupChallengeHistory(groupId, userId, cursor, size, challengeId));
    }
}
