package com.oneorthree.phone.group.api;

import com.oneorthree.phone.common.auth.LoginUser;
import com.oneorthree.phone.group.dto.CreateChallengeRequest;
import com.oneorthree.phone.group.dto.CreateChallengeResponse;
import com.oneorthree.phone.group.dto.GroupChallengeResponse;
import com.oneorthree.phone.group.dto.WindowUsageReportRequest;
import com.oneorthree.phone.group.service.GroupBetWindowUsageService;
import com.oneorthree.phone.group.service.GroupChallengeService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
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
 */
@Tag(name = "Group Challenge", description = "그룹 챌린지 (목록/생성/종료/삭제/창 사용분 보고)")
@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class GroupChallengeController {

    private final GroupChallengeService groupChallengeService;
    /**
     * 창 사용분 보고는 챌린지가 아니라 <b>회차 판정 소스</b>를 갱신한다 — main 이 이 경로를
     * {@code GroupChallengeService} 에서 분리해 세운 전담 서비스(GROMO-1407 · N34 · N43)를 그대로 탄다.
     * 컨트롤러 분리(GROMO-1284)는 <b>구조 이동만</b>이라 호출 대상을 바꾸지 않는다.
     */
    private final GroupBetWindowUsageService groupBetWindowUsageService;

    @Operation(summary = "그룹 챌린지 목록 조회", description = "그룹원만 조회 가능. 최신순 반환. 삭제된 챌린지는 제외."
            + " date(선택, 클라 로컬 타임존 기준 오늘)를 주면 멤버별 당일 진행률(memberProgress)을 함께 반환한다"
            + " — date 미전달, 목표(durationMinutes) 없는 창 챌린지, INACTIVE 면 memberProgress 는 null."
            + " TIME_WINDOW 는 date(KST) 의 창 기준 — FOCUS 는 세션 클리핑 실측(달성 판정만 5분 관용치),"
            + " SCREEN_TIME 은 클라 보고값(미보고 = null)."
            + " 내기 응답(bet)은 '오늘 열린 판'이라 회차가 없는 날엔 null 이다 — 브리지 주기 동안"
            + " 레거시 필드(betId·status·myJoined·participants)와 신앱 필드(enabled·session)를"
            + " 병기한다(N36 보강, GROMO-1418). 내기가 걸려 있는지 자체는 회차와 무관한"
            + " betConfig(enabled·stake)가, 다음 회차 축은 nextSessionAt·nextSessionJoined 가 담당한다.")
    @ApiResponses({
            @ApiResponse(responseCode = "200", description = "조회 성공"),
            @ApiResponse(responseCode = "400", description = "date 형식 오류"),
            @ApiResponse(responseCode = "403", description = "게스트 / 그룹원 아님"),
            @ApiResponse(responseCode = "404", description = "NOT_FOUND(그룹 없음) / USER_NOT_FOUND(요청자 유저 부재 — 재로그인)")
    })
    @GetMapping("/groups/{groupId}/challenges")
    public ResponseEntity<List<GroupChallengeResponse>> getGroupChallenges(
            @PathVariable UUID groupId,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date,
            @LoginUser UUID userId
    ) {
        return ResponseEntity.ok(groupChallengeService.getChallenges(groupId, userId, date));
    }

    @Operation(summary = "그룹 챌린지 생성", description = "OWNER만 생성 가능. 성공 시 201 반환."
            + " repeatDays(도는 요일, [\"MON\"..\"SUN\"])는 신앱 필수(빈 배열 400) — 미전송 구앱은 매일(127)로 처리."
            + " TIME_WINDOW 는 durationMinutes(창 내 목표 분, 0 < x ≤ 창 길이) 필수 — 자정 걸침 금지(시작 < 종료),"
            + " FOCUS 목표는 관용치 5분 초과, SCREEN_TIME 목표는 15분 배수."
            + " DURATION 목표 상한은 카테고리별(FOCUS 1080분·SCREEN_TIME 720분, N51)."
            + " windowStart/windowEnd 는 KST 벽시계 시각 문자열 \"HH:mm:ss\" 권장(GROMO-1225) —"
            + " 구버전 앱의 ISO Instant(예: 2026-08-05T09:00:00+09:00)도 수용하며 KST 시각으로 동일 해석.")
    @ApiResponses({
            @ApiResponse(responseCode = "201", description = "챌린지 생성 성공"),
            @ApiResponse(responseCode = "400", description = "파라미터 누락 / TIME_WINDOW durationMinutes 누락·범위 위반"
                    + " / 자정 걸침·형식 오류(INVALID_MISSION_PARAMS) / 요일 빈 배열(CHALLENGE_REPEAT_DAYS_REQUIRED)"
                    + " / 스크린타임 창 목표 15분 배수 아님(CHALLENGE_GOAL_NOT_ALIGNED)"),
            @ApiResponse(responseCode = "403", description = "게스트 / 그룹원 아님 / OWNER 아님"),
            @ApiResponse(responseCode = "404", description = "NOT_FOUND(그룹 없음) / USER_NOT_FOUND(요청자 유저 부재 — 재로그인)"),
            @ApiResponse(responseCode = "409", description = "활성 4개 상한(CHALLENGE_LIMIT_EXCEEDED)"
                    + " / 하루형 카테고리 활성 중복(CHALLENGE_DUPLICATE)"
                    + " / 활성 창형과 시간대 겹침(CHALLENGE_WINDOW_OVERLAP)")
    })
    @PostMapping("/groups/{groupId}/challenges")
    public ResponseEntity<CreateChallengeResponse> createGroupChallenge(
            @PathVariable UUID groupId,
            @Valid @RequestBody CreateChallengeRequest request,
            @LoginUser UUID userId
    ) {
        CreateChallengeResponse response = groupChallengeService.createChallenge(groupId, userId, request);
        return ResponseEntity.status(HttpStatus.CREATED).body(response);
    }

    @Operation(summary = "스크린타임 창 사용분 보고", description = "SCREEN_TIME×TIME_WINDOW 챌린지의 날짜별"
            + " 창 내 사용분 업로드. 그룹원 또는 시작된 OPEN 회차의 참가자(탈퇴자 포함 — N43)."
            + " (챌린지, 유저, 날짜)당 1행 upsert — measuredAt 단조 갱신(GROMO-1407·N34): 저장된 측정"
            + " 시각보다 오래된 보고는 조용히 204 로 무시된다. 본문은 {usageDate, progressMinutes,"
            + " measuredAt} (구앱 {date, usedMinutes} 도 수용). 값은 클라 신뢰(±15분 눈금 오차).")
    @ApiResponses({
            @ApiResponse(responseCode = "204", description = "보고 성공(역전 보고의 조용한 무시 포함)"),
            @ApiResponse(responseCode = "400", description = "필수 필드 누락 / SCREEN_TIME×TIME_WINDOW 챌린지 아님"
                    + " / progressMinutes 범위(0~1440) 위반"
                    + " / INVALID_MEASURED_AT(measuredAt 이 서버 시각 +2분 초과)"),
            @ApiResponse(responseCode = "403", description = "게스트 / 그룹원도 OPEN 회차 참가자도 아님"),
            @ApiResponse(responseCode = "404",
                    description = "NOT_FOUND(그룹 없음 / 챌린지 없음) / USER_NOT_FOUND(요청자 유저 부재 — 재로그인)")
    })
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

    @Operation(summary = "그룹 챌린지 종료", description = "OWNER만 가능. 성공 시 204 — ENDED 전이(ended_at 기록),"
            + " 더 이상 새 회차를 세우지 않는다. 이미 ENDED 면 멱등 204. 진행 중(OPEN 회차 존재)이면 409 —"
            + " 접으려면 삭제(무효화 + 전원 환불)를 쓴다(policy §A8).")
    @ApiResponses({
            @ApiResponse(responseCode = "204", description = "종료 성공(멱등 포함)"),
            @ApiResponse(responseCode = "403", description = "게스트 / 그룹원 아님 / OWNER 아님"),
            @ApiResponse(responseCode = "404",
                    description = "NOT_FOUND(그룹 없음 / 챌린지 없음 — 삭제 포함)"
                            + " / USER_NOT_FOUND(요청자 유저 부재 — 재로그인)"),
            @ApiResponse(responseCode = "409", description = "OPEN 회차 존재(CHALLENGE_END_BLOCKED)")
    })
    @PostMapping("/groups/{groupId}/challenges/{challengeId}/end")
    public ResponseEntity<Void> endGroupChallenge(
            @PathVariable UUID groupId,
            @PathVariable UUID challengeId,
            @LoginUser UUID userId
    ) {
        groupChallengeService.endChallenge(groupId, challengeId, userId);
        return ResponseEntity.noContent().build();
    }

    @Operation(summary = "그룹 챌린지 삭제", description = "OWNER만 삭제 가능. 성공 시 204 반환.")
    @ApiResponses({
            @ApiResponse(responseCode = "204", description = "삭제 성공"),
            @ApiResponse(responseCode = "403", description = "게스트 / 그룹원 아님 / OWNER 아님"),
            @ApiResponse(responseCode = "404",
                    description = "NOT_FOUND(그룹 없음 / 챌린지 없음) / USER_NOT_FOUND(요청자 유저 부재 — 재로그인)")
    })
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
