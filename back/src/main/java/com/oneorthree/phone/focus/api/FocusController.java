package com.oneorthree.phone.api;

import com.oneorthree.phone.service.dto.focusmode.FocusSessionRequest;
import com.oneorthree.phone.service.dto.focusmode.FocusSessionResponse;
import com.oneorthree.phone.service.dto.focusmode.FocusTagResponse;
import com.oneorthree.phone.service.dto.focusmode.FocusTagSetupRequest;
import com.oneorthree.phone.service.dto.focusmode.FocusTagUpdateRequest;
import com.oneorthree.phone.service.FocusService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@Tag(name = "focus", description = "focus 세션 관련 API (태그, 포커스 타임 등)")
@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class FocusController {

    private final FocusService focusService;

    @Operation(summary = "TAG 조회", description = "유저별 TAG 조회")
    @GetMapping("/tag")
    public ResponseEntity<List<FocusTagResponse>> getTag(HttpServletRequest request) {
        Long userId = (Long) request.getAttribute("userId");
        return ResponseEntity.ok(focusService.getFocusTags(userId));
    }


    @Operation(summary = "TAG 초기 등록", description = "TAG, 설명 등록")
    @PostMapping("/tag")
    public ResponseEntity<Void> setupTag(
            HttpServletRequest request,
            @RequestBody FocusTagSetupRequest body) {
        Long userId = (Long) request.getAttribute("userId");
        focusService.setupFocusTag(userId, body);
        return ResponseEntity.ok().build();
    }

    @Operation(summary = "TAG 수정", description = "TAG, 설명 수정")
    @PatchMapping("/tag")
    public ResponseEntity<Void> updateTag(
            HttpServletRequest request,
            @RequestBody FocusTagUpdateRequest body) {
        Long userId = (Long) request.getAttribute("userId");
        focusService.updateFocusTag(userId, body);
        return ResponseEntity.ok().build();
    }

    @Operation(summary = "TAG 삭제", description = "TAG 삭제")
    @DeleteMapping("/tag/{tagId}")
    public ResponseEntity<Void> deleteTag(
            HttpServletRequest request,
            @PathVariable Long tagId) {
        Long userId = (Long) request.getAttribute("userId");
        focusService.deleteFocusTag(userId, tagId);
        return ResponseEntity.noContent().build();
    }

    @Operation(summary = "Focus Session 저장", description = "Focus Session 정보 저장")
    @PostMapping("/focus-session")
    public ResponseEntity<Void> saveFocusSession(
            HttpServletRequest request,
            @RequestBody FocusSessionRequest body) {
        Long userId = (Long) request.getAttribute("userId");
        focusService.saveFocusSession(userId, body);
        return ResponseEntity.status(HttpStatus.CREATED).build();
    }

    @Operation(summary = "Focus Session 조회", description = "Focus Session 정보 조회")
    @GetMapping("/focus-session")
    public ResponseEntity<List<FocusSessionResponse>> getFocusSessions(
            HttpServletRequest request) {
        Long userId = (Long) request.getAttribute("userId");
        return ResponseEntity.ok(focusService.getFocusSessions(userId));
    }
}
