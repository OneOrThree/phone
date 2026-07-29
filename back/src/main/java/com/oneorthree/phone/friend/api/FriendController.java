package com.oneorthree.phone.friend.api;

import com.oneorthree.phone.common.auth.LoginUser;
import com.oneorthree.phone.friend.dto.FriendRequestCreateRequest;
import com.oneorthree.phone.friend.dto.FriendRequestResponse;
import com.oneorthree.phone.friend.dto.FriendResponse;
import com.oneorthree.phone.friend.dto.FriendSearchResultResponse;
import com.oneorthree.phone.friend.search.SearchType;
import com.oneorthree.phone.friend.service.FriendService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
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

@Tag(name = "Friend", description = "친구 요청·수락·거절·삭제·목록·검색 API")
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
            @LoginUser UUID userId) {
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
            @LoginUser UUID userId) {
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
            @LoginUser UUID userId) {
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
            @LoginUser UUID userId) {
        friendService.deleteFriend(userId, friendUserId);
        return ResponseEntity.noContent().build();
    }

    @Operation(summary = "친구 목록 조회",
            description = "ACCEPTED·미삭제 친구 목록. isPinned는 내가 핀한 친구면 true. 각 친구의 집중 라이브 정보"
                    + "(isFocusing·focusTimeMinutes·focusStartedAt·focusTagName) 포함. "
                    + "date 는 클라 로컬 타임존 기준 오늘(YYYY-MM-DD).")
    @ApiResponses({
            @ApiResponse(responseCode = "200", description = "조회 성공"),
            @ApiResponse(responseCode = "400", description = "date 누락·형식 오류")
    })
    @GetMapping("/friends")
    public ResponseEntity<List<FriendResponse>> getFriends(
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date,
            @LoginUser UUID userId) {
        return ResponseEntity.ok(friendService.getFriends(userId, date));
    }

    @Operation(summary = "친구 요청 목록 조회", description = "type=received(받은) | sent(보낸) PENDING 요청 목록.")
    @ApiResponses({
            @ApiResponse(responseCode = "200", description = "조회 성공")
    })
    @GetMapping("/friends/requests")
    public ResponseEntity<List<FriendRequestResponse>> getFriendRequests(
            @RequestParam String type,
            @LoginUser UUID userId) {
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
            @LoginUser UUID userId) {
        return ResponseEntity.ok(friendService.search(userId, type, q));
    }
}
