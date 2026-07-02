package com.oneorthree.phone.focus.api;

import com.oneorthree.phone.focus.dto.FocusSessionRequest;
import com.oneorthree.phone.focus.dto.FocusSessionSliceResponse;
import com.oneorthree.phone.focus.dto.FocusTagResponse;
import com.oneorthree.phone.focus.dto.FocusTagSetupRequest;
import com.oneorthree.phone.focus.dto.FocusTagUpdateRequest;
import com.oneorthree.phone.focus.service.FocusService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.format.annotation.DateTimeFormat;
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

    @Operation(summary = "Focus Session 저장", description = "Focus Session 정보 저장")
    @ApiResponses({
        @ApiResponse(responseCode = "201", description = "저장 성공"),
        @ApiResponse(responseCode = "400", description = "유효성 검사 실패"),
        @ApiResponse(responseCode = "404", description = "유저 없음")
    })
    @PostMapping("/focus-session")
    public ResponseEntity<Void> saveFocusSession(
            HttpServletRequest request,
            @RequestBody FocusSessionRequest body) {
        UUID userId = (UUID) request.getAttribute("userId");
        focusService.saveFocusSession(userId, body);
        return ResponseEntity.status(HttpStatus.CREATED).build();
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
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant from,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant to,
            @RequestParam(required = false) UUID cursor,
            @RequestParam int size) {
        UUID userId = (UUID) request.getAttribute("userId");
        return ResponseEntity.ok(focusService.getFocusSessions(userId, from, to, cursor, size));
    }
}
