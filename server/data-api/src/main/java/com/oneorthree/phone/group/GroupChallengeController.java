package com.oneorthree.phone.group;

import com.oneorthree.phone.common.auth.LoginUser;
import com.oneorthree.phone.group.dto.CreateChallengeRequest;
import com.oneorthree.phone.group.dto.CreateChallengeResponse;
import com.oneorthree.phone.group.dto.GroupChallengeResponse;
import com.oneorthree.phone.group.dto.WindowUsageReportRequest;
import com.oneorthree.phone.group.service.GroupBetWindowUsageService;
import com.oneorthree.phone.group.service.GroupChallengeService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * 그룹 챌린지 API — {@link GroupController} 에서 분리(GROMO-1284, policy §9.2 B12).
 * <b>순수 구조 이동</b>이다: URL·요청·응답 shape 은 1바이트도 다르지 않다(구앱 계약).
 * 내기 축은 {@link GroupBetController} 가 담당한다.
 *
 * <p>Swagger 애노테이션은 {@link GroupChallengeControllerDocs} 로 분리했다(GROMO-1621).
 */
@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class GroupChallengeController implements GroupChallengeControllerDocs {

    private final GroupChallengeService groupChallengeService;
    /**
     * 창 사용분 보고는 챌린지가 아니라 <b>회차 판정 소스</b>를 갱신한다 — main 이 이 경로를
     * {@code GroupChallengeService} 에서 분리해 세운 전담 서비스(GROMO-1407 · N34 · N43)를 그대로 탄다.
     * 컨트롤러 분리(GROMO-1284)는 <b>구조 이동만</b>이라 호출 대상을 바꾸지 않는다.
     */
    private final GroupBetWindowUsageService groupBetWindowUsageService;

    @Override
    @GetMapping("/groups/{groupId}/challenges")
    public ResponseEntity<List<GroupChallengeResponse>> getGroupChallenges(
            @PathVariable UUID groupId,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date,
            @LoginUser UUID userId
    ) {
        return ResponseEntity.ok(groupChallengeService.getChallenges(groupId, userId, date));
    }

    @Override
    @PostMapping("/groups/{groupId}/challenges")
    public ResponseEntity<CreateChallengeResponse> createGroupChallenge(
            @PathVariable UUID groupId,
            @Valid @RequestBody CreateChallengeRequest request,
            @LoginUser UUID userId
    ) {
        CreateChallengeResponse response = groupChallengeService.createChallenge(groupId, userId, request);
        return ResponseEntity.status(HttpStatus.CREATED).body(response);
    }

    @Override
    @PutMapping("/groups/{groupId}/challenges/{challengeId}/window-usage")
    public ResponseEntity<Void> reportChallengeWindowUsage(
            @PathVariable UUID groupId,
            @PathVariable UUID challengeId,
            @Valid @RequestBody WindowUsageReportRequest request,
            @LoginUser UUID userId
    ) {
        groupBetWindowUsageService.reportWindowUsage(groupId, challengeId, userId, request);
        return ResponseEntity.noContent().build();
    }

    @Override
    @PostMapping("/groups/{groupId}/challenges/{challengeId}/end")
    public ResponseEntity<Void> endGroupChallenge(
            @PathVariable UUID groupId,
            @PathVariable UUID challengeId,
            @LoginUser UUID userId
    ) {
        groupChallengeService.endChallenge(groupId, challengeId, userId);
        return ResponseEntity.noContent().build();
    }

    @Override
    @DeleteMapping("/groups/{groupId}/challenges/{challengeId}")
    public ResponseEntity<Void> deleteGroupChallenge(
            @PathVariable UUID groupId,
            @PathVariable UUID challengeId,
            @LoginUser UUID userId
    ) {
        groupChallengeService.deleteChallenge(groupId, challengeId, userId);
        return ResponseEntity.noContent().build();
    }
}
