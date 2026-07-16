package com.oneorthree.phone.focus.api;

import com.oneorthree.phone.focus.dto.FocusSessionCancelRequest;
import com.oneorthree.phone.focus.dto.FocusSessionEndRequest;
import com.oneorthree.phone.focus.dto.FocusSessionEndResponse;
import com.oneorthree.phone.focus.dto.FocusSessionRequest;
import com.oneorthree.phone.focus.dto.FocusSessionSaveResponse;
import com.oneorthree.phone.focus.dto.FocusSessionSliceResponse;
import com.oneorthree.phone.focus.dto.FocusSessionStartRequest;
import com.oneorthree.phone.focus.dto.FocusSessionStartResponse;
import com.oneorthree.phone.focus.dto.FocusTagResponse;
import com.oneorthree.phone.focus.dto.FocusTagSetupRequest;
import com.oneorthree.phone.focus.dto.FocusTagUpdateRequest;
import com.oneorthree.phone.focus.dto.OccupationDefaultTagsResponse;
import com.oneorthree.phone.focus.service.FocusService;
import com.oneorthree.phone.user.domain.Occupation;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Tag(name = "focus", description = "focus 세션 관련 API (태그, 포커스 타임 등)")
@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class FocusController {

    private final FocusService focusService;

    @Operation(summary = "TAG 조회", description = "유저별 TAG 조회")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "조회 성공"),
        @ApiResponse(responseCode = "404", description = "유저 없음")
    })
    @GetMapping("/tag")
    public ResponseEntity<List<FocusTagResponse>> getTag(HttpServletRequest request) {
        UUID userId = (UUID) request.getAttribute("userId");
        return ResponseEntity.ok(focusService.getFocusTags(userId));
    }

    @Operation(summary = "기본(추천) TAG 조회",
            description = "occupation별 기본(추천) 포커스 태그 목록. occupation 미지정 시 로그인 유저의 저장 occupation 사용. "
                    + "tagId 없음 — 유저가 선택 시 name 을 POST /api/v1/tag 로 넘겨 실제 태그 생성.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "조회 성공"),
        @ApiResponse(responseCode = "400", description = "occupation 파라미터 형식 오류 또는 유저 occupation 미설정"),
        @ApiResponse(responseCode = "401", description = "인증 필요"),
        @ApiResponse(responseCode = "404", description = "유저 없음")
    })
    @GetMapping("/tag/defaults")
    public ResponseEntity<OccupationDefaultTagsResponse> getDefaultTags(
            HttpServletRequest request,
            @RequestParam(required = false) Occupation occupation) {
        UUID userId = (UUID) request.getAttribute("userId");
        return ResponseEntity.ok(focusService.getDefaultTags(userId, occupation));
    }

    @Operation(summary = "TAG 초기 등록", description = "TAG, 설명 등록")
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "등록 성공"),
        @ApiResponse(responseCode = "400", description = "유효성 검사 실패"),
        @ApiResponse(responseCode = "404", description = "유저 없음")
    })
    @PostMapping("/tag")
    public ResponseEntity<Void> setupTag(
            HttpServletRequest request,
            @RequestBody FocusTagSetupRequest body) {
        UUID userId = (UUID) request.getAttribute("userId");
        focusService.setupFocusTag(userId, body);
        return ResponseEntity.noContent().build();
    }

    @Operation(summary = "TAG 수정", description = "TAG, 설명 수정")
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "수정 성공"),
        @ApiResponse(responseCode = "400", description = "유효성 검사 실패"),
        @ApiResponse(responseCode = "404", description = "태그 없음")
    })
    @PatchMapping("/tag")
    public ResponseEntity<Void> updateTag(
            HttpServletRequest request,
            @RequestBody FocusTagUpdateRequest body) {
        UUID userId = (UUID) request.getAttribute("userId");
        focusService.updateFocusTag(userId, body);
        return ResponseEntity.noContent().build();
    }

    @Operation(summary = "TAG 삭제", description = "TAG 삭제")
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "삭제 성공"),
        @ApiResponse(responseCode = "403", description = "권한 없음"),
        @ApiResponse(responseCode = "404", description = "태그 없음")
    })
    @DeleteMapping("/tag/{tagId}")
    public ResponseEntity<Void> deleteTag(
            HttpServletRequest request,
            @PathVariable UUID tagId) {
        UUID userId = (UUID) request.getAttribute("userId");
        focusService.deleteFocusTag(userId, tagId);
        return ResponseEntity.noContent().build();
    }

    @Operation(summary = "Focus Session 저장",
            description = "Focus Session 정보 저장. 완료 후 그날 누적 집중 초·스트릭 인정 여부(GROMO-806)를 함께 반환한다. "
                    + "기존 빈 바디에 필드를 추가한 additive 변경 — 구버전 앱은 무시한다.")
    @ApiResponses({
        @ApiResponse(responseCode = "201", description = "저장 성공"),
        @ApiResponse(responseCode = "400", description = "유효성 검사 실패"),
        @ApiResponse(responseCode = "404", description = "유저 없음")
    })
    @PostMapping("/focus-session")
    public ResponseEntity<FocusSessionSaveResponse> saveFocusSession(
            HttpServletRequest request,
            @Valid @RequestBody FocusSessionRequest body) {
        UUID userId = (UUID) request.getAttribute("userId");
        FocusSessionSaveResponse response = focusService.saveFocusSession(userId, body);
        return ResponseEntity.status(HttpStatus.CREATED).body(response);
    }

    @Operation(summary = "Focus Session 시작(라이브)",
            description = "startedAt 만 기록한 진행 중(endedAt NULL) 세션을 생성한다. 생성 세션 id 를 반환해 "
                    + "이후 PATCH /focus-session 으로 종료할 때 참조한다. 통계·스트릭은 종료 시점에 귀속.")
    @ApiResponses({
        @ApiResponse(responseCode = "201", description = "시작 성공"),
        @ApiResponse(responseCode = "401", description = "인증 필요"),
        @ApiResponse(responseCode = "403", description = "타인 태그 지정"),
        @ApiResponse(responseCode = "404", description = "유저·태그 없음")
    })
    @PostMapping("/focus-session/start")
    public ResponseEntity<FocusSessionStartResponse> startFocusSession(
            HttpServletRequest request,
            @RequestBody FocusSessionStartRequest body) {
        UUID userId = (UUID) request.getAttribute("userId");
        FocusSessionStartResponse response = focusService.startFocusSession(userId, body);
        return ResponseEntity.status(HttpStatus.CREATED).body(response);
    }

    @Operation(summary = "Focus Session 종료(라이브)",
            description = "진행 중(endedAt NULL) 세션에 종료 시각을 채워 완료 처리한다. endedAt 생략 시 서버 수신 시각. "
                    + "완료 시점에 통계·스트릭이 귀속된다. 이미 종료된 세션 재요청은 409.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "종료 성공"),
        @ApiResponse(responseCode = "400", description = "sessionId 누락·endedAt < startedAt"),
        @ApiResponse(responseCode = "401", description = "인증 필요"),
        @ApiResponse(responseCode = "403", description = "세션·태그 소유자 불일치"),
        @ApiResponse(responseCode = "404", description = "유저·세션 없음"),
        @ApiResponse(responseCode = "409", description = "이미 종료된 세션")
    })
    @PatchMapping("/focus-session")
    public ResponseEntity<FocusSessionEndResponse> endFocusSession(
            HttpServletRequest request,
            @Valid @RequestBody FocusSessionEndRequest body) {
        UUID userId = (UUID) request.getAttribute("userId");
        return ResponseEntity.ok(focusService.endFocusSession(userId, body));
    }

    @Operation(summary = "Focus Session 취소",
            description = "진행 중(endedAt NULL) 세션을 취소해 status=CANCELED 로 마감한다. 취소 시각은 서버 수신 시각. "
                    + "통계·스트릭은 귀속하지 않는다. 이미 종료/취소된 세션 재취소는 409(멱등).")
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "취소 성공"),
        @ApiResponse(responseCode = "400", description = "sessionId 누락"),
        @ApiResponse(responseCode = "401", description = "인증 필요"),
        @ApiResponse(responseCode = "403", description = "세션 소유자 불일치"),
        @ApiResponse(responseCode = "404", description = "세션 없음"),
        @ApiResponse(responseCode = "409", description = "이미 종료/취소된 세션")
    })
    @PatchMapping("/focus-session/cancel")
    public ResponseEntity<Void> cancelFocusSession(
            HttpServletRequest request,
            @Valid @RequestBody FocusSessionCancelRequest body) {
        UUID userId = (UUID) request.getAttribute("userId");
        focusService.cancelFocusSession(userId, body);
        return ResponseEntity.noContent().build();
    }

    @Operation(summary = "Focus Session 조회",
            description = "기간(from~to, UTC Instant) 필터 + 커서(keyset) 페이지네이션. "
                    + "cursor 생략 시 첫 페이지. 정렬은 id(UUID v7) 내림차순=최신순.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "조회 성공"),
        @ApiResponse(responseCode = "400", description = "파라미터 누락·형식 오류·기간 역전·size 범위 밖"),
        @ApiResponse(responseCode = "401", description = "인증 필요"),
        @ApiResponse(responseCode = "404", description = "유저 없음")
    })
    @GetMapping("/focus-session")
    public ResponseEntity<FocusSessionSliceResponse> getFocusSessions(
            HttpServletRequest request,
            @RequestParam Instant from,
            @RequestParam Instant to,
            @RequestParam(required = false) UUID cursor,
            @RequestParam int size) {
        UUID userId = (UUID) request.getAttribute("userId");
        return ResponseEntity.ok(focusService.getFocusSessions(userId, from, to, cursor, size));
    }
}
