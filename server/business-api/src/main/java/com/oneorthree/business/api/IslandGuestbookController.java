package com.oneorthree.business.api;

import com.oneorthree.business.api.dto.IslandNoticeResponses.NoticeDeletedView;
import com.oneorthree.business.auth.AccessTokenClaims;
import com.oneorthree.business.common.api.ApiErrorCode;
import com.oneorthree.business.common.api.PublicApiException;
import com.oneorthree.business.common.validation.PublicIds;
import com.oneorthree.business.config.UpstreamConfigProperties;
import com.oneorthree.business.upstream.data.dto.IslandGuestbooks;
import com.oneorthree.business.usecase.IslandGuestbookUseCase;
import com.oneorthree.business.usecase.SettingsSessionGuard;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;

import java.util.UUID;

/**
 * 섬 방명록 3종의 <b>공개 경계</b> (GROMO-2262, 섬 외부 계약 §2). 여기서는 입력의 «모양» 만 본다 — 정확히
 * {@code {content}} 하나, 공백만이거나 20 코드포인트(🐟 = 1)를 넘으면 400 {@code INVALID_REQUEST}. 게시판 완공·
 * 섬장·게스트·하루 1개는 Data 가 판정한다. 하루 1개 유니크가 멱등을 대신해 {@code Idempotency-Key} 는 받지 않는다.
 * 삭제는 레포 관례대로 200 {@code {deleted:true}} 다.
 */
@RestController
@RequiredArgsConstructor
public class IslandGuestbookController {

    private static final int CONTENT_MAX = 20;

    private final IslandGuestbookUseCase guestbook;
    private final SettingsSessionGuard sessions;
    private final UpstreamConfigProperties properties;

    @GetMapping("/islands/{islandId}/guestbook")
    public IslandGuestbooks.Page list(@PathVariable String islandId, HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        return guestbook.list(claims, PublicIds.uuid(islandId, "islandId"), properties.deadline());
    }

    @PostMapping(value = "/islands/{islandId}/guestbook", consumes = "application/json")
    public ResponseEntity<IslandGuestbooks.Item> write(@PathVariable String islandId, @RequestBody JsonNode body,
            HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        UUID island = PublicIds.uuid(islandId, "islandId");
        if (body == null || !body.isObject() || body.size() != 1 || !body.has("content")
                || !body.get("content").isString()) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, null);
        }
        String content = body.get("content").stringValue().strip();
        if (content.isEmpty() || content.codePointCount(0, content.length()) > CONTENT_MAX) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, "content");
        }
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(guestbook.write(claims, island, content, properties.deadline()));
    }

    @DeleteMapping("/islands/{islandId}/guestbook/{entryId}")
    public NoticeDeletedView delete(@PathVariable String islandId, @PathVariable String entryId,
            HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        return NoticeDeletedView.from(guestbook.delete(claims, PublicIds.uuid(islandId, "islandId"),
                PublicIds.uuid(entryId, "entryId"), properties.deadline()));
    }
}
