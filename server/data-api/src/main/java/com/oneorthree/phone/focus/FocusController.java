package com.oneorthree.phone.focus;

import com.oneorthree.phone.common.auth.LoginUser;
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
import com.oneorthree.phone.user.repository.domain.Occupation;
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

/**
 * 집중 세션·태그 API. Swagger 애노테이션은 {@link FocusControllerDocs} 로 분리했다(GROMO-1621).
 */
@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class FocusController implements FocusControllerDocs {

    private final FocusService focusService;

    @Override
    @GetMapping("/tag")
    public ResponseEntity<List<FocusTagResponse>> getTag(@LoginUser UUID userId) {
        return ResponseEntity.ok(focusService.getFocusTags(userId));
    }

    @Override
    @GetMapping("/tag/defaults")
    public ResponseEntity<OccupationDefaultTagsResponse> getDefaultTags(
            @LoginUser UUID userId,
            @RequestParam(required = false) Occupation occupation) {
        return ResponseEntity.ok(focusService.getDefaultTags(userId, occupation));
    }

    @Override
    @PostMapping("/tag")
    public ResponseEntity<Void> setupTag(
            @LoginUser UUID userId,
            @RequestBody FocusTagSetupRequest body) {
        focusService.setupFocusTag(userId, body);
        return ResponseEntity.noContent().build();
    }

    @Override
    @PatchMapping("/tag")
    public ResponseEntity<Void> updateTag(
            @LoginUser UUID userId,
            @RequestBody FocusTagUpdateRequest body) {
        focusService.updateFocusTag(userId, body);
        return ResponseEntity.noContent().build();
    }

    @Override
    @DeleteMapping("/tag/{tagId}")
    public ResponseEntity<Void> deleteTag(
            @LoginUser UUID userId,
            @PathVariable UUID tagId) {
        focusService.deleteFocusTag(userId, tagId);
        return ResponseEntity.noContent().build();
    }

    @Override
    @PostMapping("/focus-session")
    public ResponseEntity<FocusSessionSaveResponse> saveFocusSession(
            @LoginUser UUID userId,
            @Valid @RequestBody FocusSessionRequest body) {
        FocusSessionSaveResponse response = focusService.saveFocusSession(userId, body);
        return ResponseEntity.status(HttpStatus.CREATED).body(response);
    }

    @Override
    @PostMapping("/focus-session/start")
    public ResponseEntity<FocusSessionStartResponse> startFocusSession(
            @LoginUser UUID userId,
            @RequestBody FocusSessionStartRequest body) {
        FocusSessionStartResponse response = focusService.startFocusSession(userId, body);
        return ResponseEntity.status(HttpStatus.CREATED).body(response);
    }

    @Override
    @PatchMapping("/focus-session")
    public ResponseEntity<FocusSessionEndResponse> endFocusSession(
            @LoginUser UUID userId,
            @Valid @RequestBody FocusSessionEndRequest body) {
        return ResponseEntity.ok(focusService.endFocusSession(userId, body));
    }

    @Override
    @PatchMapping("/focus-session/cancel")
    public ResponseEntity<Void> cancelFocusSession(
            @LoginUser UUID userId,
            @Valid @RequestBody FocusSessionCancelRequest body) {
        focusService.cancelFocusSession(userId, body);
        return ResponseEntity.noContent().build();
    }

    @Override
    @GetMapping("/focus-session")
    public ResponseEntity<FocusSessionSliceResponse> getFocusSessions(
            @LoginUser UUID userId,
            @RequestParam Instant from,
            @RequestParam Instant to,
            @RequestParam(required = false) UUID cursor,
            @RequestParam int size) {
        return ResponseEntity.ok(focusService.getFocusSessions(userId, from, to, cursor, size));
    }
}
