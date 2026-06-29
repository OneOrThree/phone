package com.oneorthree.phone.friend.api;

import com.oneorthree.phone.friend.dto.FriendRequestCreateRequest;
import com.oneorthree.phone.friend.dto.FriendRequestResponse;
import com.oneorthree.phone.friend.dto.FriendResponse;
import com.oneorthree.phone.friend.dto.FriendSearchResultResponse;
import com.oneorthree.phone.friend.dto.PinnedFriendResponse;
import com.oneorthree.phone.friend.search.SearchType;
import com.oneorthree.phone.friend.service.FriendService;
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
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

@Tag(name = "Friend", description = "친구 요청·수락·거절·삭제·목록·검색·핀 API")
@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class FriendController {

    private final FriendService friendService;

    @Operation(summary = "친구 요청 생성", description = "targetUserId에게 친구 요청. 자기자신·중복·이미친구 검증, REJECTED면 재요청으로 재전환.")
    @ApiResponses({
            @ApiResponse(responseCode = "201", description = "요청 생성 성공"),
            @ApiResponse(responseCode = "400", description = "자기 자신에게 요청"),
            @ApiResponse(responseCode = "404", description = "대상 유저 없음"),
            @ApiResponse(responseCode = "409", description = "이미 친구 / 이미 보낸 요청 존재")
    })
    @PostMapping("/friends/requests")
    public ResponseEntity<Void> createFriendRequest(
            @Valid @RequestBody FriendRequestCreateRequest request,
            HttpServletRequest httpServletRequest) {
        UUID userId = (UUID) httpServletRequest.getAttribute("userId");
        friendService.createRequest(userId, request.getTargetUserId());
        return ResponseEntity.status(HttpStatus.CREATED).build();
    }

    @Operation(summary = "친구 요청 수락", description = "요청 수신자만 수락 가능. PENDING → ACCEPTED.")
    @ApiResponses({
            @ApiResponse(responseCode = "200", description = "수락 성공"),
            @ApiResponse(responseCode = "403", description = "수신자 아님"),
            @ApiResponse(responseCode = "404", description = "요청 없음")
    })
    @PostMapping("/friends/requests/{id}/accept")
    public ResponseEntity<Void> acceptFriendRequest(
            @PathVariable UUID id,
            HttpServletRequest httpServletRequest) {
        UUID userId = (UUID) httpServletRequest.getAttribute("userId");
        friendService.acceptRequest(userId, id);
        return ResponseEntity.ok().build();
    }

    @Operation(summary = "친구 요청 거절", description = "요청 수신자만 거절 가능. PENDING → REJECTED.")
    @ApiResponses({
            @ApiResponse(responseCode = "200", description = "거절 성공"),
            @ApiResponse(responseCode = "403", description = "수신자 아님"),
            @ApiResponse(responseCode = "404", description = "요청 없음")
    })
    @PostMapping("/friends/requests/{id}/reject")
    public ResponseEntity<Void> rejectFriendRequest(
            @PathVariable UUID id,
            HttpServletRequest httpServletRequest) {
        UUID userId = (UUID) httpServletRequest.getAttribute("userId");
        friendService.rejectRequest(userId, id);
        return ResponseEntity.ok().build();
    }

    @Operation(summary = "친구 삭제", description = "ACCEPTED 관계를 양측 누구나 soft delete. 성공 시 204 반환.")
    @ApiResponses({
            @ApiResponse(responseCode = "204", description = "삭제 성공"),
            @ApiResponse(responseCode = "404", description = "친구 관계 아님")
    })
    @DeleteMapping("/friends/{friendUserId}")
    public ResponseEntity<Void> deleteFriend(
            @PathVariable UUID friendUserId,
            HttpServletRequest httpServletRequest) {
        UUID userId = (UUID) httpServletRequest.getAttribute("userId");
        friendService.deleteFriend(userId, friendUserId);
        return ResponseEntity.noContent().build();
    }

    @Operation(summary = "친구 목록 조회", description = "ACCEPTED·미삭제 친구 목록. isPinned는 내가 핀한 친구면 true.")
    @ApiResponses({
            @ApiResponse(responseCode = "200", description = "조회 성공")
    })
    @GetMapping("/friends")
    public ResponseEntity<List<FriendResponse>> getFriends(HttpServletRequest httpServletRequest) {
        UUID userId = (UUID) httpServletRequest.getAttribute("userId");
        return ResponseEntity.ok(friendService.getFriends(userId));
    }

    @Operation(summary = "친구 요청 목록 조회", description = "type=received(받은) | sent(보낸) PENDING 요청 목록.")
    @ApiResponses({
            @ApiResponse(responseCode = "200", description = "조회 성공")
    })
    @GetMapping("/friends/requests")
    public ResponseEntity<List<FriendRequestResponse>> getFriendRequests(
            @RequestParam String type,
            HttpServletRequest httpServletRequest) {
        UUID userId = (UUID) httpServletRequest.getAttribute("userId");
        return ResponseEntity.ok(friendService.getRequests(userId, type));
    }

    @Operation(summary = "친구 검색", description = "type별 검색 전략(NICKNAME=trgm)으로 검색. 자기자신 제외, 기존 관계(relation) 표기.")
    @ApiResponses({
            @ApiResponse(responseCode = "200", description = "검색 성공"),
            @ApiResponse(responseCode = "400", description = "지원하지 않는 검색 수단")
    })
    @GetMapping("/friends/search")
    public ResponseEntity<List<FriendSearchResultResponse>> searchFriends(
            @RequestParam SearchType type,
            @RequestParam String q,
            HttpServletRequest httpServletRequest) {
        UUID userId = (UUID) httpServletRequest.getAttribute("userId");
        return ResponseEntity.ok(friendService.search(userId, type, q));
    }

    @Operation(summary = "친구 핀 설정", description = "친구를 핀해 홈·집중 화면에 함께 표시. 이미 핀이면 멱등(204). 친구 관계가 아니면 404.")
    @ApiResponses({
            @ApiResponse(responseCode = "204", description = "핀 설정 성공"),
            @ApiResponse(responseCode = "404", description = "친구 관계 아님 / 대상 유저 없음")
    })
    @PostMapping("/friends/{friendUserId}/pin")
    public ResponseEntity<Void> pinFriend(
            @PathVariable UUID friendUserId,
            HttpServletRequest httpServletRequest) {
        UUID userId = (UUID) httpServletRequest.getAttribute("userId");
        friendService.pinFriend(userId, friendUserId);
        return ResponseEntity.noContent().build();
    }

    @Operation(summary = "친구 핀 해제", description = "핀 해제. 핀이 없어도 멱등(204).")
    @ApiResponses({
            @ApiResponse(responseCode = "204", description = "핀 해제 성공")
    })
    @DeleteMapping("/friends/{friendUserId}/pin")
    public ResponseEntity<Void> unpinFriend(
            @PathVariable UUID friendUserId,
            HttpServletRequest httpServletRequest) {
        UUID userId = (UUID) httpServletRequest.getAttribute("userId");
        friendService.unpinFriend(userId, friendUserId);
        return ResponseEntity.noContent().build();
    }

    @Operation(summary = "핀한 친구 조회", description = "내가 핀한 친구 목록. 캐릭터 표시정보 + 오늘 집중분 + 현재 집중 여부 포함.")
    @ApiResponses({
            @ApiResponse(responseCode = "200", description = "조회 성공")
    })
    @GetMapping("/friends/pinned")
    public ResponseEntity<List<PinnedFriendResponse>> getPinnedFriends(HttpServletRequest httpServletRequest) {
        UUID userId = (UUID) httpServletRequest.getAttribute("userId");
        return ResponseEntity.ok(friendService.getPinnedFriends(userId));
    }
}
