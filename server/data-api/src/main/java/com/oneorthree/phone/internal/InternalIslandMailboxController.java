package com.oneorthree.phone.internal;

import com.oneorthree.phone.internal.dto.MailboxViewerResponse;
import com.oneorthree.phone.internal.dto.MessageAuthorsRequest;
import com.oneorthree.phone.internal.dto.MessageAuthorsResponse;
import com.oneorthree.phone.internal.dto.MessageCreatedRequest;
import com.oneorthree.phone.internal.dto.MessageCreatedResponse;
import com.oneorthree.phone.internal.service.InternalIslandMailboxService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/**
 * 우체통 편지방의 Data 내부 표면 (GROMO-1775). 호출자는 Business 하나 — caller 별 exact 허용목록
 * ({@code application-satellites.yml})이 세 경로를 연다. 주체는 {@code InternalAuthFilter} 가 검증한
 * {@code X-User-Id} 이고, 여기서 다시 검증하지 않는다({@code InternalUserController} 와 같은 이유).
 *
 * <p>메시지 정본은 realtime 의 {@code gromo_chat} 이다 — 이 표면은 인가·표시·사건만 답한다(M02).
 */
@RestController
@RequestMapping("/internal/islands/{islandId}")
@RequiredArgsConstructor
public class InternalIslandMailboxController {

    private final InternalIslandMailboxService service;

    /** 주민 인가 + 요청자 표시 projection. 거절은 403 MEMBER_ONLY / MAILBOX_LOCKED · 404 USER_NOT_FOUND. */
    @GetMapping("/mailbox-access")
    public MailboxViewerResponse access(@PathVariable UUID islandId, @RequestHeader("X-User-Id") UUID userId) {
        return service.access(islandId, userId);
    }

    /** 한 페이지의 작성자 표시 projection — 요청자가 주민일 때만, 요청한 id 에 한해. */
    @PostMapping("/message-authors")
    public MessageAuthorsResponse authors(@PathVariable UUID islandId, @RequestHeader("X-User-Id") UUID userId,
            @Valid @RequestBody MessageAuthorsRequest request) {
        return service.authors(islandId, userId, request.userIds());
    }

    /** 저장이 끝난 메시지의 {@code message.created} 적재. 같은 messageId 는 같은 봉투를 재생한다. */
    @PostMapping("/message-events")
    public MessageCreatedResponse messageCreated(@PathVariable UUID islandId,
            @RequestHeader("X-User-Id") UUID userId, @Valid @RequestBody MessageCreatedRequest request) {
        return service.recordMessageCreated(islandId, userId, request);
    }
}
