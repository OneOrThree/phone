package com.oneorthree.phone.api;

import com.oneorthree.phone.service.dto.FocusTagSetupRequest;
import com.oneorthree.phone.service.dto.FocusTagUpdateRequest;
import com.oneorthree.phone.service.FocusService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@Tag(name = "focus", description = "focus 세션 관련 API (태그, 포커스 타임 등)")
@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class FocusController {

    private final FocusService focusService;

    @Operation(summary = "TAG 초기 등록", description = "TAG, 설명 등록")
    @PostMapping("/tag")
    public ResponseEntity<?> setupTag(
            HttpServletRequest request,
            @RequestBody FocusTagSetupRequest body) {
        Long userId = (Long) request.getAttribute("userId");
        focusService.setupFocusTag(userId, body);
        return ResponseEntity.ok().build();
    }

    @Operation(summary = "TAG 수정", description = "TAG, 설명 수정")
    @PutMapping("/tag")
    public ResponseEntity<?> updateTag(
            HttpServletRequest request,
            @RequestBody FocusTagUpdateRequest body) {
        Long userId = (Long) request.getAttribute("userId");
        focusService.updateFocusTag(userId, body);
        return ResponseEntity.ok().build();
    }

    @Operation(summary = "TAG 삭제", description = "TAG 삭제")
    @DeleteMapping("/tag/{tagId}")
    public ResponseEntity<?> deleteTag(
            HttpServletRequest request,
            @PathVariable Long tagId) {
        Long userId = (Long) request.getAttribute("userId");
        focusService.deleteFocusTag(userId, tagId);
        return ResponseEntity.ok().build();
    }
}
