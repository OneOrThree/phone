package com.oneorthree.phone.friend.api;

import com.oneorthree.phone.common.auth.LoginUser;
import com.oneorthree.phone.friend.api.docs.PinControllerDocs;
import com.oneorthree.phone.friend.dto.PinnedUserResponse;
import com.oneorthree.phone.friend.service.FriendService;
import lombok.RequiredArgsConstructor;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * 핀 API — 리그·친구 공용. 친구 아닌 임의 유저도 핀 가능(user 핀 통일, GROMO-609).
 * Swagger 애노테이션은 PinControllerDocs 로 분리했다(GROMO-1621).
 */
@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class PinController implements PinControllerDocs {

    private final FriendService friendService;

    @Override
    @PostMapping("/pins/{userId}")
    public ResponseEntity<Void> pin(
            @PathVariable UUID userId,
            @LoginUser UUID me) {
        friendService.pinFriend(me, userId);
        return ResponseEntity.noContent().build();
    }

    @Override
    @DeleteMapping("/pins/{userId}")
    public ResponseEntity<Void> unpin(
            @PathVariable UUID userId,
            @LoginUser UUID me) {
        friendService.unpinFriend(me, userId);
        return ResponseEntity.noContent().build();
    }

    @Override
    @GetMapping("/pins")
    public ResponseEntity<List<PinnedUserResponse>> getPins(
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date,
            @LoginUser UUID me) {
        return ResponseEntity.ok(friendService.getPinnedFriends(me, date));
    }
}
