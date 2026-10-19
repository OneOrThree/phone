package com.oneorthree.phone.internal;

import com.oneorthree.phone.internal.dto.GuestbookWriteRequest;
import com.oneorthree.phone.internal.dto.IslandGuestbookViews;
import com.oneorthree.phone.internal.dto.IslandNoticeViews;
import com.oneorthree.phone.internal.service.GuestAccountGuards;
import com.oneorthree.phone.internal.service.IslandGuestbookService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/**
 * 섬 방명록의 Data 내부 표면 (GROMO-2262) — 공개 {@code /islands/{islandId}/guestbook…} 3종의 상류다.
 * 주체는 {@code X-User-Id} 뿐이다. 쓰기는 «하루 1개» 유니크가 멱등을 대신하므로 명령 키를 받지 않는다.
 * 게스트의 쓰기는 서비스 앞에서 403 {@code SOCIAL_LOGIN_REQUIRED} 로 막는다(읽기·삭제는 막지 않는다 —
 * 삭제는 섬장 가드가 따로 있다).
 */
@RestController
@RequiredArgsConstructor
public class InternalIslandGuestbookController {

    private final IslandGuestbookService guestbook;
    private final GuestAccountGuards guestAccountGuards;

    @GetMapping("/internal/islands/{islandId}/guestbook")
    public IslandGuestbookViews.Page list(@PathVariable UUID islandId, @RequestHeader("X-User-Id") UUID userId) {
        return guestbook.list(islandId, userId);
    }

    @PostMapping("/internal/islands/{islandId}/guestbook")
    @ResponseStatus(HttpStatus.CREATED)
    public IslandGuestbookViews.Item write(@PathVariable UUID islandId, @RequestHeader("X-User-Id") UUID userId,
            @RequestBody GuestbookWriteRequest body) {
        guestAccountGuards.requireMember(userId);
        return guestbook.write(islandId, userId, body.content());
    }

    @DeleteMapping("/internal/islands/{islandId}/guestbook/{entryId}")
    public IslandNoticeViews.Deleted delete(@PathVariable UUID islandId, @PathVariable UUID entryId,
            @RequestHeader("X-User-Id") UUID userId) {
        return guestbook.delete(islandId, userId, entryId);
    }
}
