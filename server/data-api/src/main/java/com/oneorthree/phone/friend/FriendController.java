package com.oneorthree.phone.friend;

import com.oneorthree.phone.common.auth.LoginUser;
import com.oneorthree.phone.friend.dto.FriendRequestCreateRequest;
import com.oneorthree.phone.friend.dto.FriendRequestResponse;
import com.oneorthree.phone.friend.dto.FriendResponse;
import com.oneorthree.phone.friend.dto.FriendSearchResultResponse;
import com.oneorthree.phone.friend.service.search.SearchType;
import com.oneorthree.phone.friend.service.FriendService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * 친구 API. Swagger 애노테이션은 {@link FriendControllerDocs} 로 분리했다(GROMO-1621).
 */
@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class FriendController implements FriendControllerDocs {

    private final FriendService friendService;

    @Override
    @PostMapping("/friends/requests")
    public ResponseEntity<Void> createFriendRequest(
            @Valid @RequestBody FriendRequestCreateRequest request,
            @LoginUser UUID userId) {
        friendService.createRequest(userId, request.getTargetUserId());
        return ResponseEntity.status(HttpStatus.CREATED).build();
    }

    @Override
    @PostMapping("/friends/requests/{id}/accept")
    public ResponseEntity<Void> acceptFriendRequest(
            @PathVariable UUID id,
            @LoginUser UUID userId) {
        friendService.acceptRequest(userId, id);
        return ResponseEntity.ok().build();
    }

    @Override
    @PostMapping("/friends/requests/{id}/reject")
    public ResponseEntity<Void> rejectFriendRequest(
            @PathVariable UUID id,
            @LoginUser UUID userId) {
        friendService.rejectRequest(userId, id);
        return ResponseEntity.ok().build();
    }

    @Override
    @DeleteMapping("/friends/{friendUserId}")
    public ResponseEntity<Void> deleteFriend(
            @PathVariable UUID friendUserId,
            @LoginUser UUID userId) {
        friendService.deleteFriend(userId, friendUserId);
        return ResponseEntity.noContent().build();
    }

    @Override
    @GetMapping("/friends")
    public ResponseEntity<List<FriendResponse>> getFriends(
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date,
            @LoginUser UUID userId) {
        return ResponseEntity.ok(friendService.getFriends(userId, date));
    }

    @Override
    @GetMapping("/friends/requests")
    public ResponseEntity<List<FriendRequestResponse>> getFriendRequests(
            @RequestParam String type,
            @LoginUser UUID userId) {
        return ResponseEntity.ok(friendService.getRequests(userId, type));
    }

    @Override
    @GetMapping("/friends/search")
    public ResponseEntity<List<FriendSearchResultResponse>> searchFriends(
            @RequestParam SearchType type,
            @RequestParam String q,
            @LoginUser UUID userId) {
        return ResponseEntity.ok(friendService.search(userId, type, q));
    }
}
